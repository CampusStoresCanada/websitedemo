/**
 * Conference data-obligations — pure core.
 *
 * What a person owes (name, dietary, emergency contact…) is the union of data
 * obligations across the grant types they hold, checked against their current
 * field values. The server wrapper that loads a person's held grant types from
 * their v3 seats lives in lib/actions/conference-access.ts.
 *
 * No server imports — everything here is unit-testable.
 * See docs/CONFERENCE_V2_BLUEPRINT.md.
 */

import { collectDataObligations, type DataObligation, type GrantType } from "./grants";

export type PersonObligationStatus = {
  obligations: DataObligation[];
  missing: DataObligation[];
  isReady: boolean;
};

/** Person field values keyed by DataObligation.key (subset of conference_people). */
export type PersonObligationFields = Record<string, unknown>;

function fieldIsPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Readiness derived from the union of data obligations across the grant types a
 * person holds, checked against their current field values: a person owes an
 * emergency contact because they hold a grant that requires it, not because a
 * function assumes all delegates do.
 */
export function computePersonObligations(
  heldGrantTypes: GrantType[],
  fields: PersonObligationFields
): PersonObligationStatus {
  const obligations = collectDataObligations(heldGrantTypes);
  const missing = obligations.filter((obligation) => !fieldIsPresent(fields[obligation.key]));
  return { obligations, missing, isReady: missing.length === 0 };
}

/**
 * Which obligations belong to the PERSON rather than the organisation.
 *
 * An org admin buys the seat and knows the badge name, so those are theirs to
 * fill. What someone is allergic to, what they need to get around the venue,
 * and who to phone if something happens are facts about a person, and the
 * organisation is not a reliable narrator of any of them. Getting this wrong
 * is not a UI nicety: a guessed allergy is a medical risk and a stale
 * emergency contact is worse than none.
 *
 * So these are shown to an admin as outstanding, never as an input — the
 * affordance on that side is to send the person to their own profile, and the
 * write is refused server-side, not just hidden.
 */
export const PERSONAL_OBLIGATION_KEYS: readonly string[] = [
  "dietary_restrictions",
  "accessibility_needs",
  "emergency_contact_name",
  "emergency_contact_phone",
];

/** True when only the person themselves may answer this. */
export function isPersonalObligation(key: string): boolean {
  return PERSONAL_OBLIGATION_KEYS.includes(key);
}
