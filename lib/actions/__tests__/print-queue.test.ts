import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * ⛔ The last mile (Stephen, 2026-10-20): a reprint at the desk prints now on
 * the device in hand, or goes to the print station beside the QL. Desk staff
 * operate this — reprinting was admin-only and refused every temp — and they
 * may only touch their own conference's ON-SITE reprints.
 */

let deskAllowed = true;
let jobRow: Record<string, unknown> | null = null;
const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];
const events: Array<Record<string, unknown>> = [];

vi.mock("@/lib/auth/guards", () => ({
  requireConferenceDeskAccess: async () =>
    deskAllowed ? { ok: true, ctx: { userId: "temp-1" } } : { ok: false, error: "Conference desk access required" },
  requireConferenceOpsAccess: async () => ({ ok: false, error: "Administrator access required" }),
  requireAdmin: async () => ({ ok: false, error: "Administrator access required" }),
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "order", "limit", "in"]) b[m] = () => b;
      b.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        patch = p;
        return b;
      };
      b.insert = (row: Record<string, unknown>) => {
        if (table === "badge_print_events") events.push(row);
        return Promise.resolve({ data: null, error: null });
      };
      b.maybeSingle = () => Promise.resolve({ data: table === "badge_print_jobs" ? jobRow : null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => {
        if (patch) updates.push({ table, patch, filters });
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return b;
    },
  }),
}));

beforeEach(() => {
  deskAllowed = true;
  jobRow = { id: "job-1", person_id: "p1", status: "pdf_generated", pipeline_type: "onsite_reprint", metadata: {} };
  updates.length = 0;
  events.length = 0;
});

const actions = () => import("../conference-badges");

describe("sending a sticker to the print station", () => {
  it("lets desk staff (not only admins) queue their conference's reprint", async () => {
    const { sendReprintToQueue } = await actions();
    const res = await sendReprintToQueue({ conferenceId: "conf-1", jobId: "job-1" });
    expect(res.success).toBe(true);
    expect(updates.find((u) => u.table === "badge_print_jobs")?.patch).toMatchObject({
      transport_method: "printer_bridge",
      status: "sent_to_printer",
    });
  });

  it("refuses anyone without desk access", async () => {
    deskAllowed = false;
    const { sendReprintToQueue } = await actions();
    const res = await sendReprintToQueue({ conferenceId: "conf-1", jobId: "job-1" });
    expect(res.success).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("never touches a pre-printed run — only on-site reprints", async () => {
    jobRow = { ...jobRow, pipeline_type: "preprinted" };
    const { sendReprintToQueue } = await actions();
    const res = await sendReprintToQueue({ conferenceId: "conf-1", jobId: "job-1" });
    expect(res.success).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe("the print station marking a sticker printed", () => {
  it("only moves a job that is actually waiting at the station", async () => {
    const { markLabelPrinted } = await actions();
    const res = await markLabelPrinted({ conferenceId: "conf-1", jobId: "job-1" });
    expect(res.success).toBe(true);
    const update = updates.find((u) => u.table === "badge_print_jobs");
    expect(update?.patch).toMatchObject({ status: "printed" });
    expect(update?.filters).toMatchObject({ id: "job-1", status: "sent_to_printer" });
  });
});
