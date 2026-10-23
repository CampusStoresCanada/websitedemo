import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * ⛔ A badge for another day is REFUSED at pickup, not checked in with a
 * warning (Stephen, 2026-10-19). The day rule itself is tested in
 * checkin-facts.test.ts (verdictForDay); this proves the scan obeys it.
 */

let updatedRow: Record<string, unknown> | null = null;
const insertedStates: string[] = [];
let verdict: { admitted: boolean } | null | "throw" = null;
const verdictToday: string[] = [];

vi.mock("@/lib/auth/guards", () => ({
  requireConferenceDeskAccess: async () => ({ ok: true, ctx: { userId: "u1" } }),
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "u1" } }),
  requireAdmin: async () => ({ ok: true, ctx: { userId: "u1" } }),
  isGlobalAdmin: () => true,
}));

vi.mock("@/lib/audit", () => ({ logAuditEventSafe: async () => undefined }));

vi.mock("@/lib/conference/badges/tokens", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findBadgeTokenRow: async () => ({ id: "token-1", person_id: "p1", conference_id: "conf-1", revoked_at: null }),
}));

vi.mock("@/lib/conference/badges/checkin", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  personVerdictToday: async (_conferenceId: string, _personId: string, today: string) => {
    verdictToday.push(today);
    if (verdict === "throw") throw new Error("database hiccup");
    return verdict;
  },
}));

vi.mock("@/lib/conference/desk-staff", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  conferenceToday: async () => "2027-02-02",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit"]) b[m] = () => b;
      b.insert = (row: { result_state?: string }) => {
        if (table === "conference_check_in_events" && row.result_state) insertedStates.push(row.result_state);
        return Promise.resolve({ data: null, error: null });
      };
      b.update = (patch: Record<string, unknown>) => {
        if (table === "conference_people") updatedRow = patch;
        return b;
      };
      b.maybeSingle = () =>
        Promise.resolve({
          data: table === "conference_people" ? { id: "p1", checked_in_at: null, assignment_status: "assigned" } : null,
          error: null,
        });
      b.single = b.maybeSingle;
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return b;
    },
  }),
}));

beforeEach(() => {
  updatedRow = null;
  insertedStates.length = 0;
  verdictToday.length = 0;
  verdict = null;
});

const scan = async (over: Record<string, unknown> = {}) => {
  const { scanConferenceCheckInToken } = await import("../conference-people");
  return scanConferenceCheckInToken({ conferenceId: "conf-1", qrToken: "sometoken", ...over });
};

describe("check-in and the day a badge covers", () => {
  it("refuses a badge for another conference day and checks nobody in", async () => {
    verdict = { admitted: false };
    const result = await scan();
    expect(result.data?.state).toBe("not_valid_today");
    expect(updatedRow).toBeNull();
    expect(insertedStates).toEqual(["not_valid_today"]);
  });

  it("checks in a badge that covers today", async () => {
    verdict = { admitted: true };
    const result = await scan();
    expect(result.data?.state).toBe("valid");
    expect(updatedRow?.checked_in_at).toBeTruthy();
  });

  it("checks in when today is not a conference day", async () => {
    verdict = null;
    expect((await scan()).data?.state).toBe("valid");
  });

  // ⚠️ A database hiccup must not stop the queue.
  it("lets them through when the badge's days cannot be read", async () => {
    verdict = "throw";
    expect((await scan()).data?.state).toBe("valid");
  });

  it("judges the conference's own today, or the rehearsal date in test mode", async () => {
    verdict = { admitted: true };
    await scan();
    await scan({ testMode: true, asOf: "2027-02-04" });
    await scan({ testMode: false, asOf: "2027-02-04" });
    expect(verdictToday).toEqual(["2027-02-02", "2027-02-04", "2027-02-02"]);
  });
});
