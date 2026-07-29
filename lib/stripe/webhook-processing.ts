import Stripe from "stripe";
import { parseUTC } from "@/lib/utils";
import { transitionMembershipState } from "@/lib/membership/state-machine";
// Relative import: vitest has no @/ alias resolver for real (non-mocked)
// runtime imports — see project notes on the test setup.
import { activateMembershipRenewal, computeNewExpiresAt } from "../membership/renewal-activation";
import { createSponsorAgreementFromBoothPurchase } from "../sponsorship/booth-agreement";
import { mintRegistrationAttendeesFromOrder } from "../conference/registration-mint";
import {
  triggerConferenceRegistrationConfirmation,
  triggerConferencePaymentConfirmation,
} from "../comms/conference-triggers";
import { enqueueQBExport, enqueueQBExportRefund } from "@/lib/quickbooks/export";
import {
  enqueueQBConferenceReceipt,
  enqueueQBConferenceRefund,
  enqueueQBMiscReceipt,
} from "@/lib/quickbooks/conference-export";
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
  const { data: updatedReg, error } = await db
    .from("event_registrations")
    .update({
      payment_status: "paid",
      stripe_session_id: session.id,
    })
    .eq("event_id", event_id)
    .eq("user_id", user_id)
    .select("id")
    .single();

  if (error) {
    throw new Error(`[event-ticket webhook] failed to mark registration paid: ${error.message}`);
  }

  if (updatedReg?.id) {
    await enqueueQBMiscReceipt("event_ticket", updatedReg.id);
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
          event_date: parseUTC(event.starts_at).toLocaleString("en-CA", {
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
    .select("id, user_id, event_id")
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

  await Promise.all(regs.map((reg) => enqueueQBMiscReceipt("event_ticket", reg.id)));

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
            event_date: parseUTC(event.starts_at).toLocaleString("en-CA", {
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

/**
 * A non-member Day Pass buyer has no org or person record yet — mint one
 * directly instead of routing through a review step (unlike a booth, a day
 * pass doesn't make them a CSC member, so there's nothing for the board to
 * approve). Errors are logged, not thrown: the payment already succeeded and
 * the pending row stays "paid" so an admin can reconcile manually if minting
 * fails partway.
 */
async function mintProspectiveRegistration(
  db: AdminClient,
  row: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    organization_name: string;
    job_title: string | null;
    phone: string | null;
    dietary_restrictions: string | null;
    conference_id: string;
    offer_entity_id: string;
    amount_cents: number;
  }
): Promise<void> {
  const slugBase = row.organization_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const { data: existingSlug } = await db.from("organizations").select("id").eq("slug", slugBase).maybeSingle();
  const slug = existingSlug ? `${slugBase}-${Date.now()}` : slugBase;

  const orgId = crypto.randomUUID();
  const { error: orgError } = await db.from("organizations").insert({
    id: orgId,
    name: row.organization_name,
    slug,
    type: "Non-Member",
    email: row.email,
    phone: row.phone,
    tenant_id: "29300837-1d49-45b4-bd09-1c4525c409d1",
    updated_at: new Date().toISOString(),
  });
  if (orgError) {
    console.error(`mintProspectiveRegistration: failed to create org for payment ${row.id}: ${orgError.message}`);
    return;
  }

  const { data: person, error: personError } = await db
    .from("conference_people")
    .insert({
      conference_id: row.conference_id,
      organization_id: orgId,
      person_kind: "delegate",
      source_type: "manual",
      source_id: crypto.randomUUID(),
      display_name: `${row.first_name} ${row.last_name}`.trim(),
      contact_email: row.email,
      mobile_phone: row.phone,
      role_title: row.job_title,
      dietary_restrictions: row.dietary_restrictions,
      assignment_status: "assigned",
      assigned_at: new Date().toISOString(),
      admin_notes: "Self-registered via public non-member Day Pass checkout.",
    })
    .select("id")
    .single();
  if (personError || !person) {
    console.error(`mintProspectiveRegistration: failed to create person for payment ${row.id}: ${personError?.message}`);
    return;
  }

  const { data: purchaseId, error: mintError } = await db.rpc("mint_prospective_registration_purchase", {
    p_conference_id: row.conference_id,
    p_organization_id: orgId,
    p_registration_entity_id: row.offer_entity_id,
    p_price_cents: row.amount_cents,
    p_buyer: row.email,
  });
  if (mintError || !purchaseId) {
    console.error(`mintProspectiveRegistration: mint failed for payment ${row.id}: ${mintError?.message}`);
    return;
  }

  // Solo registrant holds every seat their own purchase created.
  const { data: balances } = await db.from("entity_balances").select("id").eq("purchase_id", purchaseId);
  const balanceIds = (balances ?? []).map((b) => b.id);
  if (balanceIds.length > 0) {
    await db.from("entity_balance_seats").update({ holder_person_id: person.id }).in("balance_id", balanceIds);
  }

  await db
    .from("prospective_registration_payments")
    .update({
      organization_id: orgId,
      conference_person_id: person.id,
      status: "minted",
      minted_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  const { data: offer } = await db
    .from("conference_entities")
    .select("name")
    .eq("id", row.offer_entity_id)
    .maybeSingle();

  await triggerConferenceRegistrationConfirmation({
    db,
    conferenceId: row.conference_id,
    personId: person.id,
    attendeeName: `${row.first_name} ${row.last_name}`.trim(),
    attendeeEmail: row.email,
    orgName: row.organization_name,
    registrationRole: offer?.name ?? "Delegate",
  });
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

    await enqueueQBConferenceReceipt(conferenceOrderId);

    const conferenceId = session.metadata?.conference_id;
    const orgId = session.metadata?.organization_id;
    const userId = session.metadata?.user_id;

    if (conferenceId && orgId) {
      await mintRegistrationAttendeesFromOrder(db, conferenceOrderId, conferenceId, orgId);
    }

    // If this order bundled a membership-renewal line, advance the org's
    // membership_expires_at through the same shared helper the invoice path
    // uses. Recomputed from the org's CURRENT expiry at payment time (not
    // whatever was true at checkout-session creation) since Stripe sessions
    // can take time to complete. Logged, not thrown, on failure — the
    // payment already succeeded and the order is already marked paid.
    if (orgId) {
      const { data: orderItems } = await db
        .from("conference_order_items")
        .select("offer:conference_entities!conference_order_items_offer_entity_id_fkey(id, name, kind, price_cents)")
        .eq("order_id", conferenceOrderId)
        .not("offer_entity_id", "is", null);
      const hasMembershipLine = (orderItems ?? []).some(
        (item) => (Array.isArray(item.offer) ? item.offer[0] : item.offer)?.kind === "membership_renewal"
      );

      if (hasMembershipLine) {
        const [{ data: org }, { data: conference }] = await Promise.all([
          db.from("organizations").select("membership_expires_at").eq("id", orgId).single(),
          conferenceId
            ? db.from("conference_instances").select("end_date").eq("id", conferenceId).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        // mustCoverThrough: a booth bought well ahead of a conference can
        // need more than one fiscal-year extension to actually reach it —
        // without this, the renewal wouldn't satisfy the gate that prompted it.
        const { billingPeriodStart, billingPeriodEnd } = await computeNewExpiresAt(
          org?.membership_expires_at ?? null,
          conference?.end_date ?? null
        );
        const result = await activateMembershipRenewal({
          organizationId: orgId,
          newExpiresAt: billingPeriodEnd,
          billingPeriodStart,
          triggeredBy: "conference_checkout",
          idempotencyKey: `conference_order:${conferenceOrderId}`,
          invoiceId: null,
          metadata: { conference_order_id: conferenceOrderId },
        });
        if (!result.success) {
          console.error(
            `checkout.session.completed: membership renewal activation failed for order ${conferenceOrderId}: ${result.error}`
          );
        }
      }

      // Each booth purchased at a sponsor tier's self-serve price (Bronze/
      // Connected) gets a draft sponsor agreement auto-created so it lands in
      // the admin sponsorship queue instead of relying on someone noticing
      // the sale. An order can contain more than one booth (an org can hold
      // multiple), so every booth line needs its own call, not just the first.
      const boothItems = (orderItems ?? [])
        .map((item) => (Array.isArray(item.offer) ? item.offer[0] : item.offer))
        .filter((offer) => offer?.kind === "booth");
      for (const boothItem of boothItems) {
        if (boothItem?.id && boothItem.price_cents != null) {
          await createSponsorAgreementFromBoothPurchase({
            organizationId: orgId,
            boothEntityId: boothItem.id,
            boothEntityName: boothItem.name,
            boothPriceCents: boothItem.price_cents,
          });
        }
      }
    }

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

    if (conferenceId && orgId && userId) {
      await triggerConferencePaymentConfirmation({
        db,
        conferenceId,
        orderId: conferenceOrderId,
        organizationId: orgId,
        userId,
      });
    }

    return { conferenceOrderId };
  }

  // Prospective booth payment — no org/user exists yet (that's the whole
  // point of "pay first, apply second"). Just mark the holding record paid;
  // the actual booth mints later, at approveApplication() time, once an org
  // exists to own it (see lib/actions/applications.ts).
  if (checkoutKind === "prospective_booth") {
    const { data: boothPayment, error } = await db
      .from("prospective_booth_payments")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("stripe_checkout_session_id", session.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) {
      console.error(`checkout.session.completed: failed to mark prospective booth payment paid (session ${session.id}): ${error.message}`);
    }
    if (boothPayment?.id) {
      await enqueueQBMiscReceipt("prospective_booth", boothPayment.id);
    }
    return { conferenceOrderId: null };
  }

  // Prospective (non-member) Day Pass registration — no board approval
  // needed, so mint access immediately rather than waiting on a review step.
  if (checkoutKind === "prospective_registration") {
    const { data: row, error: markPaidError } = await db
      .from("prospective_registration_payments")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("stripe_checkout_session_id", session.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (markPaidError) {
      console.error(`checkout.session.completed: failed to mark prospective registration paid (session ${session.id}): ${markPaidError.message}`);
    }
    if (row) {
      await enqueueQBMiscReceipt("prospective_registration", row.id);
      await mintProspectiveRegistration(db, row);
    }
    return { conferenceOrderId: null };
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
  const metadataOrgId = stripeInvoice.metadata?.org_id;

  let updatedInvoice: {
    id: string;
    organization_id: string | null;
    billing_period_start: string | null;
    billing_period_end: string | null;
  } | null = null;

  if (stripeInvoice.id) {
    const chargeId = extractStringField(raw, "charge");
    const paymentIntentId = extractStringField(raw, "payment_intent");

    const { data } = await db
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
      .select("id, organization_id, billing_period_start, billing_period_end")
      .single();

    updatedInvoice = data;

    if (updatedInvoice?.id) {
      await enqueueQBExport(updatedInvoice.id);
    }
  }

  // Prefer the DB foreign key over Stripe metadata as the source of truth;
  // fall back to metadata for invoices this webhook can't match locally.
  const orgId = updatedInvoice?.organization_id ?? metadataOrgId ?? null;
  if (
    updatedInvoice?.organization_id &&
    metadataOrgId &&
    updatedInvoice.organization_id !== metadataOrgId
  ) {
    console.warn(
      `invoice.paid: org mismatch for invoice ${stripeInvoice.id} — local invoice says ${updatedInvoice.organization_id}, Stripe metadata says ${metadataOrgId}`
    );
  }

  if (!orgId) return;

  // Invoices created by createMembershipInvoice/createPartnershipInvoice
  // always set billing_period_start/end — when present, advance the org's
  // membership_expires_at through the shared activation helper (this is the
  // actual fix: previously this webhook only flipped status, never expiry).
  if (updatedInvoice?.billing_period_end) {
    const result = await activateMembershipRenewal({
      organizationId: orgId,
      newExpiresAt: updatedInvoice.billing_period_end,
      billingPeriodStart: updatedInvoice.billing_period_start ?? updatedInvoice.billing_period_end,
      triggeredBy: "stripe_webhook",
      idempotencyKey: stripeInvoice.id,
      invoiceId: updatedInvoice.id,
    });
    if (!result.success) {
      console.error(`invoice.paid: membership activation failed for org ${orgId}: ${result.error}`);
    }
    return;
  }

  // No billing period on this invoice (created outside the normal renewal
  // flow) — preserve exactly today's behavior rather than guessing a date.
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

    // Each Stripe Refund object carries its own incremental amount (unlike
    // charge.amount_refunded, which is the running cumulative total) — take
    // the most recent one as the refund this event is about. stripe_refund_id
    // is the idempotency key on qbo_conference_refund_queue, so a duplicate
    // delivery (or the admin action having already enqueued the same refund)
    // is naturally a no-op.
    const latestRefund = charge.refunds?.data?.[0];
    if (latestRefund) {
      await enqueueQBConferenceRefund(chargeMetadataOrderId, latestRefund.id, latestRefund.amount);
    } else {
      await enqueueQBConferenceRefund(
        chargeMetadataOrderId,
        `${charge.id}_${charge.amount_refunded}`,
        charge.amount_refunded
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

  // Same "latest refund object, fall back to a synthesized id" pattern as
  // handleChargeRefunded's conference path above — stripe_refund_id is the
  // idempotency key, so this is a no-op if processRefund (billing.ts) already
  // enqueued the same refund.
  const latestRefund = charge.refunds?.data?.[0];
  if (latestRefund) {
    await enqueueQBExportRefund(localInvoice.id, latestRefund.id, refundedAmount);
  } else {
    await enqueueQBExportRefund(localInvoice.id, `${charge.id}_${refundedAmount}`, refundedAmount);
  }
}

export function toWebhookPayloadJson(event: Stripe.Event): Json {
  return JSON.parse(JSON.stringify(event.data.object)) as Json;
}
