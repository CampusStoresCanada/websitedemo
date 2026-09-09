import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test_key";

/**
 * Checking in is NEVER gated on documents.
 *
 * ⛔ It is an administrative act — handing somebody the badge that is already
 * theirs — not a grant of access to anything. Gating it turned the busiest
 * queue of the conference into a paperwork desk and punished the attendee for a
 * gap they could not close while standing there.
 *
 * The documents are enforced where they mean something, and already were before
 * this gate existed: registration, buying a day pass, and the welcome
 * acceptance surface. This test exists because "the desk should check that"
 * sounds so reasonable that somebody will add it back.
 */

const gateCalls: string[] = [];
let updatedRow: Record<string, unknown> | null = null;

vi.mock("@/lib/auth/guards", () => ({
  requireConferenceOpsAccess: async () => ({ ok: true, ctx: { userId: "u1" } }),
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "u1" } }),
  requireAdmin: async () => ({ ok: true, ctx: { userId: "u1" } }),
  isGlobalAdmin: () => true,
}));

// If anything in the check-in path ever consults these again, gateCalls fills up
// and the tests below fail.
vi.mock("@/lib/actions/conference-legal", () => ({
  getPersonAssigneeLegalGate: async (_conferenceId: string, personId: string) => {
    gateCalls.push(personId);
    return { success: true, data: { allAccepted: false, missing: ["Waiver"] } };
  },
  getMyConferenceLegalGate: async () => ({
    success: true,
    data: { allAccepted: false, missing: ["Waiver"] },
  }),
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
  gateCalls.length = 0;
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

describe("check-in and the document gate", () => {
  it("checks somebody in even with every document outstanding", async () => {
    const result = await scan();
    expect(result.data?.state).toBe("valid");
    expect(updatedRow?.checked_in_at).toBeTruthy();
  });

  /**
   * ⛔ Not merely "does not block" — does not ASK. A gate that is consulted and
   * then ignored is latency on the hot path of the busiest queue of the
   * conference, and an invitation for somebody to start honouring it again.
   */
  it("never consults the assignee legal gate at all", async () => {
    await scan();
    expect(gateCalls).toEqual([]);
  });

  it("does not consult it during a rehearsal either", async () => {
    const result = await scan({ testMode: true });
    expect(gateCalls).toEqual([]);
    expect(result.data?.state).toBe("valid");
    expect(updatedRow?.check_in_is_test).toBe(true);
  });

  it("never emits legal_not_accepted", async () => {
    for (const over of [{}, { testMode: true }]) {
      const result = await scan(over);
      expect(result.data?.state).not.toBe("legal_not_accepted");
    }
  });
});
