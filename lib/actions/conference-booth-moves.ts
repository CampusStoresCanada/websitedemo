"use server";

// Admin tool: move an org's booth(s) to different booth(s) at the same
// conference. Generic by design — any booth(s) built for a conference can
// swap for any other booth(s), with the price difference computed and
// handled automatically in either direction.
//
// Mechanically this is: refund the old booths' price against their
// originating order's PaymentIntent (Stripe has no Invoice object for
// conference orders — a Sales/Refund Receipt is generated straight from the
// PaymentIntent/Refund, so there's no single "invoice" to edit in place),
// fully release everything provisioned from the old booths (seats,
// registered attendees, badges — this is a deliberate full teardown, not a
// preserve-and-relink), and grant the new booths via a fresh order. If the
// new booths cost more, that new order stays pending behind a real Stripe
// Checkout Session for just the difference; if they cost the same or less,
// it's minted immediately since the refund already covers it.
//
// The DB-only portion (release + grant + audit row) runs as one atomic
// Postgres function, execute_booth_move (see the migration). Stripe calls
// can't run inside that transaction, so they happen here in the app layer,
// bracketing the RPC call.

import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { enqueueQBConferenceRefund, enqueueQBConferenceReceipt } from "@/lib/quickbooks/conference-export";
import { logAuditEventSafe } from "@/lib/ops/audit";

type Result<T> = { success: true; data: T } | { success: false; error: string };

export interface BoothMovePreview {
  oldBooths: Array<{ id: string; name: string; priceCents: number }>;
  newBooths: Array<{ id: string; name: string; priceCents: number }>;
  taxRatePct: number;
  oldSubtotalCents: number;
  newSubtotalCents: number;
  oldTaxCents: number;
  newTaxCents: number;
  /** Tax-inclusive — what the org actually paid for the old booths. */
  oldTotalCents: number;
  /** Tax-inclusive — what the new booths actually cost. */
  newTotalCents: number;
  /** newTotalCents − oldTotalCents, tax-inclusive. The one number that drives both the refund and the top-up charge — never compute those from the subtotals alone. */
  deltaCents: number;
}

/**
 * Read-only pricing/eligibility preview for the admin UI — call before
 * moveBooths() so the modal can show the delta live as the admin picks
 * new booths.
 */
export async function previewBoothMove(
  organizationId: string,
  conferenceId: string,
  oldBoothEntityIds: string[],
  newBoothEntityIds: string[]
): Promise<Result<BoothMovePreview>> {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Admin access required" };
  }
  return previewBoothMoveCore(organizationId, conferenceId, oldBoothEntityIds, newBoothEntityIds);
}

/**
 * Auth-free core of previewBoothMove — exported for privileged one-off
 * operational scripts (run with service-role credentials outside a request
 * context, where requireAdmin()'s cookie-based check can't run) that need
 * the exact same pricing/eligibility logic the admin UI uses.
 */
export async function previewBoothMoveCore(
  organizationId: string,
  conferenceId: string,
  oldBoothEntityIds: string[],
  newBoothEntityIds: string[]
): Promise<Result<BoothMovePreview>> {
  if (oldBoothEntityIds.length === 0 || newBoothEntityIds.length === 0) {
    return { success: false, error: "Select at least one old and one new booth." };
  }

  const db = createAdminClient();

  const { data: oldPurchases, error: oldErr } = await db
    .from("entity_purchases")
    .select("offer_entity_id, price_cents, entity_balances!inner(organization_id)")
    .in("offer_entity_id", oldBoothEntityIds)
    .eq("entity_balances.organization_id", organizationId);
  if (oldErr) return { success: false, error: oldErr.message };
  if (!oldPurchases || oldPurchases.length !== oldBoothEntityIds.length) {
    return { success: false, error: "One or more old booths aren't currently held by this org." };
  }

  const { data: newEntities, error: newErr } = await db
    .from("conference_entities")
    .select("id, name, price_cents, kind, conference_id")
    .in("id", newBoothEntityIds);
  if (newErr) return { success: false, error: newErr.message };
  if (!newEntities || newEntities.length !== newBoothEntityIds.length) {
    return { success: false, error: "One or more new booths don't exist." };
  }
  if (newEntities.some((e) => e.kind !== "booth" || e.conference_id !== conferenceId)) {
    return { success: false, error: "New selections must all be booths at this same conference." };
  }

  const { data: conflicts } = await db
    .from("entity_balances")
    .select("entity_id, organization_id")
    .in("entity_id", newBoothEntityIds)
    .neq("organization_id", organizationId);
  if (conflicts && conflicts.length > 0) {
    return { success: false, error: `Booth(s) already held by another org: ${conflicts.map((c) => c.entity_id).join(", ")}` };
  }

  const { data: oldEntities } = await db
    .from("conference_entities")
    .select("id, name")
    .in("id", oldBoothEntityIds);
  const oldNameById = new Map((oldEntities ?? []).map((e) => [e.id, e.name]));

  const oldBooths = oldPurchases.map((p) => ({
    id: p.offer_entity_id as string,
    name: oldNameById.get(p.offer_entity_id as string) ?? p.offer_entity_id!,
    priceCents: p.price_cents ?? 0,
  }));
  const newBooths = newEntities.map((e) => ({ id: e.id, name: e.name, priceCents: e.price_cents ?? 0 }));

  const oldSubtotalCents = oldBooths.reduce((sum, b) => sum + b.priceCents, 0);
  const newSubtotalCents = newBooths.reduce((sum, b) => sum + b.priceCents, 0);

  // Same flat, destination-based, one-code-per-conference tax model conference
  // commerce already uses everywhere else — old and new booths are always at
  // the same conference (enforced above), so one rate applies to both sides.
  const { data: conference } = await db
    .from("conference_instances")
    .select("tax_rate_pct")
    .eq("id", conferenceId)
    .single();
  const taxRatePct = Number(conference?.tax_rate_pct ?? 0);
  const oldTaxCents = Math.round((oldSubtotalCents * taxRatePct) / 100);
  const newTaxCents = Math.round((newSubtotalCents * taxRatePct) / 100);
  const oldTotalCents = oldSubtotalCents + oldTaxCents;
  const newTotalCents = newSubtotalCents + newTaxCents;

  return {
    success: true,
    data: {
      oldBooths, newBooths, taxRatePct,
      oldSubtotalCents, newSubtotalCents, oldTaxCents, newTaxCents,
      oldTotalCents, newTotalCents, deltaCents: newTotalCents - oldTotalCents,
    },
  };
}

export async function moveBooths(params: {
  organizationId: string;
  conferenceId: string;
  oldBoothEntityIds: string[];
  newBoothEntityIds: string[];
  reason: string;
}): Promise<Result<{ newOrderId: string; minted: boolean; checkoutUrl: string | null }>> {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Admin access required" };
  }
  return moveBoothsCore(params, auth.ctx.userId);
}

/**
 * Auth-free core of moveBooths — exported for privileged one-off operational
 * scripts (see previewBoothMoveCore). Callers are responsible for their own
 * authorization; actorId is recorded on the order and audit row exactly as
 * the UI path records the logged-in admin's user id.
 */
export async function moveBoothsCore(
  params: {
    organizationId: string;
    conferenceId: string;
    oldBoothEntityIds: string[];
    newBoothEntityIds: string[];
    reason: string;
  },
  actorId: string
): Promise<Result<{ newOrderId: string; minted: boolean; checkoutUrl: string | null }>> {
  const preview = await previewBoothMoveCore(
    params.organizationId,
    params.conferenceId,
    params.oldBoothEntityIds,
    params.newBoothEntityIds
  );
  if (!preview.success) return preview;
  const { oldTotalCents, newTotalCents, deltaCents, oldSubtotalCents, newSubtotalCents, newTaxCents } = preview.data;

  const db = createAdminClient();

  // Group the old booths by their originating order — an org could hold
  // booths from more than one purchase.
  const { data: oldPurchaseRows, error: purchaseErr } = await db
    .from("entity_purchases")
    .select("offer_entity_id, price_cents, order_item_id, conference_order_items!inner(order_id)")
    .in("offer_entity_id", params.oldBoothEntityIds);
  if (purchaseErr || !oldPurchaseRows) {
    return { success: false, error: purchaseErr?.message ?? "Could not resolve old booths' originating order(s)." };
  }

  const byOrder = new Map<string, number>(); // order_id -> this move's share of that order's price
  for (const row of oldPurchaseRows) {
    const orderId = (row as unknown as { conference_order_items: { order_id: string } }).conference_order_items.order_id;
    byOrder.set(orderId, (byOrder.get(orderId) ?? 0) + (row.price_cents ?? 0));
  }

  const { data: orders, error: ordersErr } = await db
    .from("conference_orders")
    .select("id, stripe_payment_intent_id, total_cents, refund_amount_cents")
    .in("id", [...byOrder.keys()]);
  if (ordersErr || !orders) return { success: false, error: ordersErr?.message ?? "Could not load originating orders." };

  // Only the NET difference moves between CSC and the org — refunding the
  // old booths' full price and separately minting the new ones for free
  // would double-count value (over-refund when moving down in price,
  // under-charge when moving up). deltaCents (new total − old total) is the
  // single number driving both sides: negative means we owe the org a
  // partial refund of the shortfall; positive is handled entirely by the
  // Checkout Session below, not here.
  const netRefundCents = deltaCents < 0 ? -deltaCents : 0;

  const refundUpdates: Array<{ order_id: string; cumulative_refund_cents: number }> = [];
  const refundIds: string[] = [];

  if (netRefundCents > 0) {
    // Pro-rate the net refund across the old booths' originating order(s),
    // by each order's share of the old booths' total price — an org could
    // hold the old booths across more than one purchase. The last order
    // absorbs any rounding remainder so the parts always sum to netRefundCents exactly.
    let remaining = netRefundCents;
    try {
      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const shareOfOldTotal = byOrder.get(order.id) ?? 0;
        const isLast = i === orders.length - 1;
        // Ratio uses pre-tax subtotals on both sides (shareOfOldTotal is
        // built from entity_purchases.price_cents, which is pre-tax) — since
        // tax is a flat conference-wide rate, that ratio equals the
        // tax-inclusive one, so no separate gross share needs computing.
        const orderRefundCents = isLast
          ? remaining
          : Math.round((shareOfOldTotal / oldSubtotalCents) * netRefundCents);
        remaining -= orderRefundCents;
        if (orderRefundCents <= 0) continue;
        if (!order.stripe_payment_intent_id) {
          return { success: false, error: `Order ${order.id} has no Stripe payment intent — can't refund.` };
        }
        const alreadyRefunded = order.refund_amount_cents ?? 0;
        const cumulativeRefund = alreadyRefunded + orderRefundCents;

        const stripeRefund = await stripe.refunds.create({
          payment_intent: order.stripe_payment_intent_id,
          amount: orderRefundCents,
          reason: "requested_by_customer",
          metadata: { checkout_kind: "conference", conference_order_id: order.id, reason: "booth_move" },
        });
        refundIds.push(stripeRefund.id);
        refundUpdates.push({ order_id: order.id, cumulative_refund_cents: cumulativeRefund });
        await enqueueQBConferenceRefund(order.id, stripeRefund.id, orderRefundCents);
      }
    } catch (err) {
      await logAuditEventSafe({
        action: "conference_booth_move",
        entityType: "organization",
        entityId: params.organizationId,
        actorId,
        actorType: "user",
        details: { success: false, reason: "stripe_refund_failed", error: err instanceof Error ? err.message : String(err) },
      });
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // newSubtotalCents/newTaxCents/newTotalCents (tax-inclusive) already came
  // from the preview above — reuse them rather than recomputing, so the
  // amount refunded/charged and the amount recorded on the new order can
  // never drift apart.
  const newOrderTotalCents = newTotalCents;

  const shouldMintImmediately = deltaCents <= 0;
  const sessionMarker = `admin_booth_move_${crypto.randomUUID()}`;

  let checkoutUrl: string | null = null;
  if (!shouldMintImmediately) {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "cad",
            unit_amount: deltaCents,
            product_data: { name: "Booth move — price difference" },
          },
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/conference/${params.conferenceId}/floor-plan`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/conference/${params.conferenceId}/floor-plan`,
      metadata: { checkout_kind: "conference", booth_move_session: sessionMarker },
    });
    checkoutUrl = checkoutSession.url;
  }

  const { data: rpcResult, error: rpcError } = await db.rpc("execute_booth_move", {
    p_organization_id: params.organizationId,
    p_conference_id: params.conferenceId,
    p_old_booth_entity_ids: params.oldBoothEntityIds,
    p_new_booth_entity_ids: params.newBoothEntityIds,
    p_old_total_cents: oldTotalCents,
    p_new_total_cents: newTotalCents,
    p_refund_updates: refundUpdates,
    p_refund_ids: refundIds,
    p_new_order_subtotal_cents: newSubtotalCents,
    p_new_order_tax_cents: newTaxCents,
    p_new_order_total_cents: newOrderTotalCents,
    p_stripe_checkout_session_id: sessionMarker,
    p_should_mint_immediately: shouldMintImmediately,
    p_actor_id: actorId,
    p_reason: params.reason,
  });

  if (rpcError || !rpcResult) {
    await logAuditEventSafe({
      action: "conference_booth_move",
      entityType: "organization",
      entityId: params.organizationId,
      actorId,
      actorType: "user",
      details: {
        success: false,
        reason: "db_step_failed_after_refund",
        error: rpcError?.message,
        refundIds,
        note: "Stripe refund(s) already issued — DB release/grant failed after. Needs manual reconciliation.",
      },
    });
    return {
      success: false,
      error: `Refund succeeded but the database step failed: ${rpcError?.message}. Stripe refund IDs ${refundIds.join(", ")} — this needs manual follow-up, do not retry blindly.`,
    };
  }

  const result = rpcResult as { new_order_id: string; minted: boolean };

  if (result.minted) {
    await enqueueQBConferenceReceipt(result.new_order_id);
  }

  await logAuditEventSafe({
    action: "conference_booth_move",
    entityType: "organization",
    entityId: params.organizationId,
    actorId,
    actorType: "user",
    details: {
      success: true,
      oldBoothEntityIds: params.oldBoothEntityIds,
      newBoothEntityIds: params.newBoothEntityIds,
      oldTotalCents,
      newTotalCents,
      deltaCents,
      refundIds,
      newOrderId: result.new_order_id,
      minted: result.minted,
      reason: params.reason,
    },
  });

  return { success: true, data: { newOrderId: result.new_order_id, minted: result.minted, checkoutUrl } };
}
