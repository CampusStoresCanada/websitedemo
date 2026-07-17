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
  event: ["education_access"],
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
