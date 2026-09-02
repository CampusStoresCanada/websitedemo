/**
 * Whether a blackout applies to this conference.
 *
 * Pure. The whole mechanism is one question asked once a year, going into the
 * conference: **"Any blackouts? Can be for any reason. Just let us know the
 * organization."**
 *
 * That is the entire design. Answer it and the blackout holds for the year.
 * Don't answer and it doesn't. There is no clock to tune, no half-life, no
 * expiry to compute, and nothing to chase.
 *
 * ⛔ An earlier version of this file had a lapse period, a thaw-prompt queue and
 * a policy object for how long enmity binds. All of it invented. Steve: "It's
 * just an annual renewal… I don't need explanations or drama. Just 'this is a
 * thing, please uphold it this year.'" The annual ask already does every job
 * that machinery was built to do — including letting a relationship recover,
 * which happens by simply not being mentioned again.
 *
 * ⛔ No reason is required and none should be solicited. "Can be for any
 * reason." A stored justification is a liability nobody asked us to hold, and
 * the answer would not change if we had it.
 *
 * ⛔ A blackout is a FILTER. It removes a pairing before anything is scored, and
 * is never a score, a weight or a vector.
 *   - As a score it is inferable from rankings — the refusal leaks through the
 *     number.
 *   - As a vector it drags the declaring org away from the refused org's whole
 *     NEIGHBOURHOOD, generalising one company into a category-wide aversion
 *     nobody stated.
 * See the ⛔ in `lib/match/score.ts`: an early version took a blocklist and
 * dropped those pairs, which made the scorer the thing deciding who may not meet.
 */

/** The columns this reasoning needs. A row may carry more. */
export interface RefusalRow {
  declaring_org_id: string;
  refused_org_id: string;
  first_declared_at: string;
  /** Set when the org answered this year's ask. */
  reaffirmed_at?: string | null;
  /** Withdrawn explicitly, rather than by simply not renewing. */
  retired_at?: string | null;
}

export interface OrgPair {
  declaringOrgId: string;
  refusedOrgId: string;
}

/**
 * Does this blackout hold for the cycle whose ask went out at `askedAt`?
 *
 * Declared or re-affirmed on or after the ask — someone said it this year.
 *
 * ⚠️ A blackout first declared BEFORE this year's ask and not renewed does not
 * hold. That is the point, not an oversight: not mentioning it again is how a
 * relationship recovers, and it is the only way most of them ever will. Nobody
 * writes in to announce a grudge is over.
 */
export function holdsThisCycle(row: RefusalRow, askedAt: Date): boolean {
  if (row.retired_at) return false;
  const stated = new Date(row.reaffirmed_at ?? row.first_declared_at);
  return stated.getTime() >= askedAt.getTime();
}

/**
 * The pairings to remove before scoring.
 *
 * ⛔ Applied by the caller BEFORE any score is consulted, never by lowering one.
 * Returns pairs rather than a predicate so the exclusion is a visible, countable
 * step in a pipeline instead of a condition buried in a comparator.
 *
 * ⚠️ One-directional by design. A refuses B does not mean B refuses A, and
 * consumers that want the pairing gone in both directions must say so — a
 * scheduler should, a directory listing probably should not.
 */
export function enforcedPairs(rows: readonly RefusalRow[], askedAt: Date): OrgPair[] {
  return rows
    .filter((r) => holdsThisCycle(r, askedAt))
    .map((r) => ({ declaringOrgId: r.declaring_org_id, refusedOrgId: r.refused_org_id }));
}

/**
 * Orgs that held a blackout last cycle and have not answered this year's ask.
 *
 * Not a nag list and not a thaw campaign — just who still owes an answer to the
 * question everyone was asked. Until they answer, their old blackout does NOT
 * hold; this exists so a human can tell "said no blackouts" apart from "has not
 * replied yet", which the filter alone cannot show.
 */
export function awaitingAnswer(rows: readonly RefusalRow[], askedAt: Date): string[] {
  const answered = new Set<string>();
  const outstanding = new Set<string>();

  for (const row of rows) {
    if (holdsThisCycle(row, askedAt)) answered.add(row.declaring_org_id);
    else if (!row.retired_at) outstanding.add(row.declaring_org_id);
  }
  for (const org of answered) outstanding.delete(org);
  return [...outstanding].sort();
}
