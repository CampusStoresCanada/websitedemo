/**
 * What a person standing in the hall can buy for their own organisation.
 *
 * ⛔ THE BUYER IS THE ORGANISATION, not the person holding the phone. Stephen
 * settled this outright: "They self scan they are buying for their
 * organization. So I self scan my badge and I add 4 tickets to tonight's
 * networking thing? Great, no worries. That now becomes 4 tickets for the
 * organization." Everything here follows from that — the seats land in the
 * org's balance, the invoice is the org's, and the tax treatment is the one
 * their province already gets.
 *
 * ⛔ NO NEW COMMERCE, for the same reason the check-in desk got none: the cards
 * rendered from this call `addOfferToCart` and land in the same cart, the same
 * checkout and the same webhook the public storefront uses. A second way to buy
 * a reception ticket is a second way to price and tax one.
 *
 * Pure functions, separated from the component so the rules are testable
 * without a database or a render.
 */

import type { ConferenceOffer } from "@/lib/actions/conference-entities";
import type { SeatHolding } from "@/lib/conference/seats";

/**
 * Kinds a person can never buy from their own account page.
 *
 * ⛔ A BOOTH IS NOT A SELF-SERVE PURCHASE. It is a months-long sales
 * conversation with a floor plan, a contract and a placement, and the same
 * exclusion already guards the check-in desk. ⛔ A MEMBERSHIP RENEWAL IS NOT
 * A CONFERENCE EXTRA — it is dues, it changes the organisation's standing for
 * a year, and nobody's colleague gets to renew it from a phone in a hallway
 * because the button was there.
 */
export const SELF_PURCHASE_EXCLUDED_KINDS = ["booth", "membership_renewal"] as const;

/**
 * The offers to show on someone's own account page.
 *
 * ⚠️ `eligible` is doing real work and is NOT cosmetic: listConferenceOffers
 * resolves audience, buyer tier and any `requires_ownership_of` gate into that
 * flag. Showing an ineligible offer here would put a button in front of
 * somebody that refuses them at the cart, which is the worst place to find out.
 */
export function selfBuyableOffers(offers: ConferenceOffer[]): ConferenceOffer[] {
  const excluded = new Set<string>(SELF_PURCHASE_EXCLUDED_KINDS);
  return offers.filter((offer) => offer.eligible && !excluded.has(offer.kind));
}

/**
 * How many seats of each entity the organisation owns and has named nobody to.
 *
 * ⛔ REPORTED, NEVER USED TO HIDE AN OFFER. An organisation holding one spare
 * reception ticket, whose staffer needs four for guests, still has to buy
 * three — removing the card because a free seat exists would leave them unable
 * to buy at all, and they would have no idea why. The count is information for
 * the person deciding; the decision stays theirs.
 */
export function unassignedByEntity(seats: SeatHolding[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const seat of seats) {
    if (seat.holderPersonId) continue;
    out.set(seat.entityId, (out.get(seat.entityId) ?? 0) + 1);
  }
  return out;
}
