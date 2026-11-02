import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The /org/billing Pay button: the admin who clicks is the one paying, so
 * they go on the org's Stripe customer (and get Stripe's receipt) before
 * being sent to Stripe's own pay page.
 */

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  canManageOrganization: vi.fn(),
  isGlobalAdmin: vi.fn(),
  setInvoicePayer: vi.fn(),
  logAuditEventSafe: vi.fn(),
  retrieve: vi.fn(),
  invoice: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  canManageOrganization: mocks.canManageOrganization,
  isGlobalAdmin: mocks.isGlobalAdmin,
}));
vi.mock("@/lib/stripe/billing", () => ({
  createProgramInvoice: vi.fn(),
  finalizeAndSendInvoice: vi.fn(),
  setInvoicePayer: mocks.setInvoicePayer,
}));
vi.mock("@/lib/stripe/client", () => ({ stripe: { invoices: { retrieve: mocks.retrieve } } }));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: mocks.logAuditEventSafe }));
vi.mock("@/lib/membership/state-machine", () => ({ transitionMembershipState: vi.fn() }));
vi.mock("@/lib/membership/renewal-activation", () => ({ computeNewExpiresAt: vi.fn() }));
vi.mock("@/lib/policy/engine", () => ({ getActivePolicySet: vi.fn() }));
vi.mock("@/lib/comms/send", () => ({ sendTransactional: vi.fn() }));
vi.mock("@/lib/renewal/jobs", () => ({ resolveRenewalRecipients: vi.fn() }));
vi.mock("@/lib/renewal/opt-out-scope", () => ({ resolveOptOutScope: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: mocks.invoice }),
    };
    return { from: () => chain };
  },
}));

import { openInvoicePayment } from "../renewal";

const HOSTED = "https://invoice.stripe.com/i/acct_1/live_abc?s=ap";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticated.mockResolvedValue({
    ok: true,
    ctx: { userId: "user-ken", userEmail: "khansen2@rrc.ca", globalRole: "user" },
  });
  mocks.isGlobalAdmin.mockReturnValue(false);
  mocks.canManageOrganization.mockReturnValue(true);
  mocks.invoice = {
    id: "inv-1",
    organization_id: "org-rrc",
    status: "invoiced",
    stripe_invoice_id: "in_1",
    hosted_invoice_url: HOSTED,
  };
});

describe("openInvoicePayment", () => {
  it("puts the clicking admin on the Stripe customer, records it, and returns Stripe's link", async () => {
    const result = await openInvoicePayment("inv-1");

    expect(result).toEqual({ success: true, url: HOSTED });
    expect(mocks.setInvoicePayer).toHaveBeenCalledWith("inv-1", "khansen2@rrc.ca");
    expect(mocks.logAuditEventSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "invoice_payment_opened", entityId: "inv-1", actorId: "user-ken" })
    );
  });

  it("refuses someone who cannot manage the org, and moves nothing", async () => {
    mocks.canManageOrganization.mockReturnValue(false);

    const result = await openInvoicePayment("inv-1");

    expect(result.success).toBe(false);
    expect(mocks.setInvoicePayer).not.toHaveBeenCalled();
  });

  it("refuses an invoice that is paid or voided", async () => {
    mocks.invoice = { ...mocks.invoice, status: "paid" };

    const result = await openInvoicePayment("inv-1");

    expect(result.success).toBe(false);
    expect(mocks.setInvoicePayer).not.toHaveBeenCalled();
  });

  it("reads the link from Stripe when the row never captured it", async () => {
    mocks.invoice = { ...mocks.invoice, hosted_invoice_url: null };
    mocks.retrieve.mockResolvedValue({ hosted_invoice_url: HOSTED });

    const result = await openInvoicePayment("inv-1");

    expect(mocks.retrieve).toHaveBeenCalledWith("in_1");
    expect(result).toEqual({ success: true, url: HOSTED });
  });
});
