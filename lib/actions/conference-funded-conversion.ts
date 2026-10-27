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
 * ⛔ Staff only, one school at a time, never automatic. Three locks:
 *   1. the same eligibility rule as the cart (fundedRegistrationAllowed), so
 *      while the program is switched off no real school even appears;
 *   2. `first_invoice_paid_at` on the funded offer, set by staff when CANCOLL
 *      pays, before which nothing can be converted;
 *   3. `claim_deadline` on the funded offer (MOU 11.2), after which nothing can.
 *
 * Mechanically the same shape as a booth move: refund in Stripe first (it
 * cannot run inside a transaction), then one database function records the
 * refund and relabels the seat. The delegate stays on the seat throughout.
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

export type FundedConversionBoard = {
  fundedOfferId: string;
  fundedOfferName: string;
  /** When staff recorded CANCOLL paying its first invoice. Null: conversions are locked. */
  firstInvoicePaidAt: string | null;
  /** Last day a registration may become funded (MOU 11.2). Null: no deadline set. */
  claimDeadline: string | null;
  schools: FundedConversionSchool[];
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

  const { seats } = await loadSeatHoldings(db, { conferenceId });
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
  };
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
 * registration. The delegate on the seat stays; the school gets the fee and its
 * tax back.
 */
export async function convertSeatToFunded(params: {
  conferenceId: string;
  seatId: string;
}): Promise<Result<{ refunded: "stripe" | "by_hand"; refundCents: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const board = await loadBoard(db, params.conferenceId);
  if (!board) return { success: false, error: "This conference has no CANCOLL-funded registration." };
  if (!board.firstInvoicePaidAt) {
    return { success: false, error: "Locked until CANCOLL's first invoice is recorded as paid." };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (board.claimDeadline && today > board.claimDeadline) {
    return { success: false, error: `The claim deadline (${board.claimDeadline}) has passed.` };
  }

  const school = board.schools.find((s) => s.seats.some((seat) => seat.seatId === params.seatId));
  const seat = school?.seats.find((s) => s.seatId === params.seatId);
  if (!school || !seat) {
    return { success: false, error: "That seat can't be switched: the school may not qualify, or already holds its CANCOLL registration." };
  }

  // The money first, as a booth move does: Stripe cannot run inside the
  // database transaction that relabels the seat.
  let refundId: string | null = null;
  let cumulativeRefundCents: number | null = null;
  if (seat.viaStripe) {
    const { data: order } = await db
      .from("conference_orders")
      .select("stripe_payment_intent_id, refund_amount_cents")
      .eq("id", seat.orderId)
      .single();
    if (!order?.stripe_payment_intent_id) return { success: false, error: "The order's payment could not be found." };
    try {
      const refund = await stripe.refunds.create({
        payment_intent: order.stripe_payment_intent_id,
        amount: seat.refundCents,
        reason: "requested_by_customer",
        metadata: { checkout_kind: "conference", conference_order_id: seat.orderId, reason: "cancoll_conversion" },
      });
      refundId = refund.id;
      cumulativeRefundCents = (order.refund_amount_cents ?? 0) + seat.refundCents;
      await enqueueQBConferenceRefund(seat.orderId, refund.id, seat.refundCents);
    } catch (error) {
      return { success: false, error: `The refund did not go through: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // Not in the generated types yet; same narrow cast the other new RPCs use.
  const rpc = db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { error: convertError } = await rpc.call(db, "convert_registration_to_funded", {
    p_conference_id: params.conferenceId,
    p_organization_id: school.organizationId,
    p_seat_id: seat.seatId,
    p_funded_entity_id: board.fundedOfferId,
    p_source_order_id: seat.orderId,
    p_cumulative_refund_cents: cumulativeRefundCents,
    p_refund_id: refundId,
    p_refund_cents: seat.refundCents,
    p_actor_id: auth.ctx.userId,
    p_reason: "cancoll_conversion",
  });

  if (convertError) {
    // ⛔ The money has moved and the seat has not. Somebody must look.
    if (refundId) {
      await raiseAlertIfNotOpen({
        ruleKey: `cancoll_conversion_refunded_not_converted:${seat.seatId}`,
        severity: "critical",
        message:
          `${school.organizationName} was refunded ${seat.refundCents / 100} (Stripe ${refundId}) for a ` +
          `CANCOLL conversion, but the seat was not switched: ${convertError.message}`,
        details: { seatId: seat.seatId, orderId: seat.orderId, refundId },
      });
    }
    return { success: false, error: convertError.message };
  }

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
      refundCents: seat.refundCents,
      refundId,
      refundedBy: seat.viaStripe ? "stripe" : "by_hand",
    },
  });
  revalidatePath(`/admin/conference/${params.conferenceId}/registrations`);
  return { success: true, data: { refunded: seat.viaStripe ? "stripe" : "by_hand", refundCents: seat.refundCents } };
}
