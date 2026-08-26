import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the contract that a payment settled OUTSIDE Stripe — a cheque or EFT
 * recorded in QuickBooks — advances membership state exactly like a card
 * payment does.
 *
 * This path used to flip the invoice row and stop there, so a renewal paid by
 * cheque left membership_expires_at untouched: the invoice read "paid" while
 * every expiry-driven surface still treated the org as owing. If a test here
 * breaks, that regression is back.
 */

const {
  createAdminClientMock,
  settlePaidInvoiceMembershipMock,
  stripeInvoicesRetrieveMock,
  stripeInvoicesVoidInvoiceMock,
  stripeInvoicesDelMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  settlePaidInvoiceMembershipMock: vi.fn(),
  stripeInvoicesRetrieveMock: vi.fn(),
  stripeInvoicesVoidInvoiceMock: vi.fn(),
  stripeInvoicesDelMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/membership/renewal-activation", () => ({
  settlePaidInvoiceMembership: settlePaidInvoiceMembershipMock,
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    invoices: {
      retrieve: stripeInvoicesRetrieveMock,
      voidInvoice: stripeInvoicesVoidInvoiceMock,
      del: stripeInvoicesDelMock,
    },
  },
}));
vi.mock("@/lib/quickbooks/export", () => ({
  enqueueQBExportRefund: vi.fn(),
}));
vi.mock("@/lib/supabase/user-lookup", () => ({
  resolveOrgAdminEmails: vi.fn(),
  resolveOrgPrimaryContactEmail: vi.fn(),
}));

const { markInvoicePaidOutOfBand } = await import("../billing");

const RENEWAL_INVOICE = {
  id: "inv-local-1",
  organization_id: "org-1",
  type: "partnership",
  status: "invoiced",
  billing_period_start: "2026-08-31",
  billing_period_end: "2027-08-31",
  stripe_invoice_id: "in_test_123",
};

/** Minimal query-builder stub: .from().select().eq().single() and .update().eq() */
function stubDb(invoice: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: invoice }) }),
      }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue(stubDb(RENEWAL_INVOICE));
  settlePaidInvoiceMembershipMock.mockResolvedValue({ activated: true });
  stripeInvoicesRetrieveMock.mockResolvedValue({ status: "open" });
});

describe("markInvoicePaidOutOfBand", () => {
  it("settles the payment into membership state", async () => {
    const result = await markInvoicePaidOutOfBand(
      "inv-local-1",
      "quickbooks",
      "qb-payment-9",
      "2026-08-25T00:00:00.000Z"
    );

    expect(result.success).toBe(true);
    expect(settlePaidInvoiceMembershipMock).toHaveBeenCalledTimes(1);
    expect(settlePaidInvoiceMembershipMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        invoiceId: "inv-local-1",
        billingPeriodStart: "2026-08-31",
        billingPeriodEnd: "2027-08-31",
        triggeredBy: "out_of_band",
      })
    );
  });

  it("keys activation on the Stripe invoice id so a late invoice.paid can't double-activate", async () => {
    await markInvoicePaidOutOfBand("inv-local-1", "quickbooks", "qb-payment-9", "2026-08-25T00:00:00.000Z");

    expect(settlePaidInvoiceMembershipMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "in_test_123" })
    );
  });

  it("falls back to the local invoice id when there is no Stripe invoice", async () => {
    createAdminClientMock.mockReturnValue(stubDb({ ...RENEWAL_INVOICE, stripe_invoice_id: null }));

    await markInvoicePaidOutOfBand("inv-local-1", "manual", "cheque-4471", "2026-08-25T00:00:00.000Z");

    expect(settlePaidInvoiceMembershipMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "invoice:inv-local-1" })
    );
  });

  it("reports an activation failure without unwinding a payment that really happened", async () => {
    settlePaidInvoiceMembershipMock.mockResolvedValue({ activated: false, error: "org locked" });

    const result = await markInvoicePaidOutOfBand(
      "inv-local-1",
      "quickbooks",
      "qb-payment-9",
      "2026-08-25T00:00:00.000Z"
    );

    expect(result.success).toBe(true);
    expect(result.activationError).toBe("org locked");
  });

  it("does not settle an invoice already in a terminal status", async () => {
    createAdminClientMock.mockReturnValue(stubDb({ ...RENEWAL_INVOICE, status: "paid" }));

    const result = await markInvoicePaidOutOfBand(
      "inv-local-1",
      "quickbooks",
      "qb-payment-9",
      "2026-08-25T00:00:00.000Z"
    );

    expect(result.success).toBe(false);
    expect(settlePaidInvoiceMembershipMock).not.toHaveBeenCalled();
  });
});
