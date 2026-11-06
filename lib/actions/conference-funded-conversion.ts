"use server";

/**
 * Clearing a paid registration through to the CANCOLL-funded one.
 *
 * CSC/CANCOLL MOU (2027) 5.5 and 5.6: a school that paid its delegate's
 * registration and then qualifies for CANCOLL funding gets the fee back from
 * CSC, and that registration becomes the Supported Registration from the date
 * of the refund. CSC may refund only after CANCOLL has paid the first invoice.
 * The schools that paid before the program existed clear through the same way,
 * once the board and CANCOLL approve it.
 *
 * ⛔ Staff only, one school at a time, never automatic.
 *
 * Two steps, split 2026-11-06 (Steve): the SWITCH has nothing to do with the
 * money, so it can happen any time; only the REFUND waits for CANCOLL.
 *   - Switch: the same eligibility rule as the cart (fundedRegistrationAllowed),
 *     and `claim_deadline` on the funded offer (MOU 11.2), after which nothing
 *     can. One database function relabels the seat and records what is owed.
 *     The delegate stays on the seat throughout.
 *   - Refund: locked until `first_invoice_paid_at` on the funded offer, set by
 *     staff when CANCOLL pays. Stripe first (it cannot run inside a
 *     transaction), then the conversion is marked refunded.
 * A switched school that has not been paid back is listed as owed until it is.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { enqueueQBConferenceRefund } from "@/lib/quickbooks/conference-export";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { fundedRegistrationAllowed, isFundedOffer } from "@/lib/conference/entity-pricing";

type Result<T> = { success: true; data: T } | { success: false; error: string };

export type FundedConversionSeat = {
  seatId: string;
  holderName: string | null;
  orderId: string;
  /** The fee plus its tax, which is what goes back to the school. */
  refundCents: number;
  /** False when the order was not paid through Stripe: the refund is owed but issued by hand. */
  viaStripe: boolean;
};

export type FundedConversionSchool = {
  organizationId: string;
  organizationName: string;
  seats: FundedConversionSeat[];
};

/** A school switched to the CANCOLL registration that has not been paid back yet. */
export type FundedRefundOwed = {
  conversionId: string;
  organizationName: string;
  holderName: string | null;
  refundCents: number;
  /** False when the order was not paid through Stripe: paid back by hand. */
  viaStripe: boolean;
  switchedAt: string;
};

export type FundedConversionBoard = {
  fundedOfferId: string;
  fundedOfferName: string;
  /** When staff recorded CANCOLL paying its first invoice. Null: refunds are locked. */
  firstInvoicePaidAt: string | null;
  /** Last day a registration may become funded (MOU 11.2). Null: no deadline set. */
  claimDeadline: string | null;
  schools: FundedConversionSchool[];
  owed: FundedRefundOwed[];
};

type Db = ReturnType<typeof createAdminClient>;

/** The conference's CANCOLL-funded offer, if it has one. */
async function loadFundedOffer(db: Db, conferenceId: string) {
  const { data } = await db
    .from("conference_entities")
    .select("id, name, attributes")
    .eq("conference_id", conferenceId)
    .eq("kind", "registration")
    .eq("attributes->>funded_by", "cancoll");
  return (data ?? []).find((e) => isFundedOffer(e.attributes as Record<string, unknown> | null)) ?? null;
}

/**
 * Every school that could be cleared through now: it qualifies, it holds a
 * paid seat on the registration the funded one stands in for, and it does not
 * already hold its one funded registration.
 */
async function loadBoard(db: Db, conferenceId: string): Promise<FundedConversionBoard | null> {
  const offer = await loadFundedOffer(db, conferenceId);
  if (!offer) return null;
  const attrs = (offer.attributes as Record<string, unknown> | null) ?? {};
  const baseOfferId = attrs.funds_offer_id as string;

  const [{ seats }, owed] = await Promise.all([
    loadSeatHoldings(db, { conferenceId }),
    loadRefundsOwed(db, conferenceId),
  ]);
  const holdsFunded = new Set(seats.filter((s) => s.entityId === offer.id).map((s) => s.organizationId));
  const baseSeats = seats.filter((s) => s.entityId === baseOfferId && !holdsFunded.has(s.organizationId));

  const orgIds = [...new Set(baseSeats.map((s) => s.organizationId))];
  const balanceIds = [...new Set(baseSeats.map((s) => s.balanceId).filter((id): id is string => Boolean(id)))];
  if (orgIds.length === 0 || balanceIds.length === 0) {
    return {
      fundedOfferId: offer.id,
      fundedOfferName: offer.name,
      firstInvoicePaidAt: (attrs.first_invoice_paid_at as string | undefined) ?? null,
      claimDeadline: (attrs.claim_deadline as string | undefined) ?? null,
      schools: [],
      owed,
    };
  }

  const [{ data: orgs }, { data: balances }] = await Promise.all([
    db
      .from("organizations")
      .select("id, name, type, membership_status, is_cancoll_member, is_test")
      .in("id", orgIds),
    db.from("entity_balances").select("id, purchase_id").in("id", balanceIds),
  ]);
  const purchaseByBalance = new Map((balances ?? []).map((b) => [b.id, b.purchase_id as string | null]));
  const purchaseIds = [...new Set([...purchaseByBalance.values()].filter((id): id is string => Boolean(id)))];

  const { data: purchases } = purchaseIds.length
    ? await db.from("entity_purchases").select("id, order_item_id").in("id", purchaseIds)
    : { data: [] as Array<{ id: string; order_item_id: string | null }> };
  const itemByPurchase = new Map((purchases ?? []).map((p) => [p.id, p.order_item_id]));
  const itemIds = [...new Set([...itemByPurchase.values()].filter((id): id is string => Boolean(id)))];

  const { data: items } = itemIds.length
    ? await db
        .from("conference_order_items")
        .select("id, order_id, quantity, unit_price_cents, tax_cents")
        .in("id", itemIds)
    : { data: [] as Array<{ id: string; order_id: string; quantity: number; unit_price_cents: number; tax_cents: number }> };
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));
  const orderIds = [...new Set((items ?? []).map((i) => i.order_id))];

  const { data: orders } = orderIds.length
    ? await db.from("conference_orders").select("id, status, stripe_payment_intent_id").in("id", orderIds)
    : { data: [] as Array<{ id: string; status: string; stripe_payment_intent_id: string | null }> };
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

  const schools: FundedConversionSchool[] = [];
  for (const org of orgs ?? []) {
    const allowed = fundedRegistrationAllowed(attrs, {
      id: org.id,
      type: org.type,
      membershipStatus: org.membership_status,
      isCancollMember: org.is_cancoll_member,
      isTest: org.is_test,
    });
    if (!allowed) continue;

    const orgSeats: FundedConversionSeat[] = [];
    for (const seat of baseSeats.filter((s) => s.organizationId === org.id)) {
      const purchaseId = seat.balanceId ? purchaseByBalance.get(seat.balanceId) : null;
      const itemId = purchaseId ? itemByPurchase.get(purchaseId) : null;
      const item = itemId ? itemById.get(itemId) : null;
      const order = item ? orderById.get(item.order_id) : null;
      // Only a seat somebody actually paid for can be refunded. A comped or
      // board seat has nothing to give back.
      if (!item || !order || !["paid", "partially_refunded"].includes(order.status)) continue;
      if (item.unit_price_cents <= 0) continue;
      const taxPerUnit = Math.round((item.tax_cents ?? 0) / Math.max(1, item.quantity));
      orgSeats.push({
        seatId: seat.seatId,
        holderName: seat.holderName,
        orderId: order.id,
        refundCents: item.unit_price_cents + taxPerUnit,
        viaStripe: Boolean(order.stripe_payment_intent_id),
      });
    }
    if (orgSeats.length > 0) {
      schools.push({ organizationId: org.id, organizationName: org.name, seats: orgSeats });
    }
  }
  schools.sort((a, b) => a.organizationName.localeCompare(b.organizationName));

  return {
    fundedOfferId: offer.id,
    fundedOfferName: offer.name,
    firstInvoicePaidAt: (attrs.first_invoice_paid_at as string | undefined) ?? null,
    claimDeadline: (attrs.claim_deadline as string | undefined) ?? null,
    schools,
    owed,
  };
}

/** Switched schools still waiting for their money back, oldest first. */
async function loadRefundsOwed(db: Db, conferenceId: string): Promise<FundedRefundOwed[]> {
  const { data: rows, error } = await db
    .from("conference_funded_conversions")
    .select("id, organization_id, holder_person_id, source_order_id, refund_cents, created_at")
    .eq("conference_id", conferenceId)
    .is("refunded_at", null)
    .gt("refund_cents", 0)
    .order("created_at");
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return [];

  const orgIds = [...new Set(rows.map((r) => r.organization_id))];
  const personIds = [...new Set(rows.map((r) => r.holder_person_id).filter((id): id is string => Boolean(id)))];
  const orderIds = [...new Set(rows.map((r) => r.source_order_id).filter((id): id is string => Boolean(id)))];
  const [{ data: orgs }, { data: people }, { data: orders }] = await Promise.all([
    db.from("organizations").select("id, name").in("id", orgIds),
    personIds.length
      ? db.from("conference_people").select("id, display_name").in("id", personIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null }> }),
    orderIds.length
      ? db.from("conference_orders").select("id, stripe_payment_intent_id").in("id", orderIds)
      : Promise.resolve({ data: [] as Array<{ id: string; stripe_payment_intent_id: string | null }> }),
  ]);
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const personName = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  const viaStripe = new Map((orders ?? []).map((o) => [o.id, Boolean(o.stripe_payment_intent_id)]));

  return rows.map((r) => ({
    conversionId: r.id,
    organizationName: orgName.get(r.organization_id) ?? "Unknown school",
    holderName: r.holder_person_id ? personName.get(r.holder_person_id) ?? null : null,
    refundCents: r.refund_cents ?? 0,
    viaStripe: r.source_order_id ? viaStripe.get(r.source_order_id) ?? false : false,
    switchedAt: r.created_at,
  }));
}

/** Staff: who could be cleared through to a CANCOLL-funded registration right now. */
export async function getFundedConversionBoard(
  conferenceId: string
): Promise<Result<FundedConversionBoard | null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    return { success: true, data: await loadBoard(createAdminClient(), conferenceId) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Staff: record that CANCOLL has paid its first invoice, which is what lets
 * refunds to schools go out (MOU 5.5). Kept on the funded offer, beside the
 * program's on/off switch, so the program's settings live in one place.
 */
export async function markCancollFirstInvoicePaid(params: {
  conferenceId: string;
  paidOn: string;
}): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.paidOn)) return { success: false, error: "Give the date as YYYY-MM-DD." };

  const db = createAdminClient();
  const offer = await loadFundedOffer(db, params.conferenceId);
  if (!offer) return { success: false, error: "This conference has no CANCOLL-funded registration." };

  const attributes = { ...((offer.attributes as Record<string, unknown> | null) ?? {}), first_invoice_paid_at: params.paidOn };
  const { error } = await db.from("conference_entities").update({ attributes }).eq("id", offer.id);
  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "cancoll_first_invoice_paid",
    entityType: "conference_entity",
    entityId: offer.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { conferenceId: params.conferenceId, paidOn: params.paidOn },
  });
  revalidatePath(`/admin/conference/${params.conferenceId}/registrations`);
  return { success: true, data: null };
}

/**
 * Staff: clear one school's paid seat through to the CANCOLL-funded
 * registration. The delegate on the seat stays. No money moves here: what the
 * school is owed is recorded and refunded separately (refundFundedConversion).
 */
export async function convertSeatToFunded(params: {
  conferenceId: string;
  seatId: string;
}): Promise<Result<{ refundCents: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const board = await loadBoard(db, params.conferenceId);
  if (!board) return { success: false, error: "This conference has no CANCOLL-funded registration." };
  const today = new Date().toISOString().slice(0, 10);
  if (board.claimDeadline && today > board.claimDeadline) {
    return { success: false, error: `The claim deadline (${board.claimDeadline}) has passed.` };
  }

  const school = board.schools.find((s) => s.seats.some((seat) => seat.seatId === params.seatId));
  const seat = school?.seats.find((s) => s.seatId === params.seatId);
  if (!school || !seat) {
    return { success: false, error: "That seat can't be switched: the school may not qualify, or already holds its CANCOLL registration." };
  }

  // Not in the generated types yet; same narrow cast the other new RPCs use.
  const rpc = db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  // No refund yet: a null cumulative leaves the order alone, and refund_cents
  // records what is owed.
  const { error: convertError } = await rpc.call(db, "convert_registration_to_funded", {
    p_conference_id: params.conferenceId,
    p_organization_id: school.organizationId,
    p_seat_id: seat.seatId,
    p_funded_entity_id: board.fundedOfferId,
    p_source_order_id: seat.orderId,
    p_cumulative_refund_cents: null,
    p_refund_id: null,
    p_refund_cents: seat.refundCents,
    p_actor_id: auth.ctx.userId,
    p_reason: "cancoll_conversion",
  });
  if (convertError) return { success: false, error: convertError.message };

  await logAuditEventSafe({
    action: "cancoll_conversion",
    entityType: "organization",
    entityId: school.organizationId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: params.conferenceId,
      seatId: seat.seatId,
      orderId: seat.orderId,
      refundOwedCents: seat.refundCents,
    },
  });
  revalidatePath(`/admin/conference/${params.conferenceId}/registrations`);
  return { success: true, data: { refundCents: seat.refundCents } };
}

/**
 * Staff: pay a switched school back. Locked until CANCOLL's first invoice is
 * recorded as paid (MOU 5.5). Stripe orders are refunded to the card; an order
 * paid some other way is marked as paid back by hand.
 */
export async function refundFundedConversion(params: {
  conferenceId: string;
  conversionId: string;
}): Promise<Result<{ refunded: "stripe" | "by_hand"; refundCents: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const offer = await loadFundedOffer(db, params.conferenceId);
  if (!offer) return { success: false, error: "This conference has no CANCOLL-funded registration." };
  const attrs = (offer.attributes as Record<string, unknown> | null) ?? {};
  if (!attrs.first_invoice_paid_at) {
    return { success: false, error: "Refunds are locked until CANCOLL's first invoice is recorded as paid." };
  }

  const { data: conversion } = await db
    .from("conference_funded_conversions")
    .select("id, organization_id, seat_id, source_order_id, refund_cents, refunded_at")
    .eq("id", params.conversionId)
    .eq("conference_id", params.conferenceId)
    .maybeSingle();
  if (!conversion) return { success: false, error: "That switch could not be found." };
  if (conversion.refunded_at) return { success: false, error: "That school has already been paid back." };
  const refundCents = conversion.refund_cents ?? 0;
  if (refundCents <= 0) return { success: false, error: "Nothing is owed on that switch." };

  const { data: order } = conversion.source_order_id
    ? await db
        .from("conference_orders")
        .select("id, stripe_payment_intent_id, refund_amount_cents")
        .eq("id", conversion.source_order_id)
        .maybeSingle()
    : { data: null };
  const viaStripe = Boolean(order?.stripe_payment_intent_id);

  let refundId: string | null = null;
  if (viaStripe && order) {
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: order.stripe_payment_intent_id!,
          amount: refundCents,
          reason: "requested_by_customer",
          metadata: { checkout_kind: "conference", conference_order_id: order.id, reason: "cancoll_conversion" },
        },
        // A second click returns the same refund instead of paying twice.
        { idempotencyKey: `cancoll-conversion-refund:${conversion.id}` }
      );
      refundId = refund.id;
    } catch (error) {
      return { success: false, error: `The refund did not go through: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // Claim the row: only the click that flips it records the money, so two
  // clicks cannot add the refund to the order twice.
  const { data: claimed, error: claimError } = await db
    .from("conference_funded_conversions")
    .update({ refunded_at: new Date().toISOString(), refund_id: refundId })
    .eq("id", conversion.id)
    .is("refunded_at", null)
    .select("id");
  if (claimError || !claimed || claimed.length === 0) {
    if (refundId && claimError) {
      await raiseAlertIfNotOpen({
        ruleKey: `cancoll_conversion_refund_unrecorded:${conversion.id}`,
        severity: "critical",
        message: `A CANCOLL switch refund went out (Stripe ${refundId}, ${refundCents / 100}) but was not recorded: ${claimError.message}`,
        details: { conversionId: conversion.id, orderId: order?.id, refundId },
      });
    }
    return claimError
      ? { success: false, error: claimError.message }
      : { success: false, error: "That school has already been paid back." };
  }

  if (viaStripe && order && refundId) {
    await enqueueQBConferenceRefund(order.id, refundId, refundCents);
    const { error: orderError } = await db.rpc("process_conference_order_refund", {
      p_order_id: order.id,
      p_refund_amount_cents: (order.refund_amount_cents ?? 0) + refundCents,
    });
    if (orderError) {
      await raiseAlertIfNotOpen({
        ruleKey: `cancoll_conversion_order_refund_unrecorded:${conversion.id}`,
        severity: "critical",
        message: `A CANCOLL switch refund went out (Stripe ${refundId}) but the order's refund total was not updated: ${orderError.message}`,
        details: { conversionId: conversion.id, orderId: order.id, refundId },
      });
    }
  }

  await logAuditEventSafe({
    action: "cancoll_conversion_refund",
    entityType: "organization",
    entityId: conversion.organization_id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: params.conferenceId,
      conversionId: conversion.id,
      seatId: conversion.seat_id,
      orderId: order?.id ?? null,
      refundCents,
      refundId,
      refundedBy: viaStripe ? "stripe" : "by_hand",
    },
  });
  revalidatePath(`/admin/conference/${params.conferenceId}/registrations`);
  return { success: true, data: { refunded: viaStripe ? "stripe" : "by_hand", refundCents } };
}
