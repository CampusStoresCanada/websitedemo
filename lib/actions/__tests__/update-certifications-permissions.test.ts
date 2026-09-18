import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Who may edit an org's self-declared badges.
 *
 * ⛔ The regression this guards: the check used to also require
 * hasPermission(permissionState, "org_admin"). A Vendor Partner org admin
 * resolves to permissionState "partner" — on purpose, the partner program
 * carries orgAdminElevates: false — so that conjunct refused the entire
 * partner cohort, which is the whole audience for these badges. The toggle
 * grid renders off the org LINK role, so the chips were live and the save was
 * rejected (GROSCHE, 2026-09-18).
 *
 * The question this action asks must stay the one every other org write asks:
 * does this person administrate this org. Not what tier their org buys at.
 */

const { createAdminClientMock, getServerAuthStateMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getServerAuthStateMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/auth/server", () => ({ getServerAuthState: getServerAuthStateMock }));
vi.mock("@/lib/membership/mirror", () => ({ mirrorFieldsToMembership: vi.fn() }));

import { updateCertifications } from "../update-certifications";

const ORG_ID = "org-grosche";

/** Captures what the UPDATE was actually given, so we can assert on it. */
function mockDb(stored: string[]) {
  const written: { certifications?: string[] } = {};
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { certifications: stored }, error: null }),
        }),
      }),
      update: (payload: { certifications: string[] }) => {
        written.certifications = payload.certifications;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  };
  createAdminClientMock.mockReturnValue(client);
  return written;
}

/**
 * A Vendor Partner org admin as the real auth state builds them: globalRole
 * "user", an active org_admin link, and permissionState "partner" — NOT
 * org_admin. That mismatch is the entire point of this file.
 */
function partnerOrgAdmin() {
  return {
    user: { id: "u1", email: "sales@grosche.ca" },
    globalRole: "user" as const,
    permissionState: "partner" as const,
    organizations: [
      {
        organization_id: ORG_ID,
        role: "org_admin",
        status: "active",
        organization: { id: ORG_ID, type: "Vendor Partner", membership_status: "active" },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateCertifications permissions", () => {
  it("lets a Vendor Partner org admin save, despite permissionState 'partner'", async () => {
    const written = mockDb([]);
    getServerAuthStateMock.mockResolvedValue(partnerOrgAdmin());

    const result = await updateCertifications(ORG_ID, ["B Corp", "Women Owned"]);

    expect(result).toEqual({ success: true });
    expect(written.certifications).toEqual(["B Corp", "Women Owned"]);
  });

  it("refuses a non-admin member of the same org", async () => {
    mockDb([]);
    const auth = partnerOrgAdmin();
    auth.organizations[0].role = "member";
    getServerAuthStateMock.mockResolvedValue(auth);

    const result = await updateCertifications(ORG_ID, ["B Corp"]);

    expect(result.success).toBe(false);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("refuses an org admin of a DIFFERENT org", async () => {
    mockDb([]);
    const auth = partnerOrgAdmin();
    auth.organizations[0].organization_id = "some-other-org";
    getServerAuthStateMock.mockResolvedValue(auth);

    const result = await updateCertifications(ORG_ID, ["B Corp"]);

    expect(result.success).toBe(false);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("refuses an inactive org_admin link", async () => {
    mockDb([]);
    const auth = partnerOrgAdmin();
    auth.organizations[0].status = "pending";
    getServerAuthStateMock.mockResolvedValue(auth);

    const result = await updateCertifications(ORG_ID, ["B Corp"]);

    expect(result.success).toBe(false);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});

describe("updateCertifications and CANCOLL", () => {
  // CANCOLL is a reciprocal purchasing-group relationship, not a self-declared
  // claim — an org admin may edit every other badge and neither grant nor
  // revoke this one. Widening who reaches this action must not widen that.
  it("cannot be granted by an org admin who sends it", async () => {
    const written = mockDb([]);
    getServerAuthStateMock.mockResolvedValue(partnerOrgAdmin());

    const result = await updateCertifications(ORG_ID, ["CANCOLL", "B Corp"]);

    expect(result).toEqual({ success: true });
    expect(written.certifications).toEqual(["B Corp"]);
  });

  it("cannot be revoked by an org admin who omits it", async () => {
    const written = mockDb(["CANCOLL", "B Corp"]);
    getServerAuthStateMock.mockResolvedValue(partnerOrgAdmin());

    const result = await updateCertifications(ORG_ID, ["Fair Trade"]);

    expect(result).toEqual({ success: true });
    expect(written.certifications).toEqual(["CANCOLL", "Fair Trade"]);
  });
});
