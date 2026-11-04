import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * ⛔ Agreements are collected AT check-in (Stephen, 2026-10-23): "if we haven't
 * gotten them to do it by the time they are at the door, that is our last
 * shot." A scan for somebody who still owes agreements does NOT check them in;
 * it returns `legal_not_accepted` with the agreements, the desk shows them on
 * its device, records the acceptance, and scans again.
 *
 * This replaces the 2026-09-08 rule "check-in is never gated on documents".
 * That rule was against REFUSING people (a paperwork desk); this collects
 * consent on the spot instead, so the queue keeps moving.
 */

let owed: Array<{ versionId: string; documentType: string; content: string }> = [];
let updatedRow: Record<string, unknown> | null = null;

vi.mock("@/lib/auth/guards", () => ({
  requireConferenceDeskAccess: async () => ({ ok: true, ctx: { userId: "u1" } }),
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "u1" } }),
  requireAdmin: async () => ({ ok: true, ctx: { userId: "u1" } }),
  isGlobalAdmin: () => true,
}));

vi.mock("@/lib/conference/legal-acceptance", () => ({
  personOwedAgreements: async () => owed,
}));

vi.mock("@/lib/actions/conference-legal", () => ({
  getPersonAssigneeLegalGate: async () => ({ success: true, data: { allAccepted: true, missing: [] } }),
  getMyConferenceLegalGate: async () => ({ success: true, data: { allAccepted: true, missing: [] } }),
}));

vi.mock("@/lib/audit", () => ({ logAuditEventSafe: async () => undefined }));

vi.mock("@/lib/conference/badges/tokens", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findBadgeTokenRow: async () => ({
    id: "token-1",
    person_id: "p1",
    conference_id: "conf-1",
    revoked_at: null,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.neq = () => b;
      b.in = () => b;
      b.is = () => b;
      b.not = () => b;
      b.order = () => b;
      b.limit = () => b;
      b.insert = () => Promise.resolve({ data: null, error: null });
      b.update = (patch: Record<string, unknown>) => {
        if (table === "conference_people") updatedRow = patch;
        return b;
      };
      b.maybeSingle = () =>
        Promise.resolve({
          data:
            table === "conference_people"
              ? { id: "p1", checked_in_at: null, assignment_status: "assigned" }
              : null,
          error: null,
        });
      b.single = b.maybeSingle;
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return b;
    },
  }),
}));

beforeEach(() => {
  owed = [];
  updatedRow = null;
});

const scan = async (over: Record<string, unknown> = {}) => {
  const { scanConferenceCheckInToken } = await import("../conference-people");
  return scanConferenceCheckInToken({
    conferenceId: "conf-1",
    qrToken: "sometoken",
    ...over,
  });
};

describe("check-in collects the agreements", () => {
  it("checks somebody in who owes nothing", async () => {
    const result = await scan();
    expect(result.data?.state).toBe("valid");
    expect(updatedRow?.checked_in_at).toBeTruthy();
  });

  it("does not check in somebody who owes agreements, and hands back the text", async () => {
    owed = [{ versionId: "v1", documentType: "member_code_of_conduct", content: "<p>Be kind.</p>" }];
    const result = await scan();
    expect(result.data?.state).toBe("legal_not_accepted");
    expect(result.data?.owed).toEqual(owed);
    expect(result.data?.checkedInAt).toBeNull();
    expect(updatedRow).toBeNull();
  });

  it("asks during a rehearsal too, so the rehearsal shows the real flow", async () => {
    owed = [{ versionId: "v1", documentType: "privacy_notice", content: "<p>Photos.</p>" }];
    const result = await scan({ testMode: true });
    expect(result.data?.state).toBe("legal_not_accepted");
  });
});
