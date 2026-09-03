/**
 * Weight and decay.
 *
 * Two ideas:
 *
 *  1. **Not every act means the same thing.** Typing a query is a deliberate
 *     ask. Opening an email is barely an act at all. Joining a space named for
 *     a category is a standing declaration. One table of numbers, tuned in one
 *     place, rather than each producer inventing its own scale.
 *
 *  2. **Judgements decay.** A vendor that dropped a product line two years ago
 *     should stop earning boosts, and a search from last week should outweigh
 *     one from last year. Decay is what keeps revealed preference *fresher*
 *     than a form filled in eighteen months ago — which is the entire reason
 *     behavioural signal is worth collecting.
 *
 * Half-lives differ by verb because the acts differ in how long they stay true.
 * A search is a moment; joining a space is a position you hold.
 */

import type { SignalVerb } from "./types";

export interface VerbProfile {
  /** Base weight before decay. */
  weight: number;
  /** Days after which the weight halves. */
  halfLifeDays: number;
  /** Why this verb is worth what it is worth. */
  note: string;
}

export const VERB_PROFILES: Record<SignalVerb, VerbProfile> = {
  // ── Explicit preference ──────────────────────────────────────────────────
  refused: {
    weight: 10,
    halfLifeDays: 730,
    note:
      "A declared refusal to meet. Nothing else in the system is this informative. " +
      "⛔ The decay here affects its use as a TRAINING FEATURE only — a refusal " +
      "never expires into permission. Enforcement reads the declaration (and its " +
      "retired_at), never this weight. Timestamp from reaffirmed_at, so an " +
      "un-reaffirmed grudge fades slowly rather than standing forever.",
  },
  preferred: {
    weight: 8,
    halfLifeDays: 365,
    note: "An explicit top-5 pick. They named this one unprompted.",
  },
  selected: {
    weight: 6,
    halfLifeDays: 365,
    note: "Chose this one when shown alternatives — a pick against a known field.",
  },
  rejected: {
    weight: 4,
    halfLifeDays: 365,
    note:
      "Shown and passed over. Deliberately below `selected`: passing over is " +
      "confounded — no time, already emailed them, met them last year — whereas " +
      "choosing is not.",
  },

  // ── Implicit behaviour ───────────────────────────────────────────────────
  posted: {
    weight: 4,
    halfLifeDays: 540,
    note: "A written statement in a category space. The strongest thing short of a form.",
  },
  searched: {
    weight: 3,
    halfLifeDays: 90,
    note: "A deliberate ask — but what someone needed last spring may be bought by now.",
  },
  joined: {
    weight: 3,
    halfLifeDays: 730,
    note: "A position held, not a moment. Decays slowly because it stays true until they leave.",
  },
  attended: {
    weight: 3,
    halfLifeDays: 365,
    note: "Showed up. Materially stronger than saying you would.",
  },
  commented: {
    weight: 2.5,
    halfLifeDays: 365,
    note: "Engaged with someone else's topic rather than raising their own.",
  },
  filtered: {
    weight: 2,
    halfLifeDays: 90,
    note: "Picked the term out of our own list — no translation, but a cheap click.",
  },
  clicked: {
    weight: 2,
    halfLifeDays: 90,
    note: "Followed through to a catalogue or an outbound link. Intent, not a glance.",
  },
  scanned: {
    weight: 5,
    halfLifeDays: 365,
    note:
      "A conference badge scan — consented, mutual and deliberate. The QR is on the " +
      "BACK of the badge and consent is taken up front, so there are no drive-bys: " +
      "someone physically turned their badge around. That makes it the strongest " +
      "implicit act we record, well above a click. Counts in both directions; a member " +
      "scanning a partner is its own signal. ⚠️ Print-directory QR scans are a different " +
      "act entirely — anonymous by design, no actor org, and they never reach this table.",
  },
  rsvped: {
    weight: 2,
    halfLifeDays: 180,
    note: "Said they would come. Weaker than having come.",
  },
  viewed: {
    weight: 1,
    halfLifeDays: 60,
    note: "A glance. Cheap to do, so cheap to score, and stale quickly.",
  },
  opened: {
    weight: 0.5,
    halfLifeDays: 60,
    note: "An email open. Barely an act — image proxies open mail nobody read.",
  },
};

const DAY_MS = 86_400_000;

/**
 * Weight of one event as of `now`.
 *
 * `baseWeight` overrides the verb default when a producer knows more — a search
 * that returned no results, say, or a post that is one line long.
 */
export function decayedWeight(
  verb: SignalVerb,
  occurredAt: Date,
  now: Date,
  baseWeight?: number
): number {
  const profile = VERB_PROFILES[verb];
  const weight = baseWeight ?? profile.weight;

  const ageDays = (now.getTime() - occurredAt.getTime()) / DAY_MS;
  // A future timestamp is clock skew, not a prediction — treat it as now rather
  // than letting it earn a bonus above full weight.
  if (ageDays <= 0) return weight;

  return weight * Math.pow(0.5, ageDays / profile.halfLifeDays);
}

/**
 * Below this, a rolled-up term is noise — one stale glance keeping a category
 * alive forever at three decimal places. Dropped rather than stored.
 */
export const NEGLIGIBLE_WEIGHT = 0.05;
