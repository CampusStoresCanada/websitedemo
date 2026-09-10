"use server";

/**
 * Selling at the check-in desk.
 *
 * ⛔ THE SCENARIO, in Stephen's words: John Doe is the fifth person on a booth
 * that includes four staff registrations. He turns up without a badge. There is
 * nothing to name him to — a booth's allocation is fixed and extra registrations
 * sell separately — so this is not a printing problem. It is a sale, then a
 * seat, then a badge.
 *
 * ⛔ NO NEW COMMERCE. The pipeline already exists and is the one the website
 * uses: addOfferToCart -> createConferenceCheckout -> Stripe -> webhook ->
 * registration-mint -> seat. A second "desk checkout" would be a second way to
 * take money for the same thing, and the two would price, tax and reconcile
 * differently the first time anybody changed one.
 *
 * ⚠️ Capacity is enforced inside the existing path, atomically, in a Postgres
 * function with advisory locks. That is what makes selling into a 160-cap
 * reception at the door safe rather than a race with the till.
 */

import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { addOfferToCart, createConferenceCheckout } from "@/lib/actions/conference-commerce";

export type DeskSaleResult =
  | {
      ok: true;
      /** Stripe Checkout URL, or the hosted invoice URL when invoiced. */
      checkoutUrl: string;
      orderId: string;
      priceCents: number;
      offerName: string;
      paymentMethod: "card" | "invoice";
    }
  | { ok: false; error: string };

/**
 * Put one offer in the organisation's cart and hand back a Stripe URL.
 *
 * ⛔ The ORGANISATION is the buyer of record, not the person standing there.
 * A booth's fifth staff registration belongs to the company the same way the
 * first four did — it lands on their invoice, their receipt, their tax
 * treatment. The attendee is who the seat gets assigned to afterwards, which is
 * a different question and a different write.
 */
export async function sellAtDesk(params: {
  conferenceId: string;
  organizationId: string;
  offerEntityId: string;
  /** Who it is for, so the order carries a name rather than "assign later". */
  attendee?: { name: string; email: string | null } | null;
  /** Where Stripe returns to — usually the desk itself. */
  successUrl: string;
  cancelUrl: string;
  /**
   * ⛔ "Are you able to pay now, or would you like us to invoice your company?"
   *
   * ⚠️ INVOICE IS THE ONE THAT KEEPS THE LINE MOVING. Taking a card is the slow,
   * failure-prone step at a desk with people behind them — a declined card, a
   * phone with no signal, a person who left their wallet at the booth. Invoicing
   * finishes in one keystroke and the badge prints immediately, because the seat
   * is minted when the invoice is PAID and the order is created either way.
   */
  paymentMethod?: "card" | "invoice";
}): Promise<DeskSaleResult> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = createAdminClient();
  const { data: offer } = await db
    .from("conference_entities")
    .select("id, name, kind, is_for_sale, price_cents")
    .eq("id", params.offerEntityId)
    .eq("conference_id", params.conferenceId)
    .maybeSingle();
  if (!offer) return { ok: false, error: "That offer is not part of this conference." };
  if (!offer.is_for_sale) {
    // ⚠️ Refuse rather than quietly selling something withdrawn from sale. If a
    // conference has stopped selling day passes, the desk must not be the one
    // place that still can.
    return { ok: false, error: `${offer.name} is not for sale.` };
  }

  const added = await addOfferToCart({
    conferenceId: params.conferenceId,
    organizationId: params.organizationId,
    offerEntityId: params.offerEntityId,
    quantity: 1,
    // ⛔ Named on the way in. A registration bought "assign later" mints a seat
    // nobody holds, which is precisely the blank-badge state this sale exists to
    // get somebody OUT of.
    attendees: params.attendee ? [{ name: params.attendee.name, email: params.attendee.email }] : undefined,
    allowConferenceOps: true,
  });
  if (!added.success) return { ok: false, error: added.error };

  const checkout = await createConferenceCheckout({
    conferenceId: params.conferenceId,
    organizationId: params.organizationId,
    successUrl: params.successUrl,
    cancelUrl: params.cancelUrl,
    allowConferenceOps: true,
    paymentMethod: params.paymentMethod ?? "card",
  });
  if (!checkout.success) return { ok: false, error: checkout.error };

  return {
    ok: true,
    checkoutUrl: checkout.data.checkoutUrl,
    orderId: checkout.data.orderId,
    priceCents: added.data.unitPriceCents,
    offerName: offer.name as string,
    paymentMethod: params.paymentMethod ?? "card",
  };
}

/**
 * What the desk can sell to this person right now.
 *
 * ⛔ Derived from the catalogue, not a list. A conference that sells something
 * nobody here has thought of gets it on the desk for free; one that withdraws a
 * day pass loses it everywhere at once.
 */
export async function listDeskOffers(conferenceId: string): Promise<
  | { ok: true; offers: Array<{ id: string; name: string; kind: string; priceCents: number | null }> }
  | { ok: false; error: string }
> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data } = await createAdminClient()
    .from("conference_entities")
    .select("id, name, kind, price_cents")
    .eq("conference_id", conferenceId)
    .eq("is_for_sale", true)
    // ⚠️ Registrations and events only. A booth is a months-long sales
    // conversation, not something anybody buys while standing at a desk.
    .in("kind", ["registration", "event"])
    .order("kind")
    .order("name");

  return {
    ok: true,
    offers: (data ?? []).map((o) => ({
      id: o.id as string,
      name: o.name as string,
      kind: o.kind as string,
      priceCents: (o.price_cents as number | null) ?? null,
    })),
  };
}
