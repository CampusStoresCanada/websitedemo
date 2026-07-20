import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

/**
 * Phase 0 characterization tests for the conference money path
 * (docs/CONFERENCE_V2_BLUEPRINT.md).
 *
 * These pin the current behavior of the webhook → process_conference_order_paid
 * seam before Phase 3 extends it to mint grant balances. If a test here breaks,
 * the payment contract changed — make sure that was intentional.
 */

const {
  transitionMembershipStateMock,
  enqueueQBExportMock,
  createAdminClientMock,
  stripeInvoicesRetrieveMock,
  stripeInvoicesVoidInvoiceMock,
  stripeInvoicesDelMock,
  resolveAssigneeForEmailMock,
  findExistingUserByEmailMock,
} = vi.hoisted(() => ({
  transitionMembershipStateMock: vi.fn(),
  enqueueQBExportMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  stripeInvoicesRetrieveMock: vi.fn(),
  stripeInvoicesVoidInvoiceMock: vi.fn(),
  stripeInvoicesDelMock: vi.fn(),
  resolveAssigneeForEmailMock: vi.fn(),
  findExistingUserByEmailMock: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  parseUTC: (s: string) => new Date(s),
}));
vi.mock("@/lib/membership/state-machine", () => ({
  transitionMembershipState: transitionMembershipStateMock,
}));
vi.mock("@/lib/quickbooks/export", () => ({
  enqueueQBExport: enqueueQBExportMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
// lib/membership/renewal-activation.ts (pulled in unmocked by this suite via
// handleInvoicePaid) imports the real stripe client to void pending renewal
// invoices — mock it here rather than requiring STRIPE_SECRET_KEY in tests.
vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    invoices: {
      retrieve: stripeInvoicesRetrieveMock,
      voidInvoice: stripeInvoicesVoidInvoiceMock,
      del: stripeInvoicesDelMock,
    },
  },
}));
// lib/actions/conference-people.ts / conference-entity-commerce.ts (pulled in
// unmocked by mintRegistrationAttendeesFromOrder) import @/lib/auth/guards
// etc. — mock the two functions actually used rather than requiring auth
// context in these webhook tests.
vi.mock("@/lib/actions/conference-people", () => ({
  resolveAssigneeForEmail: resolveAssigneeForEmailMock,
}));
vi.mock("@/lib/actions/conference-entity-commerce", () => ({
  findExistingUserByEmail: findExistingUserByEmailMock,
}));
// lib/comms/conference-triggers.ts pulls in the real comms send chain
// (@/lib/email/send etc.) — stub the one entry point these webhook tests
// exercise rather than exercising real email sending. Mocked by relative
// path (not "@/...") since only relative specifiers reliably resolve to
// the same module identity as the "../comms/conference-triggers" imports
// used from lib/conference/registration-mint.ts and this file's own
// webhook-processing.ts — see note above on the @/ alias resolver.
vi.mock("../../comms/conference-triggers", () => ({
  triggerConferenceRegistrationConfirmation: vi.fn(),
  triggerConferencePaymentConfirmation: vi.fn(),
}));

import {
  extractConferenceOrderIdFromStripeEvent,
  isHandledStripeWebhookEvent,
  processStripeWebhookEvent,
  recordConferenceWebhookEvent,
} from "../webhook-processing";
import { makeFakeDb } from "../../test/fake-supabase";

function checkoutSessionEvent(overrides: {
  metadata?: Record<string, string>;
  payment_intent?: unknown;
  eventId?: string;
}): Stripe.Event {
  return {
    id: overrides.eventId ?? "evt_test_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        metadata: overrides.metadata ?? {},
        payment_intent: overrides.payment_intent ?? null,
      },
    },
  } as unknown as Stripe.Event;
}

function chargeRefundedEvent(overrides: {
  metadata?: Record<string, string>;
  amountRefunded?: number;
  paymentIntent?: unknown;
}): Stripe.Event {
  return {
    id: "evt_refund_1",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_test_1",
        metadata: overrides.metadata ?? {},
        amount_refunded: overrides.amountRefunded ?? 0,
        payment_intent: overrides.paymentIntent ?? null,
      },
    },
  } as unknown as Stripe.Event;
}

const CONFERENCE_METADATA = {
  checkout_kind: "conference",
  conference_order_id: "order-1",
  conference_id: "conf-1",
  organization_id: "org-1",
  user_id: "user-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Event routing helpers
// ---------------------------------------------------------------------------

describe("isHandledStripeWebhookEvent", () => {
  it("handles exactly the four money-path event types", () => {
    expect(isHandledStripeWebhookEvent("checkout.session.completed")).toBe(true);
    expect(isHandledStripeWebhookEvent("invoice.paid")).toBe(true);
    expect(isHandledStripeWebhookEvent("invoice.payment_failed")).toBe(true);
    expect(isHandledStripeWebhookEvent("charge.refunded")).toBe(true);
    expect(isHandledStripeWebhookEvent("payment_intent.succeeded")).toBe(false);
    expect(isHandledStripeWebhookEvent("customer.created")).toBe(false);
  });
});

describe("extractConferenceOrderIdFromStripeEvent", () => {
  it("reads conference_order_id from checkout session metadata", () => {
    const event = checkoutSessionEvent({ metadata: { conference_order_id: "order-9" } });
    expect(extractConferenceOrderIdFromStripeEvent(event)).toBe("order-9");
  });

  it("returns null for checkout sessions without conference metadata", () => {
    const event = checkoutSessionEvent({ metadata: {} });
    expect(extractConferenceOrderIdFromStripeEvent(event)).toBeNull();
  });

  it("reads conference_order_id from refunded charge metadata", () => {
    const event = chargeRefundedEvent({ metadata: { conference_order_id: "order-7" } });
    expect(extractConferenceOrderIdFromStripeEvent(event)).toBe("order-7");
  });

  it("returns null for other event types", () => {
    const event = {
      id: "evt_x",
      type: "invoice.paid",
      data: { object: { metadata: { conference_order_id: "order-7" } } },
    } as unknown as Stripe.Event;
    expect(extractConferenceOrderIdFromStripeEvent(event)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Conference order paid: webhook → process_conference_order_paid RPC
// ---------------------------------------------------------------------------

describe("processStripeWebhookEvent — checkout.session.completed (conference)", () => {
  it("marks the order paid via RPC with session + payment intent ids, then clears the cart", async () => {
    const { db, rpc, recorded } = makeFakeDb();
    const event = checkoutSessionEvent({
      metadata: CONFERENCE_METADATA,
      payment_intent: "pi_test_1",
    });

    const context = await processStripeWebhookEvent(event, db as never);

    expect(rpc).toHaveBeenCalledExactlyOnceWith("process_conference_order_paid", {
      p_order_id: "order-1",
      p_checkout_session_id: "cs_test_1",
      p_payment_intent_id: "pi_test_1",
    });
    expect(context).toEqual({ conferenceOrderId: "order-1" });

    const cartDelete = recorded.find((entry) => entry.table === "cart_items");
    expect(cartDelete).toBeDefined();
    expect(cartDelete!.calls.map((call) => call.method)).toEqual(["delete", "eq", "eq", "eq"]);
    expect(cartDelete!.calls.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
      ["conference_id", "conf-1"],
      ["organization_id", "org-1"],
      ["user_id", "user-1"],
    ]);
  });

  it("extracts the payment intent id when Stripe sends an expanded object", async () => {
    const { db, rpc } = makeFakeDb();
    const event = checkoutSessionEvent({
      metadata: CONFERENCE_METADATA,
      payment_intent: { id: "pi_expanded_1" },
    });

    await processStripeWebhookEvent(event, db as never);

    expect(rpc).toHaveBeenCalledWith(
      "process_conference_order_paid",
      expect.objectContaining({ p_payment_intent_id: "pi_expanded_1" })
    );
  });

  it("passes undefined payment intent when the session has none", async () => {
    const { db, rpc } = makeFakeDb();
    const event = checkoutSessionEvent({ metadata: CONFERENCE_METADATA, payment_intent: null });

    await processStripeWebhookEvent(event, db as never);

    expect(rpc).toHaveBeenCalledWith(
      "process_conference_order_paid",
      expect.objectContaining({ p_payment_intent_id: undefined })
    );
  });

  it("throws when the paid RPC fails so the webhook retries", async () => {
    const { db } = makeFakeDb(
      {},
      { process_conference_order_paid: { error: { message: "ORDER_NOT_FOUND:order-1" } } }
    );
    const event = checkoutSessionEvent({ metadata: CONFERENCE_METADATA });

    await expect(processStripeWebhookEvent(event, db as never)).rejects.toThrow(
      /order-1.*ORDER_NOT_FOUND|ORDER_NOT_FOUND/
    );
  });

  it("still succeeds when cart clearing fails (cart cleanup is best-effort)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = makeFakeDb({
      cart_items: [{ error: { message: "boom" } }],
    });
    const event = checkoutSessionEvent({ metadata: CONFERENCE_METADATA });

    const context = await processStripeWebhookEvent(event, db as never);

    expect(context).toEqual({ conferenceOrderId: "order-1" });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("skips cart clearing when conference/org/user metadata is incomplete", async () => {
    const { db, rpc, from } = makeFakeDb();
    const event = checkoutSessionEvent({
      metadata: {
        checkout_kind: "conference",
        conference_order_id: "order-1",
        // conference_id / organization_id / user_id missing
      },
    });

    const context = await processStripeWebhookEvent(event, db as never);

    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalledWith("cart_items");
    expect(context).toEqual({ conferenceOrderId: "order-1" });
  });

  it("routes event-ticket checkouts away from the conference RPC", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, rpc } = makeFakeDb();
    // Incomplete event-ticket metadata → handler logs and returns early.
    const event = checkoutSessionEvent({ metadata: { source: "event_ticket" } });

    const context = await processStripeWebhookEvent(event, db as never);

    expect(rpc).not.toHaveBeenCalled();
    expect(context).toEqual({ conferenceOrderId: null });
    consoleError.mockRestore();
  });

  it("does NOT process the order when checkout_kind is missing, even with an order id present", async () => {
    // Characterization: without checkout_kind=conference the handler falls through
    // to the membership path but still surfaces the order id in its context.
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, rpc } = makeFakeDb();
    const event = checkoutSessionEvent({
      metadata: { conference_order_id: "order-1" },
    });

    const context = await processStripeWebhookEvent(event, db as never);

    expect(rpc).not.toHaveBeenCalled();
    expect(context).toEqual({ conferenceOrderId: "order-1" });
    consoleWarn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Conference order refunded: webhook → process_conference_order_refund RPC
// ---------------------------------------------------------------------------

describe("processStripeWebhookEvent — charge.refunded (conference)", () => {
  it("forwards the refunded amount to the refund RPC", async () => {
    const { db, rpc } = makeFakeDb();
    const event = chargeRefundedEvent({
      metadata: { conference_order_id: "order-5" },
      amountRefunded: 12_345,
    });

    const context = await processStripeWebhookEvent(event, db as never);

    expect(rpc).toHaveBeenCalledExactlyOnceWith("process_conference_order_refund", {
      p_order_id: "order-5",
      p_refund_amount_cents: 12_345,
    });
    expect(context).toEqual({ conferenceOrderId: "order-5" });
  });

  it("throws when the refund RPC fails so the webhook retries", async () => {
    const { db } = makeFakeDb(
      {},
      { process_conference_order_refund: { error: { message: "no such order" } } }
    );
    const event = chargeRefundedEvent({ metadata: { conference_order_id: "order-5" } });

    await expect(processStripeWebhookEvent(event, db as never)).rejects.toThrow(/order-5/);
  });

  it("falls back to invoice lookup for non-conference refunds", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, rpc } = makeFakeDb({
      invoices: [{ data: null }],
    });
    const event = chargeRefundedEvent({ metadata: {}, amountRefunded: 100 });

    const context = await processStripeWebhookEvent(event, db as never);

    expect(rpc).not.toHaveBeenCalled();
    expect(context).toEqual({ conferenceOrderId: null });
    consoleWarn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// conference_webhook_events audit recording
// ---------------------------------------------------------------------------

describe("recordConferenceWebhookEvent", () => {
  it("records success rows for conference orders", async () => {
    const { db, recorded } = makeFakeDb();
    const event = checkoutSessionEvent({ metadata: CONFERENCE_METADATA, eventId: "evt_rec_1" });

    await recordConferenceWebhookEvent({
      db: db as never,
      event,
      conferenceOrderId: "order-1",
      success: true,
    });

    const row = recorded.find((entry) => entry.table === "conference_webhook_events");
    expect(row).toBeDefined();
    const upsert = row!.calls.find((call) => call.method === "upsert");
    expect(upsert!.args[0]).toMatchObject({
      stripe_event_id: "evt_rec_1",
      event_type: "checkout.session.completed",
      conference_order_id: "order-1",
      success: true,
      error_message: null,
    });
  });

  it("records failures with the error message", async () => {
    const { db, recorded } = makeFakeDb();
    const event = chargeRefundedEvent({ metadata: { conference_order_id: "order-5" } });

    await recordConferenceWebhookEvent({
      db: db as never,
      event,
      conferenceOrderId: "order-5",
      success: false,
      errorMessage: "RPC exploded",
    });

    const row = recorded.find((entry) => entry.table === "conference_webhook_events");
    const upsert = row!.calls.find((call) => call.method === "upsert");
    expect(upsert!.args[0]).toMatchObject({
      conference_order_id: "order-5",
      success: false,
      error_message: "RPC exploded",
    });
  });

  it("records checkout/refund events even without a resolved order id", async () => {
    const { db, from } = makeFakeDb();
    const event = checkoutSessionEvent({ metadata: {} });

    await recordConferenceWebhookEvent({
      db: db as never,
      event,
      conferenceOrderId: null,
      success: true,
    });

    expect(from).toHaveBeenCalledWith("conference_webhook_events");
  });

  it("skips recording for unrelated events without an order id", async () => {
    const { db, from } = makeFakeDb();
    const event = {
      id: "evt_inv",
      type: "invoice.paid",
      data: { object: {} },
    } as unknown as Stripe.Event;

    await recordConferenceWebhookEvent({
      db: db as never,
      event,
      conferenceOrderId: null,
      success: true,
    });

    expect(from).not.toHaveBeenCalled();
  });
});
