/**
 * How long a partner's verdict about a member stays true.
 *
 * Pure. A partner rates the stores in Your Market — "I'd approach them", "right
 * fit, wrong time", "not a fit" — and separately states whether they already do
 * business together. Both are claims about a relationship, and relationships
 * move.
 *
 * ⛔ A verdict with no expiry becomes permanent, because re-confirming it is
 * nobody's job. That is the lesson `refusal-standing.ts` already carries about
 * blackouts, and it applies harder here: a partner who loses an account will
 * never think to come back and un-tick "currently doing business together", so
 * the row quietly stops being prospected forever.
 *
 * ⛔ Stale does NOT mean forgotten. A faded verdict is resurfaced for
 * confirmation, never silently reverted to unknown — the same trap as reading
 * "no rows" as "no answer". The partner sees what they said and when, and is
 * asked whether it still holds.
 *
 * ⚠️ Different claims decay at different rates, and not because three numbers
 * felt right. Each window is the rate at which that particular claim goes stale
 * in the world:
 *
 *   is_customer     an account can be lost in a quarter, and continuing to hide
 *                   a winnable store is the most expensive error here
 *   would_approach  an intent; either they acted on it or it went cold
 *   wrong_time      says so itself — the point is to ask again next season
 *   not_a_fit       a category mismatch rarely reverses; asking often is nagging
 */

/** What a partner asserted. One row per assertion, never overwritten. */
export type RatingAxis = "fit" | "relationship";

export type FitValue = "would_approach" | "wrong_time" | "not_a_fit";
export type RelationshipValue = "is_customer" | "not_customer";
export type RatingValue = FitValue | RelationshipValue;

export interface RatingRow {
  memberOrgId: string;
  axis: RatingAxis;
  value: RatingValue;
  ratedAt: string;
}

/**
 * Months each claim stands before it is worth asking again.
 *
 * ⚠️ Deliberately not one global number. `not_a_fit` at six months would nag a
 * partner about the same wrong store twice a year; `is_customer` at eighteen
 * would hide a store they stopped selling to over a year ago.
 */
export const STANDS_FOR_MONTHS: Record<RatingValue, number> = {
  is_customer: 6,
  not_customer: 12,
  would_approach: 6,
  wrong_time: 6,
  not_a_fit: 18,
};

export interface Standing {
  value: RatingValue;
  ratedAt: string;
  /** Past its window — still shown, but asked about again. */
  stale: boolean;
  /** Whole months since the partner said it. */
  ageMonths: number;
}

const monthsBetween = (from: Date, to: Date) => {
  const m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12
    + (to.getUTCMonth() - from.getUTCMonth());
  // Don't round a partial month up: something said on the 30th is not a month
  // old on the 1st.
  return to.getUTCDate() < from.getUTCDate() ? m - 1 : m;
};

/**
 * The current standing per axis for one member, newest assertion winning.
 *
 * ⚠️ Newest, not only. The table is append-only — a changed mind is a new row —
 * so how often a partner flips, and after how long, survives for anyone who
 * wants to ask that question later.
 */
export function currentStanding(
  rows: readonly RatingRow[],
  memberOrgId: string,
  now: Date
): Partial<Record<RatingAxis, Standing>> {
  const out: Partial<Record<RatingAxis, Standing>> = {};
  const mine = rows
    .filter((r) => r.memberOrgId === memberOrgId)
    .sort((a, b) => (a.ratedAt < b.ratedAt ? 1 : -1));

  for (const r of mine) {
    if (out[r.axis]) continue; // an older assertion on an axis already answered
    const ageMonths = monthsBetween(new Date(r.ratedAt), now);
    out[r.axis] = {
      value: r.value,
      ratedAt: r.ratedAt,
      stale: ageMonths >= STANDS_FOR_MONTHS[r.value],
      ageMonths,
    };
  }
  return out;
}

/**
 * Should this member be hidden from the prospect list?
 *
 * ⛔ Only a CURRENT "is_customer" suppresses. Once it goes stale the store comes
 * back, because "we sold to them eighteen months ago" is not a reason to keep a
 * partner from seeing them — it is a reason to ask whether they still do.
 *
 * ⛔ `not_a_fit` does NOT suppress, however confidently it was said. It is a
 * verdict on the ENGINE, not an instruction about the store, and letting it hide
 * rows would turn an evaluation label into a filter — after which nobody could
 * tell whether the engine improved or had simply been told to stop guessing.
 */
export function suppressedFromProspects(
  rows: readonly RatingRow[],
  memberOrgId: string,
  now: Date
): boolean {
  const rel = currentStanding(rows, memberOrgId, now).relationship;
  return !!rel && rel.value === "is_customer" && !rel.stale;
}

/**
 * Members whose standing has faded and is worth re-confirming.
 *
 * Not a nag list — a partner who ignores it loses nothing, and the underlying
 * claim keeps being honoured until they say otherwise. It exists so a screen can
 * distinguish "they told us this last week" from "they told us this in 2024".
 */
export function needsReconfirming(
  rows: readonly RatingRow[],
  now: Date
): { memberOrgId: string; axis: RatingAxis; value: RatingValue; ageMonths: number }[] {
  const out: { memberOrgId: string; axis: RatingAxis; value: RatingValue; ageMonths: number }[] = [];
  for (const memberOrgId of new Set(rows.map((r) => r.memberOrgId))) {
    const standing = currentStanding(rows, memberOrgId, now);
    for (const axis of ["fit", "relationship"] as RatingAxis[]) {
      const s = standing[axis];
      if (s?.stale) out.push({ memberOrgId, axis, value: s.value, ageMonths: s.ageMonths });
    }
  }
  return out.sort((a, b) => b.ageMonths - a.ageMonths);
}
