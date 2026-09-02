/**
 * How long a refusal binds, and when to ask about it.
 *
 * Pure. `org_meeting_refusals` already carries everything this needs —
 * `first_declared_at`, `reaffirmed_at`, `retired_at`, and who declared it. What
 * was missing is the behaviour: nothing decided when a refusal stops applying,
 * and nothing ever asked whether it still stood.
 *
 * ── A refusal expires on its own ────────────────────────────────────────────
 *
 * ⛔ It does NOT persist until a human clears it. That sounds careful and is a
 * trap: clearing an old blackout is nobody's job, so persists-until-cleared
 * becomes permanent in practice. Relationships change and people smarten up;
 * a grudge that ran three years can end without anyone filing anything.
 *
 * ── And an aging one is WORK, not just a timer ──────────────────────────────
 *
 * A refusal that has sat a long time is a stuck commercial relationship, and the
 * association is the one party who can ask about it without either side losing
 * face. So the clock raises a prompt for a human rather than quietly flipping a
 * flag. These are businesses; there is usually money on both sides of a thaw.
 *
 * Because re-affirming is one click, the lapse can be generous. Asking too early
 * costs a mildly annoyed "yes, still no". Never asking costs a relationship that
 * stays dead because nobody was responsible for checking.
 *
 * ── What this must never become ─────────────────────────────────────────────
 *
 * ⛔ A refusal is a FILTER and decays as one: blocking → not blocking. It is
 * never a score, a weight, or a vector.
 *   - As a score it is inferable from rankings — the refusal leaks out through
 *     the number.
 *   - As a vector it drags the declaring org away from the refused org's whole
 *     NEIGHBOURHOOD, generalising a grudge about one company into a
 *     category-wide aversion nobody stated.
 * See the ⛔ in `lib/match/score.ts`: an early version took a blocklist and
 * dropped those pairs, which made the scorer the thing deciding who may not meet.
 */

/** The columns this reasoning needs. A row may carry more. */
export interface RefusalRow {
  declaring_org_id: string;
  refused_org_id: string;
  declared_by_contact_id?: string | null;
  first_declared_at: string;
  reaffirmed_at?: string | null;
  retired_at?: string | null;
}

/**
 * How long a refusal binds before it lapses, and how long before we ask.
 *
 * ⛔ No defaults. How long enmity should bind in THIS community is a judgement
 * about these people, not a constant for whoever happens to be writing the
 * module — the same mistake as the axis weights the match engine had to tear
 * out. The caller reads it from policy and passes it in; forgetting to is a type
 * error rather than a silently invented number.
 */
export interface RefusalPolicy {
  /** Past this age it stops being enforced. */
  lapseAfterDays: number;
  /** Past this age, raise a thaw prompt — necessarily shorter than the lapse. */
  promptAfterDays: number;
}

export interface RefusalStanding {
  /** Whether this pairing must still be removed before anything is scored. */
  enforced: boolean;
  /** Days since it was last declared or re-affirmed. */
  ageDays: number;
  /** Retired by a human, rather than aged out. */
  retired: boolean;
  /** Still enforced, but old enough that someone should ask. */
  dueForThaw: boolean;
  /** Whichever of reaffirmed_at / first_declared_at the clock runs from. */
  standingSince: Date;
}

const DAY_MS = 86_400_000;

export function refusalStanding(
  row: RefusalRow,
  now: Date,
  policy: RefusalPolicy
): RefusalStanding {
  // ⛔ Re-affirming resets the clock. Saying it still stands IS the signal that
  // it still stands, and it is the cheapest possible act — one click against a
  // prompt we raised.
  const since = new Date(row.reaffirmed_at ?? row.first_declared_at);
  const ageDays = Math.max(0, (now.getTime() - since.getTime()) / DAY_MS);
  const retired = row.retired_at != null;

  const enforced = !retired && ageDays < policy.lapseAfterDays;

  return {
    enforced,
    ageDays,
    retired,
    // Only worth asking about something still in force. A lapsed refusal needs
    // no conversation — it has already stopped mattering.
    dueForThaw: enforced && ageDays >= policy.promptAfterDays,
    standingSince: since,
  };
}

/**
 * The pairings to remove before scoring.
 *
 * ⛔ Applied by the caller BEFORE any score is consulted, never by lowering one.
 * Returns pairs rather than a predicate so the exclusion is a visible, countable
 * step in a pipeline instead of a condition buried in a comparator.
 */
export function enforcedPairs(
  rows: readonly RefusalRow[],
  now: Date,
  policy: RefusalPolicy
): { declaringOrgId: string; refusedOrgId: string }[] {
  return rows
    .filter((r) => refusalStanding(r, now, policy).enforced)
    .map((r) => ({ declaringOrgId: r.declaring_org_id, refusedOrgId: r.refused_org_id }));
}

export interface ThawPrompt {
  /** The org that declared it — the ONLY party this may be raised with. */
  declaringOrgId: string;
  /** The person accountable for the original decision, when we know them. */
  declaredByContactId: string | null;
  refusedOrgId: string;
  ageDays: number;
  standingSince: Date;
}

/**
 * Refusals old enough to ask about, oldest first.
 *
 * ⛔ THE PROMPT GOES ONLY TO THE DECLARING ORG. Approaching the refused party —
 * "would you like to reconnect with McMaster?" — tells them McMaster refused
 * them. That is the refusal leaking through outreach instead of through the
 * score: the same failure wearing a different coat. `refusedOrgId` is returned
 * so a human knows what they are being asked about; it is never an address.
 *
 * ⚠️ The resulting task belongs to a named officer, not to a general queue.
 */
export function thawPrompts(
  rows: readonly RefusalRow[],
  now: Date,
  policy: RefusalPolicy
): ThawPrompt[] {
  return rows
    .map((r) => ({ row: r, standing: refusalStanding(r, now, policy) }))
    .filter(({ standing }) => standing.dueForThaw)
    .sort((a, b) => b.standing.ageDays - a.standing.ageDays)
    .map(({ row, standing }) => ({
      declaringOrgId: row.declaring_org_id,
      declaredByContactId: row.declared_by_contact_id ?? null,
      refusedOrgId: row.refused_org_id,
      ageDays: standing.ageDays,
      standingSince: standing.standingSince,
    }));
}
