import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * ⛔ The desk's FIRST print for someone (named to a seat, or a desk sale) runs
 * through the reprint path as ops_override. It is not a reprint: the badge is
 * "printed" and the reprint count does not move (Stephen, 2026-10-21).
 */

let personRow: Record<string, unknown> = {};
let written: Record<string, unknown> | null = null;

vi.mock("@/lib/auth/guards", () => ({
  requireConferenceDeskAccess: async () => ({ ok: true, ctx: { userId: "desk-1" } }),
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "desk-1" } }),
  requireAdmin: async () => ({ ok: true, ctx: { userId: "desk-1" } }),
  isGlobalAdmin: () => true,
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));
const queued: string[] = [];
vi.mock("@/lib/actions/conference-badges", () => ({
  requestBadgeReprint: async () => ({ success: true, data: { jobId: "job-1", qrPayload: "qr" } }),
  sendReprintToQueue: async ({ jobId }: { jobId: string }) => {
    queued.push(jobId);
    return { success: true, data: { stationOnline: true } };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq", "in", "is", "limit"]) b[m] = () => b;
      b.update = (patch: Record<string, unknown>) => {
        if (table === "conference_people") written = patch;
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: table === "conference_people" ? personRow : null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
      return b;
    },
  }),
}));

const { printBadge, reprintConferenceBadge } = await import("../conference-people");

beforeEach(() => {
  personRow = { id: "cp-1", conference_id: "conf-1", badge_reprint_count: 0, badge_print_status: "not_printed" };
  written = null;
  queued.length = 0;
});

/**
 * The one print engine (printBadge): every caller gets the desk's whole
 * sequence. Badge Ops and the War Room drawer used to stop after planning, so
 * nothing they reprinted ever reached the print station.
 */
describe("printing one badge", () => {
  it("sends a sticker for a card in hand straight to the print station", async () => {
    const res = await printBadge({ conferenceId: "conf-1", personId: "cp-1", reason: "damaged", stockInHand: "spare" });
    expect(res).toMatchObject({ success: true, data: { labelPrintable: true, queued: true } });
    expect(queued).toEqual(["job-1"]);
  });

  it("plans the full colour badge when no card is in hand, and queues nothing the label printer can't print", async () => {
    const res = await printBadge({ conferenceId: "conf-1", personId: "cp-1", reason: "lost", stockInHand: "none" });
    expect(res).toMatchObject({ success: true, data: { labelPrintable: false, queued: false } });
    expect(queued).toEqual([]);
  });
});

describe("the desk printing someone's badge", () => {
  it("files a first badge as printed, without counting a reprint", async () => {
    const res = await reprintConferenceBadge("cp-1", "ops_override", "First badge, named at the desk");
    expect(res.success).toBe(true);
    expect(written).toMatchObject({ badge_print_status: "printed", badge_reprint_count: 0 });
  });

  it("still counts a real reprint", async () => {
    personRow = { ...personRow, badge_print_status: "printed" };
    await reprintConferenceBadge("cp-1", "ops_override", "Reprint at the desk");
    expect(written).toMatchObject({ badge_print_status: "reprinted", badge_reprint_count: 1 });
  });

  it("counts a damaged pre-printed badge as a reprint even though it was never marked printed", async () => {
    await reprintConferenceBadge("cp-1", "damaged");
    expect(written).toMatchObject({ badge_print_status: "reprinted", badge_reprint_count: 1 });
  });
});
