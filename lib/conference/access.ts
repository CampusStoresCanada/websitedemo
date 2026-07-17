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
