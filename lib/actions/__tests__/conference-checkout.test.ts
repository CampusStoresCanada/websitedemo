import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization tests for the conference money path
 * (docs/CONFERENCE_V2_BLUEPRINT.md).
 *
 * createConferenceCheckout is the producer side of the checkout ↔ webhook
 * contract: the Stripe session metadata it writes (checkout_kind,
 * conference_order_id, conference_id, organization_id, user_id) is exactly
 * what lib/stripe/webhook-processing.ts consumes to mark orders paid and
 * clear carts. These tests pin that contract for the v3 Offers-only checkout.
 */

const {
  requireAuthenticatedMock,
  isGlobalAdminMock,
  createAdminClientMock,
  stripeSessionCreateMock,
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
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  stripeSessionCreateMock: vi.fn(),
  logAuditEventSafeMock: vi.fn(),
  canBuyMock: vi.fn(),
  priceForTierMock: vi.fn(),
  availabilityMock: vi.fn(),
  transitionMembershipStateMock: vi.fn(),
  getPartnershipRateCentsMock: vi.fn(),
  applyProrationMock: vi.fn((baseAmountCents: number) => ({ amountCents: baseAmountCents, discountPct: 0 })),
  resolveAssigneeForEmailMock: vi.fn(),
  findExistingUserByEmailMock: vi.fn(),
  resolveConferenceOrderTaxRatesMock: vi.fn(async () => ({
    conferenceRatePct: 13,
    membershipRatePct: 5,
    conferenceStripeTaxRateId: "txr_conference_test",
    membershipStripeTaxRateId: "txr_membership_test",
  })),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: requireAuthenticatedMock,
  isGlobalAdmin: isGlobalAdminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: { checkout: { sessions: { create: stripeSessionCreateMock } } },
}));
// Conference lines are taxed where the conference is, membership lines where
// the buyer is — checkout resolves both up front. Mocked rather than exercised
// here: the real resolver reads app_settings and calls Stripe's tax rate API.
vi.mock("@/lib/stripe/tax", () => ({
  resolveConferenceOrderTaxRates: resolveConferenceOrderTaxRatesMock,
}));
vi.mock("@/lib/ops/audit", () => ({
  logAuditEventSafe: logAuditEventSafeMock,
}));
// lib/membership/renewal-activation.ts (pulled in unmocked via the new
// membership-gate pricing helper in conference-commerce.ts) imports this —
// mock it here rather than requiring @/lib/supabase/server to resolve for real.
vi.mock("@/lib/membership/state-machine", () => ({
  transitionMembershipState: transitionMembershipStateMock,
}));
// lib/stripe/billing.ts transitively imports the real Stripe client via a
// relative path an alias-keyed mock can't intercept — mock the whole module.
vi.mock("@/lib/stripe/billing", () => ({
  getPartnershipRateCents: getPartnershipRateCentsMock,
  applyProration: applyProrationMock,
}));
// conference-commerce imports this pure module via a relative path; vitest has
// no "@/" alias, so the mock must use the same relative specifier (resolved from
// this test file) to intercept it. See project notes on the test setup.
vi.mock("../../conference/entity-pricing", () => ({
  canBuy: canBuyMock,
  priceForTier: priceForTierMock,
  availability: availabilityMock,
}));
// lib/actions/conference-people.ts / conference-entity-commerce.ts (pulled in
// unmocked via devCompleteConferenceCheckout's mintRegistrationAttendeesFromOrder
// call) import @/lib/auth/guards etc. — mock the two functions actually used
// rather than requiring auth context in these checkout tests.
vi.mock("@/lib/actions/conference-people", () => ({
  resolveAssigneeForEmail: resolveAssigneeForEmailMock,
}));
vi.mock("@/lib/actions/conference-entity-commerce", () => ({
  findExistingUserByEmail: findExistingUserByEmailMock,
}));
// registration-mint.ts (pulled in via dev-checkout's mint path) imports the
// real comms send chain — stub it rather than exercising real email sending.
vi.mock("../../comms/conference-triggers", () => ({
  triggerConferenceRegistrationConfirmation: vi.fn(),
  triggerConferencePaymentConfirmation: vi.fn(),
}));

import { createConferenceCheckout } from "../conference-commerce";
import { makeFakeDb, type QueryResult } from "../../test/fake-supabase";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INPUT = {
  conferenceId: "conf-1",
  organizationId: "org-1",
  successUrl: "https://example.test/success",
  cancelUrl: "https://example.test/cancel",
};

const OFFER_CART_ROW = {
  id: "cart-1",
  quantity: 1,
  offer_entity_id: "offer-1",
};

const OFFER_ENTITY_ROW = {
  id: "offer-1",
  kind: "delegate_pass",
  name: "Delegate Pass",
  price_cents: 50_000,
  currency: "CAD",
  inventory: null,
  tier_prices: {},
};

function happyPathQueues(): Record<string, QueryResult[]> {
  return {
    cart_items: [{ data: [OFFER_CART_ROW] }],
    conference_entities: [{ data: [OFFER_ENTITY_ROW] }],
    conference_entity_refs: [{ data: [] }], // no `who` audience restrictions
    conference_instances: [{ data: { tax_rate_pct: 13, stripe_tax_rate_id: "txr_test", status: "registration_open" } }],
    organizations: [{ data: { type: "Member" } }],
    // loadBuyerTier's resolveConferenceTier(org.type, programs) call chain
    // (Phase 2.3) reads getProgramsConfig() -> getEffectivePolicies(), which
    // requires an active policy_sets row to exist at all -- policy_values
    // itself can stay unmocked/empty, since getProgramsConfig() falls back
    // to its own hardcoded Member/Vendor Partner defaults when unseeded.
    policy_sets: [{ data: [{ id: "policy-set-1", is_active: true, created_at: "2026-01-01T00:00:00Z" }] }],
    conference_order_items: [
      {
        // offer line items for the Stripe session
        data: [
          {
            quantity: 1,
            unit_price_cents: 50_000,
            offer: { name: "Delegate Pass" },
          },
        ],
      },
    ],
    conference_orders: [{ data: null, error: null }], // session id update
  };
}

const ORDER_RPC_RESULT = {
  create_conference_order_from_cart: {
    data: { id: "order-1", currency: "CAD" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  requireAuthenticatedMock.mockResolvedValue({
    ok: true,
    ctx: {
      userId: "user-1",
      userEmail: "buyer@example.test",
      globalRole: "member",
      activeOrgIds: ["org-1"],
    },
  });
  isGlobalAdminMock.mockReturnValue(false);
  canBuyMock.mockReturnValue({ ok: true });
  priceForTierMock.mockReturnValue(50_000);
  availabilityMock.mockReturnValue({ remaining: null, soldOut: false });
  logAuditEventSafeMock.mockResolvedValue(undefined);
  resolveConferenceOrderTaxRatesMock.mockResolvedValue({
    conferenceRatePct: 13,
    membershipRatePct: 5,
    conferenceStripeTaxRateId: "txr_conference_test",
    membershipStripeTaxRateId: "txr_membership_test",
  });
  stripeSessionCreateMock.mockResolvedValue({
    id: "cs_test_1",
    url: "https://checkout.stripe.test/cs_test_1",
  });
});

// ---------------------------------------------------------------------------
// The checkout ↔ webhook metadata contract
// ---------------------------------------------------------------------------

describe("createConferenceCheckout — contract with the Stripe webhook", () => {
  it("creates the order via RPC and stamps conference metadata on session AND payment intent", async () => {
    const { db, rpc } = makeFakeDb(happyPathQueues(), ORDER_RPC_RESULT);
    createAdminClientMock.mockReturnValue(db);

    const result = await createConferenceCheckout(INPUT);

    expect(result).toEqual({
      success: true,
      data: {
        checkoutUrl: "https://checkout.stripe.test/cs_test_1",
        orderId: "order-1",
        checkoutSessionId: "cs_test_1",
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      "create_conference_order_from_cart",
      expect.objectContaining({
        p_user_id: "user-1",
        p_organization_id: "org-1",
        p_conference_id: "conf-1",
        p_tax_rate_pct: 13,
        p_currency: "CAD",
        p_offer_prices: { "offer-1": 50_000 },
      })
    );

    // The metadata the webhook depends on must be present in BOTH places:
    // session metadata (checkout.session.completed) and payment intent
    // metadata (charge.refunded).
    const expectedMetadata = {
      checkout_kind: "conference",
      conference_id: "conf-1",
      conference_order_id: "order-1",
      organization_id: "org-1",
      user_id: "user-1",
    };
    expect(stripeSessionCreateMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        mode: "payment",
        success_url: INPUT.successUrl,
        cancel_url: INPUT.cancelUrl,
        client_reference_id: "order-1",
        metadata: expectedMetadata,
        payment_intent_data: { metadata: expectedMetadata },
      })
    );
  });

  it("builds Stripe line items from offer order items with the conference tax rate", async () => {
    const { db } = makeFakeDb(happyPathQueues(), ORDER_RPC_RESULT);
    createAdminClientMock.mockReturnValue(db);

    await createConferenceCheckout(INPUT);

    const sessionArgs = stripeSessionCreateMock.mock.calls[0][0];
    expect(sessionArgs.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: 50_000,
          product_data: { name: "Delegate Pass" },
        },
        tax_rates: ["txr_conference_test"],
      },
    ]);
  });

  it("omits Stripe tax rates when resolveConferenceOrderTaxRates has no Stripe tax rate id for this line", async () => {
    resolveConferenceOrderTaxRatesMock.mockResolvedValue({
      conferenceRatePct: 13,
      membershipRatePct: 5,
      conferenceStripeTaxRateId: null,
      membershipStripeTaxRateId: "txr_membership_test",
    });
    const { db } = makeFakeDb(happyPathQueues(), ORDER_RPC_RESULT);
    createAdminClientMock.mockReturnValue(db);

    await createConferenceCheckout(INPUT);

    const sessionArgs = stripeSessionCreateMock.mock.calls[0][0];
    expect(sessionArgs.line_items[0]).not.toHaveProperty("tax_rates");
  });

  it("persists the Stripe session id back onto the order", async () => {
    const { db, recorded } = makeFakeDb(happyPathQueues(), ORDER_RPC_RESULT);
    createAdminClientMock.mockReturnValue(db);

    await createConferenceCheckout(INPUT);

    const orderUpdate = recorded.find((entry) => entry.table === "conference_orders");
    expect(orderUpdate).toBeDefined();
    const update = orderUpdate!.calls.find((call) => call.method === "update");
    expect(update!.args[0]).toEqual({ stripe_checkout_session_id: "cs_test_1" });
    const eq = orderUpdate!.calls.find((call) => call.method === "eq");
    expect(eq!.args).toEqual(["id", "order-1"]);
  });
});

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

describe("createConferenceCheckout — guard rails", () => {
  it("rejects an empty cart before creating anything", async () => {
    const queues = happyPathQueues();
    queues.cart_items = [{ data: [] }];
    const { db, rpc } = makeFakeDb(queues, ORDER_RPC_RESULT);
    createAdminClientMock.mockReturnValue(db);

    const result = await createConferenceCheckout(INPUT);

    expect(result).toMatchObject({ success: false, code: "EMPTY_CART" });
    expect(rpc).not.toHaveBeenCalled();
    expect(stripeSessionCreateMock).not.toHaveBeenCalled();
  });

  it("rejects users outside the organization", async () => {
    requireAuthenticatedMock.mockResolvedValue({
      ok: true,
      ctx: {
        userId: "user-2",
        userEmail: null,
        globalRole: "member",
        activeOrgIds: ["other-org"],
      },
    });
    const { db, rpc } = makeFakeDb(happyPathQueues(), ORDER_RPC_RESULT);
    createAdminClientMock.mockReturnValue(db);

    const result = await createConferenceCheckout(INPUT);

    expect(result).toMatchObject({ success: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks checkout when an offer fails who-can-buy eligibility", async () => {
    canBuyMock.mockReturnValue({ ok: false, reason: "Members only." });
    const { db, rpc } = makeFakeDb(happyPathQueues(), ORDER_RPC_RESULT);
    createAdminClientMock.mockReturnValue(db);

    const result = await createConferenceCheckout(INPUT);

    expect(result).toMatchObject({ success: false, code: "INELIGIBLE" });
    expect((result as { error: string }).error).toContain("Delegate Pass");
    expect(rpc).not.toHaveBeenCalled();
    expect(stripeSessionCreateMock).not.toHaveBeenCalled();
  });

  it("surfaces order-creation RPC failures without creating a Stripe session", async () => {
    const { db } = makeFakeDb(happyPathQueues(), {
      create_conference_order_from_cart: {
        error: { message: "capacity exceeded", code: "P0001" },
      },
    });
    createAdminClientMock.mockReturnValue(db);

    const result = await createConferenceCheckout(INPUT);

    expect(result).toMatchObject({
      success: false,
      code: "P0001",
      error: "capacity exceeded",
    });
    expect(stripeSessionCreateMock).not.toHaveBeenCalled();
  });

  it("fails when Stripe returns no checkout URL", async () => {
    stripeSessionCreateMock.mockResolvedValue({ id: "cs_test_1", url: null });
    const { db } = makeFakeDb(happyPathQueues(), ORDER_RPC_RESULT);
    createAdminClientMock.mockReturnValue(db);

    const result = await createConferenceCheckout(INPUT);

    expect(result).toMatchObject({
      success: false,
      error: "Stripe checkout URL was not returned.",
    });
  });
});
