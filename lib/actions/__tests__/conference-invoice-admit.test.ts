import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ THE INVOICE PATH HAD NO TESTS, AND IT COST A REAL CUSTOMER.
 *
 * Invoicing was built on 2026-09-10 across three commits. Two were merged on
 * 2026-10-13; the third — the one below — was not, and nothing failed, because
 * nothing in the suite touched this branch at all. Six days later:
 *
 *   Order 85c1187d, Ambassador Education Solutions, $10,170 for booth 109 plus
 *   sponsorship. Invoiced 18:26, CANCELED BY CRON AT 19:26, with the Stripe
 *   invoice still outstanding.
 *
 * These tests exist so that cannot happen silently again. They assert the three
 * things the desk depends on, none of which a type-checker or a build can see:
 * who may defer payment, that the entitlement lands immediately, and that the
 * reservation hold is released.
 */

const {
  requireAuthenticatedMock,
  requireConferenceOpsAccessMock,
  isGlobalAdminMock,
  createAdminClientMock,
  stripeInvoiceCreateMock,
  stripeInvoiceItemCreateMock,
  stripeInvoiceRetrieveMock,
  stripeSessionCreateMock,
  ensureStripeCustomerMock,
  finalizeAndSendInvoiceMock,
  logAuditEventSafeMock,
  canBuyMock,
  priceForTierMock,
  availabilityMock,
  transitionMembershipStateMock,
  getPartnershipRateCentsMock,
  applyProrationMock,
  resolveAssigneeForEmailMock,
  findExistingUserByEmailMock,
  resolveConferenceOrderTaxRatesMock,
} = vi.hoisted(() => ({
  requireAuthenticatedMock: vi.fn(),
  requireConferenceOpsAccessMock: vi.fn(),
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  stripeInvoiceCreateMock: vi.fn(),
  stripeInvoiceItemCreateMock: vi.fn(),
  stripeInvoiceRetrieveMock: vi.fn(),
  stripeSessionCreateMock: vi.fn(),
  ensureStripeCustomerMock: vi.fn(),
  finalizeAndSendInvoiceMock: vi.fn(),
  logAuditEventSafeMock: vi.fn(),
  canBuyMock: vi.fn(),
  priceForTierMock: vi.fn(),
  availabilityMock: vi.fn(),
  transitionMembershipStateMock: vi.fn(),
  getPartnershipRateCentsMock: vi.fn(),
  applyProrationMock: vi.fn((baseAmountCents: number) => ({ amountCents: baseAmountCents, discountPct: 0 })),
  resolveAssigneeForEmailMock: vi.fn(),
  findExistingUserByEmailMock: vi.fn(),
  resolveConferenceOrderTaxRatesMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: requireAuthenticatedMock,
  requireConferenceOpsAccess: requireConferenceOpsAccessMock,
  isGlobalAdmin: isGlobalAdminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    checkout: { sessions: { create: stripeSessionCreateMock } },
    invoices: { create: stripeInvoiceCreateMock, retrieve: stripeInvoiceRetrieveMock },
    invoiceItems: { create: stripeInvoiceItemCreateMock },
  },
}));
vi.mock("@/lib/stripe/tax", () => ({
  resolveConferenceOrderTaxRates: resolveConferenceOrderTaxRatesMock,
}));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: logAuditEventSafeMock }));
vi.mock("@/lib/membership/state-machine", () => ({
  transitionMembershipState: transitionMembershipStateMock,
}));
vi.mock("@/lib/stripe/billing", () => ({
  getPartnershipRateCents: getPartnershipRateCentsMock,
  applyProration: applyProrationMock,
  ensureStripeCustomer: ensureStripeCustomerMock,
  finalizeAndSendInvoice: finalizeAndSendInvoiceMock,
}));
vi.mock("../../conference/entity-pricing", () => ({
  canBuy: canBuyMock,
  priceForTier: priceForTierMock,
  availability: availabilityMock,
  // No funded (CANCOLL) offer in these carts.
  isFundedOffer: () => false,
  fundedRegistrationAllowed: () => false,
}));
vi.mock("@/lib/actions/conference-people", () => ({
  resolveAssigneeForEmail: resolveAssigneeForEmailMock,
}));
vi.mock("@/lib/actions/conference-entity-commerce", () => ({
  findExistingUserByEmail: findExistingUserByEmailMock,
}));
vi.mock("../../comms/conference-triggers", () => ({
  triggerConferenceRegistrationConfirmation: vi.fn(),
  triggerConferencePaymentConfirmation: vi.fn(),
}));

import { createConferenceCheckout } from "../conference-commerce";
import { makeFakeDb, callsFor, type QueryResult } from "../../test/fake-supabase";

const INVOICE_INPUT = {
  conferenceId: "conf-1",
  organizationId: "org-1",
  successUrl: "https://example.test/success",
  cancelUrl: "https://example.test/cancel",
  paymentMethod: "invoice" as const,
};

function invoiceQueues(): Record<string, QueryResult[]> {
  return {
    cart_items: [{ data: [{ id: "cart-1", quantity: 1, offer_entity_id: "offer-1" }] }],
    conference_entities: [
      {
        data: [
          {
            id: "offer-1",
            kind: "registration",
            name: "Full Conference Registration",
            price_cents: 29_900,
            currency: "CAD",
            inventory: null,
            tier_prices: {},
          },
        ],
      },
    ],
    conference_entity_refs: [{ data: [] }],
    conference_instances: [
      { data: { tax_rate_pct: 13, stripe_tax_rate_id: "txr_test", status: "registration_open" } },
    ],
    organizations: [{ data: { type: "Member" } }],
    policy_sets: [{ data: [{ id: "policy-set-1", is_active: true, created_at: "2026-01-01T00:00:00Z" }] }],
    conference_order_items: [
      { data: [{ quantity: 1, unit_price_cents: 29_900, offer: { name: "Full Conference Registration" } }] },
    ],
    // 1: insert the invoices row  2: read the hosted URL back
    invoices: [{ data: { id: "inv-1" } }, { data: { hosted_invoice_url: "https://pay.stripe.test/inv-1" } }],
    // 1: link invoice_id  2: clear the reservation hold
    conference_orders: [{ data: null, error: null }, { data: null, error: null }],
  };
}

const ORDER_RPC = {
  create_conference_order_from_cart: { data: { id: "order-1", currency: "CAD" } },
  mint_v3_for_order: { data: 1, error: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthenticatedMock.mockResolvedValue({
    ok: true,
    ctx: { userId: "staff-1", userEmail: "desk@campusstores.ca", globalRole: "member", activeOrgIds: ["org-1"] },
  });
  requireConferenceOpsAccessMock.mockResolvedValue({ ok: true });
  isGlobalAdminMock.mockReturnValue(false);
  canBuyMock.mockReturnValue({ ok: true });
  priceForTierMock.mockReturnValue(29_900);
  availabilityMock.mockReturnValue({ remaining: null, soldOut: false });
  logAuditEventSafeMock.mockResolvedValue(undefined);
  resolveConferenceOrderTaxRatesMock.mockResolvedValue({
    conferenceRatePct: 13,
    membershipRatePct: 5,
    conferenceStripeTaxRateId: "txr_conference_test",
    membershipStripeTaxRateId: "txr_membership_test",
  });
  ensureStripeCustomerMock.mockResolvedValue("cus_test_1");
  stripeInvoiceCreateMock.mockResolvedValue({ id: "in_test_1" });
  stripeInvoiceItemCreateMock.mockResolvedValue({ id: "ii_test_1" });
  stripeInvoiceRetrieveMock.mockResolvedValue({ id: "in_test_1", subtotal: 29_900, total: 33_787 });
  finalizeAndSendInvoiceMock.mockResolvedValue({ success: true });
});

describe("invoicing at the desk — who may, and what it grants", () => {
  it("⛔ refuses a non-staff caller before anything is written", async () => {
    // An org admin buying for their OWN org passes assertUserCanManageOrg. The
    // deferral decision is a separate right, and this is a server action whose
    // arguments are attacker-controlled from the public cart page.
    requireConferenceOpsAccessMock.mockResolvedValue({ ok: false, error: "nope" });
    const { db, rpc } = makeFakeDb(invoiceQueues(), ORDER_RPC);
    createAdminClientMock.mockReturnValue(db);

    const result = await createConferenceCheckout(INVOICE_INPUT);

    expect(result).toEqual({
      success: false,
      error: "Invoicing is only available to conference staff.",
    });
    // ⚠️ Refused BEFORE the cart becomes an order — otherwise the refusal
    // strands a pending order holding inventory for the reservation window.
    expect(rpc).not.toHaveBeenCalledWith("create_conference_order_from_cart", expect.anything());
    expect(stripeInvoiceCreateMock).not.toHaveBeenCalled();
  });

  it("mints the entitlement when the invoice is sent, not when it is paid", async () => {
    // ⛔ This is the badge. The seat has to exist while the person is still at
    // the desk, not up to 30 days later when the company pays.
    const { db, rpc } = makeFakeDb(invoiceQueues(), ORDER_RPC);
    createAdminClientMock.mockReturnValue(db);

    const result = await createConferenceCheckout(INVOICE_INPUT);

    expect(result.success).toBe(true);
    expect(rpc).toHaveBeenCalledWith("mint_v3_for_order", { p_order_id: "order-1" });
    // ⚠️ And ONLY the v3 mint — the order stays honestly unpaid. Flipping it to
    // paid here would book money nobody has received.
    expect(rpc).not.toHaveBeenCalledWith("process_conference_order_paid", expect.anything());
  });

  it("⛔ releases the reservation hold, so the expiry cron cannot cancel it", async () => {
    // The Ambassador failure: expireStalePendingConferenceOrders cancels any
    // 'pending' order past expires_at. `.lt("expires_at", now)` excludes NULLs,
    // so null — not a far-future date — is both the fix and the honest value.
    const { db, recorded } = makeFakeDb(invoiceQueues(), ORDER_RPC);
    createAdminClientMock.mockReturnValue(db);

    await createConferenceCheckout(INVOICE_INPUT);

    const updates = callsFor(recorded, "conference_orders")
      .filter((c) => c.method === "update")
      .map((c) => c.args[0]);
    expect(updates).toContainEqual(expect.objectContaining({ expires_at: null }));
  });

  it("surfaces a mint failure instead of reporting the invoice as clean", async () => {
    // An invoice that went out while the seat did not mint is the one state
    // nobody can see from the outside — it must not return success.
    const { db } = makeFakeDb(invoiceQueues(), {
      ...ORDER_RPC,
      mint_v3_for_order: { data: null, error: { message: "boom" } },
    });
    createAdminClientMock.mockReturnValue(db);

    const result = await createConferenceCheckout(INVOICE_INPUT);

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("did not mint") });
  });
});
