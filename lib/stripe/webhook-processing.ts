import Stripe from "stripe";
import { transitionMembershipState } from "@/lib/membership/state-machine";
import { enqueueQBExport } from "@/lib/quickbooks/export";
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

async function processEventTicketPurchase(
  session: Stripe.Checkout.Session,
  db: AdminClient
): Promise<void> {
  const { event_id, ticket_type_id, user_id } = session.metadata ?? {};
  if (!event_id || !ticket_type_id || !user_id) {
    console.error("[event-ticket webhook] missing metadata fields", session.metadata);
    return;
  }

  // Mark registration as paid
  const { error } = await db
    .from("event_registrations")
    .update({
      payment_status: "paid",
      stripe_session_id: session.id,
    })
    .eq("event_id", event_id)
    .eq("user_id", user_id);

  if (error) {
    throw new Error(`[event-ticket webhook] failed to mark registration paid: ${error.message}`);
  }

  // Send confirmation email + calendar invite — best effort
  void (async () => {
    try {
      const { data: event } = await db
        .from("events")
        .select("title, slug, starts_at, google_meet_link, google_event_id, is_virtual")
        .eq("id", event_id)
        .single() as { data: any };

      const { data: profile } = await db
        .from("profiles")
        .select("display_name")
        .eq("id", user_id)
        .maybeSingle();

      // Get email from auth (use admin API)
      const { data: userRecord } = await db.auth.admin.getUserById(user_id);
      const email = userRecord?.user?.email;
      if (!email || !event) return;

      const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

      // Google Calendar invite
      if (event.is_virtual && event.google_event_id) {
        const { addAttendeeToCalendarEvent } = await import("@/lib/google/calendar");
        addAttendeeToCalendarEvent(event.google_event_id, email).catch(() => {});
      }

      const { sendTransactional } = await import("@/lib/comms/send");
      await sendTransactional({
        templateKey: "event_registration_confirmation",
        to: email,
        variables: {
          registrant_name: profile?.display_name ?? "there",
          event_title: event.title,
          event_date: new Date(event.starts_at).toLocaleString("en-CA", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
            hour: "2-digit", minute: "2-digit", timeZoneName: "short",
          }),
          event_url: `${APP_URL}/events/${event.slug}`,
          meet_link_block: event.google_meet_link
            ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">🎥 <strong>Google Meet:</strong> <a href="${event.google_meet_link}" style="color:#EE2A2E;">${event.google_meet_link}</a></p>`
            : "",
        },
      });
    } catch (e) {
      console.error("[event-ticket webhook] post-payment notifications failed:", e);
    }
  })();
}

async function processEventTicketBulkPurchase(
  session: Stripe.Checkout.Session,
  db: AdminClient
): Promise<void> {
  // Find all pending registrations pre-created for this session
  const { data: regs, error } = await db
    .from("event_registrations")
    .select("user_id, event_id")
    .eq("stripe_session_id", session.id)
    .eq("payment_status", "pending");

  if (error || !regs?.length) {
    console.error("[event-ticket-bulk webhook] no pending registrations found for session", session.id);
    return;
  }

  // Activate all pending registrations
  await db
    .from("event_registrations")
    .update({ payment_status: "paid" })
    .eq("stripe_session_id", session.id)
    .eq("payment_status", "pending");

  const eventId = regs[0].event_id;
  const { data: event } = await db
    .from("events")
    .select("title, slug, starts_at, google_meet_link, google_event_id, is_virtual")
    .eq("id", eventId)
    .single() as { data: any };

  if (!event) return;

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Fire calendar invite + confirmation email for each member — best effort
  void Promise.all(
    regs.map(async (reg) => {
      try {
        const { data: userRecord } = await db.auth.admin.getUserById(reg.user_id);
        const email = userRecord?.user?.email;
        if (!email) return;

        if (event.is_virtual && event.google_event_id) {
          const { addAttendeeToCalendarEvent } = await import("@/lib/google/calendar");
          addAttendeeToCalendarEvent(event.google_event_id, email).catch(() => {});
        }

        const { data: profile } = await db
          .from("profiles")
          .select("display_name")
          .eq("id", reg.user_id)
          .maybeSingle();

        const { sendTransactional } = await import("@/lib/comms/send");
        await sendTransactional({
          templateKey: "event_registration_confirmation",
          to: email,
          variables: {
            registrant_name: profile?.display_name ?? "there",
            event_title: event.title,
            event_date: new Date(event.starts_at).toLocaleString("en-CA", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
              hour: "2-digit", minute: "2-digit", timeZoneName: "short",
            }),
            event_url: `${APP_URL}/events/${event.slug}`,
            meet_link_block: event.google_meet_link
              ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">🎥 <strong>Google Meet:</strong> <a href="${event.google_meet_link}" style="color:#EE2A2E;">${event.google_meet_link}</a></p>`
              : "",
          },
        });
      } catch (e) {
        console.error("[event-ticket-bulk webhook] notification failed for user", reg.user_id, e);
      }
    })
  );
}

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  raw: Record<string, unknown>,
  db: AdminClient
): Promise<EventProcessingContext> {
  // Route event ticket purchases to their own handlers
  if (session.metadata?.source === "event_ticket_bulk") {
    await processEventTicketBulkPurchase(session, db);
    return { conferenceOrderId: null };
  }
  if (session.metadata?.source === "event_ticket") {
    await processEventTicketPurchase(session, db);
    return { conferenceOrderId: null };
  }

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

    const { data: updatedInvoice } = await db
      .from("invoices")
      .update({
        status: "paid",
        payment_source: "stripe",
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntentId,
        stripe_charge_id: chargeId,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_invoice_id", stripeInvoice.id)
      .select("id")
      .single();

    if (updatedInvoice?.id) {
      await enqueueQBExport(updatedInvoice.id);
    }
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
