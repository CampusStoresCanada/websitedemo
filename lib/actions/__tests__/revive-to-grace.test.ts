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
  createProgramInvoiceMock,
  finalizeAndSendInvoiceMock,
  computeNewExpiresAtMock,
  stripeRetrieveMock,
} = vi.hoisted(() => ({
  requireAuthenticatedMock: vi.fn(),
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  transitionMembershipStateMock: vi.fn(),
  createProgramInvoiceMock: vi.fn(),
  finalizeAndSendInvoiceMock: vi.fn(),
  computeNewExpiresAtMock: vi.fn(),
  stripeRetrieveMock: vi.fn(),
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
  createProgramInvoice: createProgramInvoiceMock,
  finalizeAndSendInvoice: finalizeAndSendInvoiceMock,
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: { invoices: { retrieve: stripeRetrieveMock } },
}));
vi.mock("@/lib/membership/renewal-activation", () => ({
  computeNewExpiresAt: computeNewExpiresAtMock,
}));
vi.mock("@/lib/policy/engine", () => ({
  getActivePolicySet: vi.fn(async () => ({ id: "policy-set-1" })),
  getEffectivePolicy: vi.fn(),
  getRenewalConfig: vi.fn(),
}));
vi.mock("@/lib/comms/send", () => ({ sendTransactional: vi.fn() }));
vi.mock("@/lib/renewal/jobs", () => ({ resolveRenewalRecipients: vi.fn() }));
vi.mock("@/lib/renewal/opt-out-scope", () => ({ resolveOptOutScope: vi.fn() }));

import { reviveMembershipToGrace } from "../renewal";

const ORG = "org-mohawk";

/** Serves the organizations read plus the tables the billing step touches. */
function dbReturning(
  org: Record<string, unknown>,
  opts: { existingInvoice?: Record<string, unknown> | null } = {}
) {
  return {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: org, error: null }) }),
          }),
        };
      }
      if (table === "invoices") {
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          eq: () => b,
          in: () => b,
          order: () => b,
          limit: () => b,
          maybeSingle: async () => ({ data: opts.existingInvoice ?? null, error: null }),
        });
        return b;
      }
      if (table === "renewal_events") {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
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
  computeNewExpiresAtMock.mockResolvedValue({
    billingPeriodStart: "2026-09-24",
    billingPeriodEnd: "2027-08-31",
  });
  createProgramInvoiceMock.mockResolvedValue({ id: "inv-1", stripe_invoice_id: "in_1" });
  finalizeAndSendInvoiceMock.mockResolvedValue(undefined);
  stripeRetrieveMock.mockResolvedValue({ hosted_invoice_url: "https://invoice.example/1" });
});

describe("reviveMembershipToGrace", () => {
  it("moves a lapsed canceled org into grace AND bills it", async () => {
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
    // The move alone is what stranded Mohawk and Saint Mary's — in grace, on a
    // clock, with nothing billing them and no screen able to.
    expect(createProgramInvoiceMock).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ billingPeriodEnd: "2027-08-31" })
    );
    expect(finalizeAndSendInvoiceMock).toHaveBeenCalledWith("inv-1");
    expect(result.invoiceUrl).toBe("https://invoice.example/1");
  });

  it("bills an org already stranded in grace, without moving it again", async () => {
    createAdminClientMock.mockReturnValue(
      dbReturning({ id: ORG, name: "Mohawk", membership_status: "grace", membership_expires_at: null })
    );

    const result = await reviveMembershipToGrace(ORG, "Finish the revive");

    expect(result.success).toBe(true);
    // Already in grace — transitioning again would write a second, misleading
    // state-log row saying it moved when it did not.
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
    expect(createProgramInvoiceMock).toHaveBeenCalled();
  });

  it("reuses an unpaid invoice rather than double-billing on a re-click", async () => {
    createAdminClientMock.mockReturnValue(
      dbReturning(
        { id: ORG, name: "Mohawk", membership_status: "grace", membership_expires_at: null },
        { existingInvoice: { id: "inv-old", stripe_invoice_id: "in_old", status: "invoiced" } }
      )
    );

    const result = await reviveMembershipToGrace(ORG, "Retry");

    expect(result.success).toBe(true);
    expect(createProgramInvoiceMock).not.toHaveBeenCalled();
    expect(stripeRetrieveMock).toHaveBeenCalledWith("in_old");
  });

  it("reports the move plainly when billing fails, so a re-click is not mistaken for a fresh start", async () => {
    createAdminClientMock.mockReturnValue(
      dbReturning({ id: ORG, name: "Mohawk", membership_status: "canceled", membership_expires_at: null })
    );
    createProgramInvoiceMock.mockRejectedValue(new Error("Stripe timeout"));

    const result = await reviveMembershipToGrace(ORG, "Reason");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Moved to grace, but the invoice failed/i);
    expect(result.error).toMatch(/Stripe timeout/);
    expect(transitionMembershipStateMock).toHaveBeenCalled();
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
    expect(createProgramInvoiceMock).not.toHaveBeenCalled();
  });

  it("refuses an org that is neither canceled nor lapsed", async () => {
    createAdminClientMock.mockReturnValue(
      dbReturning({ id: ORG, name: "Mohawk", membership_status: "active", membership_expires_at: null })
    );

    const result = await reviveMembershipToGrace(ORG, "Reason");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/canceled or lapsed/i);
    expect(transitionMembershipStateMock).not.toHaveBeenCalled();
    expect(createProgramInvoiceMock).not.toHaveBeenCalled();
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
    expect(createProgramInvoiceMock).not.toHaveBeenCalled();
  });
});
