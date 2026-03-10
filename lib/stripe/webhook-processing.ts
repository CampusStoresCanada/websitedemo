import Stripe from "stripe";
import { transitionMembershipState } from "@/lib/membership/state-machine";
import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminClient = ReturnType<typeof createAdminClient>;

export interface EventProcessingContext {
  conferenceOrderId: string | null;
}

export const HANDLED_STRIPE_WEBHOOK_EVENTS = new Set([
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
]);

export function isHandledStripeWebhookEvent(type: string): boolean {
  return HANDLED_STRIPE_WEBHOOK_EVENTS.has(type);
}

/**
 * Extract a string field from the raw event object.
 * Newer Stripe API versions may move or remove certain fields from
 * typed interfaces while still including them in webhook payloads.
 */
function extractStringField(
  obj: Record<string, unknown>,
  field: string
): string | null {
  const val = obj[field];
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && "id" in val) {
    return (val as { id: string }).id;
  }
  return null;
}

export function extractConferenceOrderIdFromStripeEvent(
  event: Stripe.Event
): string | null {
  const raw = event.data.object as unknown as Record<string, unknown>;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return session.metadata?.conference_order_id ?? null;
  }

  if (event.type === "charge.refunded") {
    if (raw.metadata && typeof raw.metadata === "object") {
      const value = (raw.metadata as Record<string, unknown>).conference_order_id;
      return typeof value === "string" ? value : null;
    }
  }

  return null;
}

export async function recordConferenceWebhookEvent(params: {
  db: AdminClient;
  event: Stripe.Event;
  conferenceOrderId: string | null;
  success: boolean;
  errorMessage?: string;
}) {
  const shouldRecord =
    params.conferenceOrderId !== null ||
    params.event.type === "checkout.session.completed" ||
    params.event.type === "charge.refunded";

  if (!shouldRecord) return;

  await params.db.from("conference_webhook_events").upsert({
    stripe_event_id: params.event.id,
    event_type: params.event.type,
    conference_order_id: params.conferenceOrderId,
    success: params.success,
    error_message: params.errorMessage ?? null,
    processed_at: new Date().toISOString(),
  });
}

export async function processStripeWebhookEvent(
  event: Stripe.Event,
  db: AdminClient
): Promise<EventProcessingContext> {
  const rawObject = event.data.object as unknown as Record<string, unknown>;

  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutSessionCompleted(
        event.data.object as Stripe.Checkout.Session,
        rawObject,
        db
      );
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice, rawObject, db);
      return { conferenceOrderId: null };
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, db);
      return { conferenceOrderId: null };
    case "charge.refunded":
      return handleChargeRefunded(event.data.object as Stripe.Charge, db);
    default:
      return { conferenceOrderId: null };
  }
}

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  raw: Record<string, unknown>,
  db: AdminClient
): Promise<EventProcessingContext> {
  const conferenceOrderId = session.metadata?.conference_order_id ?? null;
  const checkoutKind = session.metadata?.checkout_kind ?? null;
  const paymentIntentId = extractStringField(raw, "payment_intent");

  if (checkoutKind === "conference" && conferenceOrderId) {
    const { error: conferenceOrderError } = await db.rpc("process_conference_order_paid", {
      p_order_id: conferenceOrderId,
      p_checkout_session_id: session.id,
      p_payment_intent_id: paymentIntentId ?? undefined,
    });

    if (conferenceOrderError) {
      throw new Error(
        `Failed to mark conference order as paid (${conferenceOrderId}): ${conferenceOrderError.message}`
      );
    }

    const conferenceId = session.metadata?.conference_id;
    const orgId = session.metadata?.organization_id;
    const userId = session.metadata?.user_id;
    if (conferenceId && orgId && userId) {
      const { error: cartClearError } = await db
        .from("cart_items")
        .delete()
        .eq("conference_id", conferenceId)
        .eq("organization_id", orgId)
        .eq("user_id", userId);

      if (cartClearError) {
        console.error(
          `Failed to clear cart after conference payment (order ${conferenceOrderId}): ${cartClearError.message}`
        );
      }
    }

    return { conferenceOrderId };
  }

  const orgId = session.metadata?.org_id;
  if (!orgId) {
    console.warn("checkout.session.completed: no org_id in metadata");
    return { conferenceOrderId };
  }

  const stripeInvoiceId = extractStringField(raw, "invoice");

  if (stripeInvoiceId) {
    await db
      .from("invoices")
      .update({
        status: "paid",
        payment_source: "stripe",
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_invoice_id", stripeInvoiceId);
  }

  const { data: org } = await db
    .from("organizations")
    .select("membership_status")
    .eq("id", orgId)
    .single();

  if (org) {
    const status = org.membership_status as string;
    if (status === "approved" || status === "grace" || status === "locked") {
      const newStatus = status === "locked" ? "reactivated" : "active";
      await transitionMembershipState(
        orgId,
        newStatus as "active" | "reactivated",
        "stripe_webhook",
        null,
        "Payment received via checkout session"
      );
    }
  }

  return { conferenceOrderId: null };
}

async function handleInvoicePaid(
  stripeInvoice: Stripe.Invoice,
  raw: Record<string, unknown>,
  db: AdminClient
) {
  const orgId = stripeInvoice.metadata?.org_id;

  if (stripeInvoice.id) {
    const chargeId = extractStringField(raw, "charge");
    const paymentIntentId = extractStringField(raw, "payment_intent");

    await db
      .from("invoices")
      .update({
        status: "paid",
        payment_source: "stripe",
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntentId,
        stripe_charge_id: chargeId,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_invoice_id", stripeInvoice.id);
  }

  if (orgId) {
    const { data: org } = await db
      .from("organizations")
      .select("membership_status")
      .eq("id", orgId)
      .single();

    if (org?.membership_status === "grace") {
      await transitionMembershipState(
        orgId,
        "active",
        "stripe_webhook",
        null,
        "Renewal payment received"
      );
    }
  }
}

async function handleInvoicePaymentFailed(
  stripeInvoice: Stripe.Invoice,
  db: AdminClient
) {
  const orgId = stripeInvoice.metadata?.org_id;

  if (stripeInvoice.id) {
    const { data: localInvoice } = await db
      .from("invoices")
      .select("id, status, payment_source, paid_out_of_band_at")
      .eq("stripe_invoice_id", stripeInvoice.id)
      .maybeSingle();

    if (localInvoice) {
      if (
        localInvoice.paid_out_of_band_at ||
        localInvoice.payment_source === "quickbooks" ||
        localInvoice.payment_source === "manual"
      ) {
        console.info(
          `invoice.payment_failed: skipped — invoice ${localInvoice.id} already paid out-of-band`
        );
        return;
      }

      await db
        .from("invoices")
        .update({
          status: "pending_settlement",
          updated_at: new Date().toISOString(),
        })
        .eq("id", localInvoice.id);
    }
  }

  if (orgId) {
    const { data: org } = await db
      .from("organizations")
      .select("membership_status")
      .eq("id", orgId)
      .single();

    if (org?.membership_status === "active") {
      await transitionMembershipState(
        orgId,
        "grace",
        "stripe_webhook",
        null,
        "Renewal payment failed"
      );
    }
  }
}

async function handleChargeRefunded(
  charge: Stripe.Charge,
  db: AdminClient
): Promise<EventProcessingContext> {
  const chargeMetadataOrderId = charge.metadata?.conference_order_id ?? null;
  if (chargeMetadataOrderId) {
    const { error: conferenceRefundError } = await db.rpc("process_conference_order_refund", {
      p_order_id: chargeMetadataOrderId,
      p_refund_amount_cents: charge.amount_refunded,
    });

    if (conferenceRefundError) {
      throw new Error(
        `Failed to update conference order refund (${chargeMetadataOrderId}): ${conferenceRefundError.message}`
      );
    }

    return { conferenceOrderId: chargeMetadataOrderId };
  }

  const { data: localInvoice } = await db
    .from("invoices")
    .select("id, total_cents, status")
    .eq("stripe_charge_id", charge.id)
    .maybeSingle();

  if (!localInvoice) {
    if (charge.payment_intent) {
      const piId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent.id;

      const { data: invoiceByPi } = await db
        .from("invoices")
        .select("id, total_cents, status")
        .eq("stripe_payment_intent_id", piId)
        .maybeSingle();

      if (invoiceByPi) {
        await processRefundUpdate(invoiceByPi, charge, db);
        return { conferenceOrderId: null };
      }
    }

    console.warn(`charge.refunded: no local invoice found for charge ${charge.id}`);
    return { conferenceOrderId: null };
  }

  await processRefundUpdate(localInvoice, charge, db);
  return { conferenceOrderId: null };
}

async function processRefundUpdate(
  localInvoice: { id: string; total_cents: number; status: string },
  charge: Stripe.Charge,
  db: AdminClient
) {
  const refundedAmount = charge.amount_refunded;
  const isFullRefund = refundedAmount >= localInvoice.total_cents;

  await db
    .from("invoices")
    .update({
      status: isFullRefund ? "refunded_full" : "refunded_partial",
      refunded_at: new Date().toISOString(),
      refund_amount_cents: refundedAmount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", localInvoice.id);
}

export function toWebhookPayloadJson(event: Stripe.Event): Json {
  return JSON.parse(JSON.stringify(event.data.object)) as Json;
}
