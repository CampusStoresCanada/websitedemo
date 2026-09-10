import type { GrantType } from "./grants";

/**
 * Fork B bridge: what a held v3 Offer kind implies for attendee data-collection.
 * Holding a `registration` owes the same data a delegate badge_seat does, a
 * `booth` the same as booth_space, etc. — so the org/me obligations pages can
 * read v3 holdings while reusing the existing, tested DataObligation definitions
 * (lib/conference/grants.ts) instead of inventing a parallel obligation model.
 * Kinds not listed here carry no attendee obligations.
 */
export const ENTITY_KIND_TO_GRANT_TYPES: Record<string, GrantType[]> = {
  registration: ["badge_seat"],
  booth: ["booth_space"],
  booth_category: ["booth_space"],
  meal: ["meal_access"],
  session: ["education_access"],
  // A social function feeds people, so holding a ticket to one owes a dietary
  // answer. Mapped to education_access ALONE this was the reason nothing ever
  // asked: education_access carries no obligations, `meal` is the only other
  // route to dietary_restrictions, and CSC 2027 sells no `meal` entity — its
  // catered functions are the Meet & Greet Reception and the Wednesday
  // Offsite, both kind `event`. So the column existed, the readiness list knew
  // how to report it missing, and no living person could ever be asked.
  //
  // ⚠️ Emergency contact is deliberately NOT added here. That obligation comes
  // from `offsite_seat`, and whether an event leaves the venue is a fact about
  // the individual event, not about the kind — the Wednesday Offsite needs one
  // and a reception in the exhibit hall does not. Kind-level mapping cannot
  // express that; it needs a per-entity answer.
  event: ["education_access", "meal_access"],
  networking: ["education_access"],
  meeting: ["meeting_access"],
  day: ["day_access"],
};

/** The grant types implied by a set of held v3 entity kinds (deduped). */
export function grantTypesForKinds(kinds: Iterable<string>): GrantType[] {
  const out = new Set<GrantType>();
  for (const kind of kinds) {
    for (const grant of ENTITY_KIND_TO_GRANT_TYPES[kind] ?? []) out.add(grant);
  }
  return [...out];
}
