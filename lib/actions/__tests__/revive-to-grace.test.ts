import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * reviveMembershipToGrace and reviveMembership are complements, and the thing
 * worth pinning is the seam between them: whether an org still holds paid
 * coverage decides which one is correct. Getting that backwards is not a
 * cosmetic error — starting a grace clock on a member who has paid through a
 * future date puts them on a countdown to `locked` their own money should have
 * prevented.
 */

const {
  requireAuthenticatedMock,
  isGlobalAdminMock,
  createAdminClientMock,
  transitionMembershipStateMock,
} = vi.hoisted(() => ({
  requireAuthenticatedMock: vi.fn(),
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  transitionMembershipStateMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: requireAuthenticatedMock,
  isGlobalAdmin: isGlobalAdminMock,
  canManageOrganization: vi.fn(() => true),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/membership/state-machine", () => ({
  transitionMembershipState: transitionMembershipStateMock,
}));
vi.mock("@/lib/stripe/billing", () => ({
  createProgramInvoice: vi.fn(),
  finalizeAndSendInvoice: vi.fn(),
}));
vi.mock("@/lib/stripe/client", () => ({ stripe: { invoices: { retrieve: vi.fn() } } }));
vi.mock("@/lib/membership/renewal-activation", () => ({ computeNewExpiresAt: vi.fn() }));
vi.mock("@/lib/policy/engine", () => ({
  getActivePolicySet: vi.fn(),
  getEffectivePolicy: vi.fn(),
  getRenewalConfig: vi.fn(),
}));
vi.mock("@/lib/comms/send", () => ({ sendTransactional: vi.fn() }));
vi.mock("@/lib/renewal/jobs", () => ({ resolveRenewalRecipients: vi.fn() }));
vi.mock("@/lib/renewal/opt-out-scope", () => ({ resolveOptOutScope: vi.fn() }));

import { reviveMembershipToGrace } from "../renewal";

const ORG = "org-mohawk";

function dbReturning(org: Record<string, unknown>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: org, error: null }) }),
      }),
    }),
  };
}

/** A date well clear of today's boundary, in the direction asked for. */
function isoOffsetDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().split("T")[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthenticatedMock.mockResolvedValue({
    ok: true,
    ctx: { userId: "steve", globalRole: "super_admin" },
  });
  isGlobalAdminMock.mockReturnValue(true);
  transitionMembershipStateMock.mockResolvedValue({ success: true });
});

describe("reviveMembershipToGrace", () => {
  it("moves a lapsed canceled org into grace", async () => {
    createAdminClientMock.mockReturnValue(
      dbReturning({ id: ORG, name: "Mohawk", membership_status: "canceled", membership_expires_at: null })
    );

    const result = await reviveMembershipToGrace(ORG, "Edward is bringing them back");

    expect(result.success).toBe(true);
    expect(transitionMembershipStateMock).toHaveBeenCalledWith(
      ORG,
      "grace",
      "admin",
      "steve",
      "Edward is bringing them back",
      expect.objectContaining({ revived_from: "canceled" })
    );
  });

  it("treats an expiry in the past as lapsed", async () => {
    createAdminClientMock.mockReturnValue(
      dbReturning({
        id: ORG,
        name: "Mohawk",
        membership_status: "canceled",
        membership_expires_at: isoOffsetDays(-400),
      })
    );

    const result = await reviveMembershipToGrace(ORG, "Rejoining");

    expect(result.success).toBe(true);
    expect(transitionMembershipStateMock).toHaveBeenCalled();
  });

  it("refuses an org whose paid coverage is still in force, pointing at restore", async () => {
    createAdminClientMock.mockReturnValue(
      dbReturning({
        id: ORG,
        name: "Langara",
        membership_status: "canceled",
        membership_expires_at: isoOffsetDays(200),
      })
    );

    const result = await reviveMembershipToGrace(ORG, "Cancelled by mistake");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/restored to active/i);
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
  });

  it("refuses an org that is not canceled", async () => {
    createAdminClientMock.mockReturnValue(
      dbReturning({ id: ORG, name: "Mohawk", membership_status: "grace", membership_expires_at: null })
    );

    const result = await reviveMembershipToGrace(ORG, "Reason");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/only a canceled organization/i);
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
  });

  it("requires a global admin", async () => {
    isGlobalAdminMock.mockReturnValue(false);
    createAdminClientMock.mockReturnValue(
      dbReturning({ id: ORG, name: "Mohawk", membership_status: "canceled", membership_expires_at: null })
    );

    const result = await reviveMembershipToGrace(ORG, "Reason");

    expect(result.success).toBe(false);
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
  });

  it("requires a reason, so the state log is never blank", async () => {
    createAdminClientMock.mockReturnValue(
      dbReturning({ id: ORG, name: "Mohawk", membership_status: "canceled", membership_expires_at: null })
    );

    const result = await reviveMembershipToGrace(ORG, "   ");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reason is required/i);
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
  });
});
