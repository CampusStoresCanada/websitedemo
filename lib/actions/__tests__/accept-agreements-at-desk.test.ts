import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ Agreements accepted on the check-in desk's device (Stephen, 2026-10-23)
 * are recorded for the PERSON (their contact), so someone with no login can
 * consent, with their login too when they have one, and with whose desk it was.
 * Only what they still owe is recorded: the desk's list is not trusted.
 */

let person: Record<string, unknown> | null = null;
const inserted: Array<Record<string, unknown>> = [];

vi.mock("@/lib/auth/guards", () => ({
  requireConferenceDeskAccess: async () => ({ ok: true, ctx: { userId: "desk-staff" } }),
  requireConferenceOpsAccess: async () => ({ ok: true, ctx: { userId: "desk-staff" } }),
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "desk-staff" } }),
  requireAdmin: async () => ({ ok: true, ctx: { userId: "desk-staff" } }),
  isGlobalAdmin: () => false,
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));
vi.mock("@/lib/conference/legal-acceptance", () => ({
  loadPolicyTargeting: async () => [],
  computeMissingLegal: async () => ({ allAccepted: true, missing: [], missingVersionIds: [] }),
  personOwedAgreements: async () => [
    { versionId: "coc", documentType: "member_code_of_conduct", content: "" },
    { versionId: "privacy", documentType: "privacy_notice", content: "" },
  ],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq"]) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve({ data: person, error: null });
      b.insert = (row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve({ error: null });
      };
      return b;
    },
  }),
}));

const { acceptAgreementsAtDesk } = await import("../conference-legal");

beforeEach(() => {
  inserted.length = 0;
  person = { id: "p1", user_id: null, canonical_person_id: "contact-1" };
});

describe("accepting agreements at the desk", () => {
  it("records for the person, with no login, and says whose desk it was", async () => {
    const res = await acceptAgreementsAtDesk({ conferenceId: "c1", personId: "p1", versionIds: ["coc", "privacy"] });
    expect(res).toEqual({ success: true, data: { stillOwed: 0 } });
    expect(inserted).toEqual([
      { user_id: null, contact_id: "contact-1", legal_version_id: "coc", accepted_via: "desk", recorded_by: "desk-staff" },
      { user_id: null, contact_id: "contact-1", legal_version_id: "privacy", accepted_via: "desk", recorded_by: "desk-staff" },
    ]);
  });

  it("records their login too when they have one", async () => {
    person = { ...person, user_id: "user-1" };
    await acceptAgreementsAtDesk({ conferenceId: "c1", personId: "p1", versionIds: ["coc"] });
    expect(inserted[0]).toMatchObject({ user_id: "user-1", contact_id: "contact-1" });
  });

  it("ignores anything they don't owe, and says what is still outstanding", async () => {
    const res = await acceptAgreementsAtDesk({ conferenceId: "c1", personId: "p1", versionIds: ["coc", "made-up"] });
    expect(inserted.map((r) => r.legal_version_id)).toEqual(["coc"]);
    expect(res).toEqual({ success: true, data: { stillOwed: 1 } });
  });
});
