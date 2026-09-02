/**
 * Whether a blackout applies to this conference.
 *
 * Pure. The mechanism is one question asked once a year, going into the
 * conference: **"Any blackouts? Can be for any reason. Just let us know the
 * organization."** Answering keeps it alive.
 *
 * ⛔ But it does NOT drop the moment somebody skips the question. Steve:
 * "Humans are exceptional at ignoring annoyances. Ask any man in pain who will
 * not see a doctor." A missed answer usually means the form went unread, not
 * that the relationship healed — so a blackout survives a missed cycle or two
 * and only fades after several.
 *
 * ⚠️ **The costs are wildly asymmetric, and the default follows the asymmetry.**
 * Holding a blackout that has quietly expired costs one meeting that could have
 * happened. Dropping one that is still live puts somebody in a small room with
 * the person they refused to be in a room with. The second is not recoverable by
 * apologising afterwards, so err toward holding.
 *
 * ⛔ An earlier version of this file had a thaw-prompt queue, an officer
 * assignment and a policy object for how long enmity binds. All invented.
 * Steve: "I don't need explanations or drama. Just 'this is a thing, please
 * uphold it this year.'" Renewal is the whole interface; the only thing the code
 * decides is how many missed asks it survives.
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
 * The two dates this reasoning needs.
 *
 * Separating them is the whole point: one says whether an org has replied to
 * THIS year's ask, the other says how far back a statement still counts.
 */
export interface CycleWindow {
  /** This year's ask went out. Distinguishes "said no" from "hasn't replied". */
  askedAt: Date;
  /** The oldest statement still honoured. Stated before this, and it has faded. */
  honourSince: Date;
}

/**
 * A window that honours a blackout through `graceCycles` missed annual asks.
 *
 * ⚠️ Two is the conservative default and it is a judgement, not a fact — an org
 * has to ignore the question three years running before a blackout fades. Raise
 * it rather than lower it: see the asymmetry above.
 */
export function annualWindow(askedAt: Date, graceCycles = 2): CycleWindow {
  const honourSince = new Date(askedAt);
  honourSince.setUTCFullYear(honourSince.getUTCFullYear() - (graceCycles + 1));
  return { askedAt, honourSince };
}

/**
 * Does this blackout still hold?
 *
 * Explicitly withdrawn — gone immediately; that is a human saying so.
 * Otherwise it holds while its last statement is no older than `honourSince`.
 *
 * ⚠️ Fading is how a relationship recovers, and it is the only way most of them
 * ever will: nobody writes in to announce a grudge is over. But it takes several
 * ignored asks, not one.
 */
export function holdsThisCycle(row: RefusalRow, window: CycleWindow): boolean {
  if (row.retired_at) return false;
  const stated = new Date(row.reaffirmed_at ?? row.first_declared_at);
  return stated.getTime() >= window.honourSince.getTime();
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
export function enforcedPairs(rows: readonly RefusalRow[], window: CycleWindow): OrgPair[] {
  return rows
    .filter((r) => holdsThisCycle(r, window))
    .map((r) => ({ declaringOrgId: r.declaring_org_id, refusedOrgId: r.refused_org_id }));
}

/**
 * Orgs that held a blackout last cycle and have not answered this year's ask.
 *
 * Not a nag list and not a thaw campaign — just who still owes an answer to the
 * question everyone was asked.
 *
 * ⚠️ Their blackout is very probably STILL BEING ENFORCED while they are on this
 * list: that is what the grace period is for. The list exists so a human can
 * tell "said no blackouts" apart from "has not replied yet" — the filter cannot
 * show that difference, because both look identical to it until the grace runs
 * out and the blackout silently stops applying.
 */
export function awaitingAnswer(rows: readonly RefusalRow[], window: CycleWindow): string[] {
  const answered = new Set<string>();
  const outstanding = new Set<string>();

  for (const row of rows) {
    if (row.retired_at) continue;
    const stated = new Date(row.reaffirmed_at ?? row.first_declared_at);
    // ⚠️ Against THIS year's ask, not the honour window. A blackout can still be
    // enforced (inside the grace) while its org has not replied this year —
    // those are exactly the orgs worth a nudge, and the ones the window hides.
    if (stated.getTime() >= window.askedAt.getTime()) answered.add(row.declaring_org_id);
    else outstanding.add(row.declaring_org_id);
  }
  for (const org of answered) outstanding.delete(org);
  return [...outstanding].sort();
}
