"use server";

// ─────────────────────────────────────────────────────────────────
// Event ticket actions
// — resolveTicketsForUser   (read: what can this user buy?)
// — registerWithTicket      (free ticket: direct registration)
// — createEventCheckoutSession (paid ticket: Stripe Checkout)
// — processRefundOnCancellation (called by cancelRegistration)
// ─────────────────────────────────────────────────────────────────

import { requireAuthenticated, getOptionalAuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { sendTransactional } from "@/lib/comms/send";
import { addAttendeeToCalendarEvent } from "@/lib/google/calendar";
import {
  resolveTickets,
  resolveRefundPolicy,
  computeRefund,
  type EventTicketType,
  type TicketUserContext,
  type ResolvedTickets,
} from "@/lib/events/tickets";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-CA", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

// ── Resolve available tickets for a user ─────────────────────────

export async function resolveTicketsForUser(
  eventId: string
): Promise<{ success: true; data: ResolvedTickets } | { success: false; error: string }> {
  const authCtx = await getOptionalAuthContext();
  const adminClient = createAdminClient();

  // Fetch ticket types for this event
  const { data: tickets, error } = await adminClient
    .from("event_ticket_types")
    .select("*")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true }) as { data: EventTicketType[] | null; error: any };

  if (error) return { success: false, error: error.message };

  // Build user context
  let ctx: TicketUserContext = { globalRole: "public", org: null };

  if (authCtx?.userId) {
    const [profileRes, orgRes] = await Promise.all([
      adminClient
        .from("profiles")
        .select("global_role")
        .eq("id", authCtx.userId)
        .single(),
      adminClient
        .from("user_organizations")
        .select("organization:organizations(type, primary_category, membership_status, fte)")
        .eq("user_id", authCtx.userId)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    const org = (orgRes.data as any)?.organization;
    ctx = {
      globalRole: profileRes.data?.global_role ?? "user",
      org: org
        ? {
            type: org.type ?? "",
            primary_category: org.primary_category ?? null,
            membership_status: org.membership_status ?? null,
            fte: org.fte ?? null,
          }
        : null,
    };
  }

  return { success: true, data: resolveTickets(tickets ?? [], ctx) };
}

// ── Register with a free ticket ───────────────────────────────────

export async function registerWithTicket(
  eventId: string,
  ticketTypeId: string
): Promise<{ success: true; result: "registered" | "waitlisted" } | { success: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const userId = auth.ctx.userId;

  // Verify ticket is free and belongs to this event
  const { data: ticket } = await adminClient
    .from("event_ticket_types")
    .select("id, event_id, price_cents, capacity, is_hidden")
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .single() as { data: any };

  if (!ticket) return { success: false, error: "Ticket type not found" };
  if (ticket.price_cents !== 0) return { success: false, error: "Use checkout for paid tickets" };

  // Load event
  const { data: event } = await adminClient
    .from("events")
    .select("id, slug, title, status, audience_mode, capacity, starts_at, google_meet_link, google_event_id, is_virtual")
    .eq("id", eventId)
    .single() as { data: any };

  if (!event) return { success: false, error: "Event not found" };
  if (event.status !== "published") return { success: false, error: "Event is not open for registration" };

  // Check existing registration
  const { data: existing } = await adminClient
    .from("event_registrations")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.status === "registered" || existing?.status === "promoted") {
    return { success: false, error: "Already registered" };
  }

  // Check capacity (event-level)
  let atCapacity = false;
  if (event.capacity !== null) {
    const { count } = await adminClient
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .in("status", ["registered", "promoted"]);
    atCapacity = (count ?? 0) >= event.capacity;
  }

  if (atCapacity) {
    // Waitlist
    const { data: lastPos } = await adminClient
      .from("event_waitlist")
      .select("position")
      .eq("event_id", eventId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    await adminClient.from("event_waitlist").insert({
      event_id: eventId,
      user_id: userId,
      position: (lastPos?.position ?? 0) + 1,
    });

    await logAuditEventSafe({ actorId: userId, action: "event.waitlisted", entityType: "event", entityId: eventId, details: {} });
    return { success: true, result: "waitlisted" };
  }

  // Register
  const { error: regErr } = await adminClient
    .from("event_registrations")
    .upsert(
      {
        event_id: eventId,
        user_id: userId,
        status: "registered",
        registered_at: new Date().toISOString(),
        cancelled_at: null,
        ticket_type_id: ticketTypeId,
        amount_paid_cents: 0,
        payment_status: "free",
      },
      { onConflict: "event_id,user_id" }
    );

  if (regErr) return { success: false, error: regErr.message };

  await logAuditEventSafe({ actorId: userId, action: "event.registered", entityType: "event", entityId: eventId, details: { ticket_type_id: ticketTypeId } });

  // Calendar invite + confirmation email — non-fatal
  void (async () => {
    const userEmail = auth.ctx.userEmail;
    if (!userEmail) return;

    if (event.is_virtual && event.google_event_id) {
      addAttendeeToCalendarEvent(event.google_event_id, userEmail).catch(() => {});
    }

    try {
      const profileRes = await adminClient.from("profiles").select("display_name").eq("id", userId).maybeSingle();
      await sendTransactional({
        templateKey: "event_registration_confirmation",
        to: userEmail,
        variables: {
          registrant_name: profileRes.data?.display_name ?? "there",
          event_title: event.title,
          event_date: fmtDate(event.starts_at),
          event_url: `${APP_URL}/events/${event.slug}`,
          meet_link_block: event.google_meet_link
            ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">🎥 <strong>Google Meet:</strong> <a href="${event.google_meet_link}" style="color:#EE2A2E;">${event.google_meet_link}</a></p>`
            : "",
        },
      });
    } catch (e) {
      console.error("[event-tickets] confirmation email failed:", e);
    }
  })();

  return { success: true, result: "registered" };
}

// ── Create Stripe Checkout Session for a paid ticket ─────────────

export async function createEventCheckoutSession(
  eventId: string,
  ticketTypeId: string
): Promise<{ success: true; checkoutUrl: string } | { success: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const userId = auth.ctx.userId;

  // Load event + ticket
  const [{ data: event }, { data: ticket }] = await Promise.all([
    adminClient
      .from("events")
      .select("id, slug, title, status, starts_at")
      .eq("id", eventId)
      .single() as unknown as Promise<{ data: any }>,
    adminClient
      .from("event_ticket_types")
      .select("id, event_id, name, price_cents, stripe_price_id")
      .eq("id", ticketTypeId)
      .eq("event_id", eventId)
      .single() as unknown as Promise<{ data: any }>,
  ]);

  if (!event) return { success: false, error: "Event not found" };
  if (!event.status || event.status !== "published") return { success: false, error: "Event is not open for registration" };
  if (!ticket) return { success: false, error: "Ticket type not found" };
  if (ticket.price_cents === 0) return { success: false, error: "Use registerWithTicket for free tickets" };

  // Check for existing paid registration
  const { data: existing } = await adminClient
    .from("event_registrations")
    .select("id, status, payment_status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.status === "registered" || existing?.status === "promoted") {
    return { success: false, error: "Already registered for this event" };
  }

  // Get or create Stripe Price for this ticket type (lazily)
  let stripePriceId = ticket.stripe_price_id;
  if (!stripePriceId) {
    const price = await stripe.prices.create({
      currency: "cad",
      unit_amount: ticket.price_cents,
      product_data: {
        name: `${event.title} — ${ticket.name}`,
        metadata: { event_id: eventId, ticket_type_id: ticketTypeId },
      },
    });
    stripePriceId = price.id;
    // Persist back so future purchases reuse the same Price object
    await adminClient
      .from("event_ticket_types")
      .update({ stripe_price_id: stripePriceId, updated_at: new Date().toISOString() })
      .eq("id", ticketTypeId);
  }

  // Create a pending registration row so we can reconcile on webhook
  await adminClient
    .from("event_registrations")
    .upsert(
      {
        event_id: eventId,
        user_id: userId,
        status: "registered",
        registered_at: new Date().toISOString(),
        cancelled_at: null,
        ticket_type_id: ticketTypeId,
        amount_paid_cents: ticket.price_cents,
        payment_status: "pending",
      },
      { onConflict: "event_id,user_id" }
    );

  // Stripe Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: stripePriceId, quantity: 1 }],
    customer_email: auth.ctx.userEmail ?? undefined,
    metadata: {
      source: "event_ticket",
      event_id: eventId,
      ticket_type_id: ticketTypeId,
      user_id: userId,
    },
    success_url: `${APP_URL}/events/${event.slug}?registered=1`,
    cancel_url: `${APP_URL}/events/${event.slug}`,
  });

  if (!session.url) return { success: false, error: "Failed to create checkout session" };

  // Persist session ID on the pending registration
  await adminClient
    .from("event_registrations")
    .update({ stripe_session_id: session.id })
    .eq("event_id", eventId)
    .eq("user_id", userId);

  return { success: true, checkoutUrl: session.url };
}

// ── Org admin: bulk checkout for paid tickets ─────────────────────
// Org admin selects N members + a ticket type → one Stripe Checkout session.
// Pending registrations are pre-created in the DB (indexed by stripe_session_id)
// so the webhook can activate them without hitting Stripe metadata length limits.

export async function orgAdminBulkCheckout(
  eventId: string,
  ticketTypeId: string,
  memberUserIds: string[],
  orgId: string
): Promise<{ success: true; checkoutUrl: string } | { success: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!auth.ctx.orgAdminOrgIds.includes(orgId)) {
    return { success: false, error: "Not an org admin for this organization" };
  }
  if (memberUserIds.length === 0) return { success: false, error: "No members selected" };

  const adminClient = createAdminClient();

  const [{ data: event }, { data: ticket }] = await Promise.all([
    adminClient
      .from("events")
      .select("id, slug, title, status, starts_at")
      .eq("id", eventId)
      .single() as unknown as Promise<{ data: any }>,
    adminClient
      .from("event_ticket_types")
      .select("id, event_id, name, price_cents, stripe_price_id")
      .eq("id", ticketTypeId)
      .eq("event_id", eventId)
      .single() as unknown as Promise<{ data: any }>,
  ]);

  if (!event || event.status !== "published") return { success: false, error: "Event is not open for registration" };
  if (!ticket) return { success: false, error: "Ticket type not found" };
  if (ticket.price_cents === 0) return { success: false, error: "Use orgAdminRegisterMembers for free tickets" };

  // Verify all targets are in the org
  const { data: memberships } = await adminClient
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .in("user_id", memberUserIds);
  const orgMemberIds = new Set((memberships ?? []).map((m: any) => m.user_id));

  // Exclude already-registered
  const { data: existingRegs } = await adminClient
    .from("event_registrations")
    .select("user_id, status")
    .eq("event_id", eventId)
    .in("user_id", memberUserIds);
  const alreadyRegistered = new Set(
    (existingRegs ?? [])
      .filter((r: any) => r.status === "registered" || r.status === "promoted")
      .map((r: any) => r.user_id)
  );

  const eligible = memberUserIds.filter((uid) => orgMemberIds.has(uid) && !alreadyRegistered.has(uid));
  if (eligible.length === 0) return { success: false, error: "All selected members are already registered" };

  // Get or create Stripe Price
  let stripePriceId = ticket.stripe_price_id;
  if (!stripePriceId) {
    const price = await stripe.prices.create({
      currency: "cad",
      unit_amount: ticket.price_cents,
      product_data: {
        name: `${event.title} — ${ticket.name}`,
        metadata: { event_id: eventId, ticket_type_id: ticketTypeId },
      },
    });
    stripePriceId = price.id;
    await adminClient
      .from("event_ticket_types")
      .update({ stripe_price_id: stripePriceId, updated_at: new Date().toISOString() })
      .eq("id", ticketTypeId);
  }

  // Create Stripe Checkout for N tickets
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: stripePriceId, quantity: eligible.length }],
    customer_email: auth.ctx.userEmail ?? undefined,
    metadata: {
      source: "event_ticket_bulk",
      event_id: eventId,
      ticket_type_id: ticketTypeId,
      registered_by: auth.ctx.userId,
      org_id: orgId,
    },
    success_url: `${APP_URL}/events/${event.slug}?registered=bulk`,
    cancel_url: `${APP_URL}/events/${event.slug}`,
  });

  if (!session.url) return { success: false, error: "Failed to create checkout session" };

  // Pre-create pending registrations indexed by session ID — webhook activates them on payment
  const now = new Date().toISOString();
  await Promise.all(
    eligible.map((uid) =>
      adminClient.from("event_registrations").upsert(
        {
          event_id: eventId,
          user_id: uid,
          status: "registered",
          registered_at: now,
          cancelled_at: null,
          ticket_type_id: ticketTypeId,
          amount_paid_cents: ticket.price_cents,
          payment_status: "pending",
          stripe_session_id: session.id,
        },
        { onConflict: "event_id,user_id" }
      )
    )
  );

  return { success: true, checkoutUrl: session.url };
}

// ── Process refund on cancellation ───────────────────────────────
// Called by cancelRegistration in event-registration.ts when payment_status === "paid"

export async function processRefundOnCancellation(
  eventId: string,
  userId: string,
  stripeSessionId: string,
  amountPaidCents: number
): Promise<void> {
  const adminClient = createAdminClient();

  // Load event for start time + refund policy
  const { data: event } = await adminClient
    .from("events")
    .select("starts_at, refund_policy")
    .eq("id", eventId)
    .single() as { data: any };

  if (!event) return;

  const policy = resolveRefundPolicy(event.refund_policy);
  const { refundCents, reason } = computeRefund(
    amountPaidCents,
    event.starts_at,
    new Date(),
    policy
  );

  if (refundCents === 0) {
    await logAuditEventSafe({
      actorId: userId, action: "event.refund_skipped", entityType: "event", entityId: eventId,
      details: { reason, amount_paid_cents: amountPaidCents },
    });
    return;
  }

  try {
    // Retrieve payment intent from session
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

    if (!paymentIntentId) throw new Error("No payment intent on session");

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const chargeId = typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id;

    if (!chargeId) throw new Error("No charge on payment intent");

    await stripe.refunds.create({ charge: chargeId, amount: refundCents });

    await adminClient
      .from("event_registrations")
      .update({ payment_status: "refunded" })
      .eq("event_id", eventId)
      .eq("user_id", userId);

    await logAuditEventSafe({
      actorId: userId, action: "event.refund_issued", entityType: "event", entityId: eventId,
      details: { refund_cents: refundCents, reason },
    });
  } catch (err) {
    console.error("[event-tickets] refund failed:", err);
    await logAuditEventSafe({
      actorId: userId, action: "event.refund_failed", entityType: "event", entityId: eventId,
      details: { error: String(err), amount_paid_cents: amountPaidCents },
    });
  }
}
