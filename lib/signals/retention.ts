/**
 * How long signal is kept, derived from how long it still means anything.
 *
 * The raw log lives on owned hardware and is mirrored three ways — local Time
 * Machine, an onsite mirror, and an encrypted offsite copy. That is good
 * durability, and it means every person-level row exists in triplicate. Keeping
 * everything forever would therefore be a liability that grows while its value
 * falls to nothing.
 *
 * ── Retention is not a separate policy; it is decay, read backwards ──────────
 *
 * A search halves in weight every 90 days. After ~531 days it contributes less
 * than `NEGLIGIBLE_WEIGHT` and is already being dropped from every rollup — the
 * row is doing nothing but sitting there. So the horizon is COMPUTED from the
 * verb's own weight and half-life rather than picked. Change a half-life and
 * retention follows automatically; there is no second set of numbers to keep in
 * sync, and no way for the two to disagree.
 *
 * ── ⛔ Drop the person before the text ───────────────────────────────────────
 *
 * `actor_contact_id` is the sensitive half and the least useful over time — it
 * exists only so distinct-people can be counted, and nobody reports "how many
 * distinct people searched this in 2024". `raw_text` is the opposite: it is what
 * makes an old event re-resolvable when the vocabulary improves, and on its own
 * it is a search string attached to an organisation, not to a person.
 *
 * So an ageing event is DEPERSONALISED long before it is deleted.
 *
 * ── Declarations are not subject to this ────────────────────────────────────
 *
 * A refusal or a top-5 pick is a deliberate statement, there are very few of
 * them, and they are the highest-value training signal in the system. Volume was
 * never the problem there. They are depersonalised on the same schedule and then
 * kept indefinitely.
 */

import { NEGLIGIBLE_WEIGHT, VERB_PROFILES } from "./decay";
import { isExplicitVerb } from "./ingest";
import type { SignalEvent, SignalVerb } from "./types";

const DAY_MS = 86_400_000;

/**
 * Days until this verb's weight decays below the point any rollup would keep it.
 *
 * `weight * 0.5^(days / halfLife) < NEGLIGIBLE_WEIGHT`
 *   → `days > halfLife * log2(weight / NEGLIGIBLE_WEIGHT)`
 */
export function scoringHorizonDays(verb: SignalVerb): number {
  const { weight, halfLifeDays } = VERB_PROFILES[verb];
  if (weight <= NEGLIGIBLE_WEIGHT) return 0;
  return Math.ceil(halfLifeDays * Math.log2(weight / NEGLIGIBLE_WEIGHT));
}

/**
 * How much longer the raw text is worth keeping after the event stops scoring.
 *
 * Not zero, because re-resolution is the whole reason `rawText` exists: adding
 * one synonym should retroactively improve every event that word appeared in,
 * and an event that scores nothing today may score again under a better
 * vocabulary. Two further half-lives is enough to survive several rounds of
 * vocabulary work without keeping strings indefinitely.
 */
const TEXT_GRACE_MULTIPLIER = 2;

/**
 * Hard ceiling on keeping raw text for an implicit act.
 *
 * ⚠️ Without this the multiplier compounds on the longer half-lives into
 * numbers that are not a policy: a Circle post's text would be kept 28 years and
 * a space join 35. "Five years" is a sentence someone can evaluate; "35 years"
 * is "forever" wearing a calculation.
 *
 * Declarations are exempt — they are kept indefinitely on purpose.
 */
const MAX_TEXT_RETENTION_DAYS = 5 * 365;

export type RetentionAction =
  /** Still scoring. Leave it alone. */
  | "keep"
  /** No longer moves any score: null the contact id, keep everything else. */
  | "depersonalize"
  /** Past re-resolution value too: delete the row, the rollups already hold its shape. */
  | "delete";

export interface RetentionDecision {
  action: RetentionAction;
  ageDays: number;
  scoringHorizonDays: number;
  why: string;
}

/**
 * What should happen to one event today.
 *
 * Pure, so the nightly job can report what it is about to do before doing it —
 * a deletion pass that cannot be previewed is one nobody should run.
 */
export function retentionFor(event: SignalEvent, now: Date): RetentionDecision {
  const ageDays = Math.max(0, (now.getTime() - event.occurredAt.getTime()) / DAY_MS);
  const horizon = scoringHorizonDays(event.verb);

  if (ageDays <= horizon) {
    return {
      action: "keep",
      ageDays,
      scoringHorizonDays: horizon,
      why: `still within the ${horizon}-day scoring horizon for "${event.verb}"`,
    };
  }

  // A deliberate statement is kept for good — few of them, high value, and
  // deleting someone's declared refusal because it got old would be absurd.
  if (isExplicitVerb(event.verb)) {
    return {
      action: event.actorContactId ? "depersonalize" : "keep",
      ageDays,
      scoringHorizonDays: horizon,
      why: `"${event.verb}" is a declaration — depersonalised but never deleted`,
    };
  }

  const textHorizon = Math.min(horizon * (1 + TEXT_GRACE_MULTIPLIER), MAX_TEXT_RETENTION_DAYS);
  if (ageDays <= textHorizon || !event.rawText) {
    return {
      action: event.actorContactId ? "depersonalize" : "keep",
      ageDays,
      scoringHorizonDays: horizon,
      why:
        `past scoring (${Math.round(ageDays)}d > ${horizon}d) but the text is still worth ` +
        `re-resolving until ${textHorizon}d`,
    };
  }

  return {
    action: "delete",
    ageDays,
    scoringHorizonDays: horizon,
    why: `past scoring and past re-resolution value (${Math.round(ageDays)}d > ${textHorizon}d)`,
  };
}

export interface RetentionPlan {
  keep: number;
  depersonalize: number;
  delete: number;
  /** Per-verb horizons, so the policy can be stated in a privacy notice as numbers. */
  horizons: { verb: SignalVerb; scoringDays: number; textDays: number }[];
}

/**
 * A dry run over the whole log.
 *
 * The horizons are the substantive thing a privacy notice needs — "we keep
 * search signal for about 18 months, then remove who did it" is a sentence
 * someone can actually evaluate. Where the backups live is a footnote by
 * comparison.
 */
export function planRetention(events: readonly SignalEvent[], now: Date): RetentionPlan {
  const plan: RetentionPlan = { keep: 0, depersonalize: 0, delete: 0, horizons: [] };

  for (const event of events) {
    plan[retentionFor(event, now).action] += 1;
  }

  const verbs = Object.keys(VERB_PROFILES) as SignalVerb[];
  plan.horizons = verbs
    .map((verb) => {
      const scoringDays = scoringHorizonDays(verb);
      return {
        verb,
        scoringDays,
        textDays: isExplicitVerb(verb)
          ? Infinity
          : Math.min(scoringDays * (1 + TEXT_GRACE_MULTIPLIER), MAX_TEXT_RETENTION_DAYS),
      };
    })
    .sort((a, b) => a.scoringDays - b.scoringDays);

  return plan;
}
