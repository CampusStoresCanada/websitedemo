/**
 * Scoring — pure, no I/O, no DB. The runner supplies profiles; this returns
 * numbers and sentences.
 *
 * Modelled on `lib/scheduler/scoring.ts`, which got the shape right: a weighted
 * feature sum, a breakdown you can read, and reasons generated alongside rather
 * than reconstructed afterwards.
 */

import {
  behaviouralFeature,
  categoryFeature,
  certificationFeature,
  cohortFeature,
  provinceFeature,
  requirementsFeature,
  semanticFeature,
  servicesFeature,
  timingFeature,
  type FeatureContext,
} from "./features";
import { DEFAULT_MATCH_WEIGHTS, totalWeight } from "./weights";
import {
  MATCH_AXES,
  type FeatureResult,
  type MatchAxis,
  type MatchDirection,
  type MatchProfile,
  type MatchReason,
  type MatchWeights,
  type PairScore,
  type ReasonKind,
} from "./types";

/** The profile types each direction expects, subject first. */
const DIRECTION_TYPES: Record<MatchDirection, [MatchProfile["type"], MatchProfile["type"]]> = {
  member_to_partner: ["member", "partner"],
  partner_to_member: ["partner", "member"],
  member_to_member: ["member", "member"],
  partner_to_partner: ["partner", "partner"],
};

/** Strongest claim first, so the first reason shown is the most defensible one. */
const REASON_RANK: Record<ReasonKind, number> = {
  chosen: 0,
  stated: 1,
  derived: 2,
  behavioural: 3,
  semantic: 4,
  guess: 5,
};

export interface ScoreOptions {
  weights?: MatchWeights;
  /** Reference date for time-dependent axes. Defaults to now; pass it in tests. */
  now?: Date;
}

/**
 * ⛔ There is deliberately no `blocked` option.
 *
 * An earlier version took a blocklist and dropped those pairs, which made the
 * scorer the thing deciding who may not meet. A refusal is a human relationship
 * fact — "they failed to deliver fourteen years ago and it cost us money." No
 * algorithm can infer it and it must not be delegated to one.
 *
 * Every consumer filters on the declared refusal directly, before and
 * independently of scoring. Refusals may be used as a *training feature* — what
 * a store refuses says a great deal about what it wants — but never as
 * exclusion. If you are reaching for a blocklist here, it belongs at the point
 * of display, reading the declaration, not the score.
 */

function notScorable(
  direction: MatchDirection,
  subjectId: string,
  candidateId: string,
  reason: "self" | "direction_type_mismatch"
): PairScore {
  const breakdown = Object.fromEntries(MATCH_AXES.map((a) => [a, null])) as Record<
    MatchAxis,
    number | null
  >;
  return {
    direction,
    subjectId,
    candidateId,
    score: 0,
    confidence: 0,
    ranking: 0,
    breakdown,
    reasons: [],
    notScorable: true,
    notScorableReason: reason,
  };
}

export function scorePair(
  subject: MatchProfile,
  candidate: MatchProfile,
  direction: MatchDirection,
  options: ScoreOptions = {}
): PairScore {
  const weights = options.weights ?? DEFAULT_MATCH_WEIGHTS;
  const ctx: FeatureContext = { direction, now: options.now ?? new Date() };

  if (subject.id === candidate.id) {
    return notScorable(direction, subject.id, candidate.id, "self");
  }

  const [subjectType, candidateType] = DIRECTION_TYPES[direction];
  if (subject.type !== subjectType || candidate.type !== candidateType) {
    return notScorable(direction, subject.id, candidate.id, "direction_type_mismatch");
  }

  const results: FeatureResult[] = [
    categoryFeature(subject, candidate, ctx),
    certificationFeature(subject, candidate),
    provinceFeature(subject, candidate),
    timingFeature(subject, candidate, ctx),
    requirementsFeature(subject, candidate),
    servicesFeature(subject, candidate),
    cohortFeature(subject, candidate),
    semanticFeature(subject, candidate),
    behaviouralFeature(subject, candidate),
  ];

  const directionWeights = weights[direction];
  const breakdown = Object.fromEntries(MATCH_AXES.map((a) => [a, null])) as Record<
    MatchAxis,
    number | null
  >;

  let weightedSum = 0;
  let spentWeight = 0;
  const reasons: MatchReason[] = [];

  for (const result of results) {
    breakdown[result.axis] = result.value;
    const weight = directionWeights[result.axis];

    // A silent axis spends no weight. Scoring absence as zero would rank profiles
    // by how complete they are rather than by how well they fit — the dominant
    // failure mode while only 13 of 81 members have filled anything in.
    if (result.value === null || weight === 0) continue;

    weightedSum += weight * result.value;
    spentWeight += weight;
    reasons.push(...result.reasons);
  }

  const available = totalWeight(directionWeights);
  const score = spentWeight > 0 ? (100 * weightedSum) / spentWeight : 0;
  const confidence = available > 0 ? spentWeight / available : 0;
  const floor = weights.confidenceFloor;
  const ranking = score * (floor + (1 - floor) * confidence);

  // Reasons that argue FOR the match come first. Ordering by claim strength
  // alone floated "holds none of the certifications you look for" to the top of
  // every recommendation, because a stated absence is just as `chosen` as a hit.
  reasons.sort((a, b) => {
    if (a.supports !== b.supports) return a.supports ? -1 : 1;
    const byKind = REASON_RANK[a.kind] - REASON_RANK[b.kind];
    if (byKind !== 0) return byKind;
    return directionWeights[b.axis] - directionWeights[a.axis];
  });

  return {
    direction,
    subjectId: subject.id,
    candidateId: candidate.id,
    score,
    confidence,
    ranking,
    breakdown,
    reasons,
    notScorable: false,
  };
}

/**
 * Score one subject against many candidates and order them.
 *
 * Sorted by `ranking`, which blends fit quality with how much we actually know.
 *
 * ⛔ Only structurally impossible pairs are dropped — an org against itself, or
 * types that do not fit the direction. Declared refusals are NOT filtered here;
 * the caller applies those from the declaration, so that a relationship decision
 * is never made by a number. See `ScoreOptions` above.
 */
export function rankCandidates(
  subject: MatchProfile,
  candidates: readonly MatchProfile[],
  direction: MatchDirection,
  options: ScoreOptions = {}
): (PairScore & { rank: number })[] {
  const scored = candidates
    .map((candidate) => scorePair(subject, candidate, direction, options))
    .filter((pair) => !pair.notScorable)
    .sort((a, b) => b.ranking - a.ranking || a.candidateId.localeCompare(b.candidateId));

  return scored.map((pair, index) => ({ ...pair, rank: index + 1 }));
}

/**
 * The single number a consumer should rank on.
 *
 * The engine produces three, and picking the wrong one is an easy mistake:
 *
 *   score      quality of fit across the axes that had data
 *   confidence how much of the direction's weight had anything to say
 *   ranking    the two combined — THIS ONE
 *
 * `score` alone is a trap. A pair that matched on one axis and was silent on
 * every other scores 100, and a consumer sorting on it would put the org we know
 * almost nothing about above the org we know fits. `ranking` discounts by how
 * much we actually know, which is what "how good is this match" means when
 * profile coverage is this uneven.
 *
 * Exported as the contract surface for the conference solver, which reads only
 * `(subject, candidate) -> total` and treats everything else as display.
 */
export function matchTotal(pair: PairScore): number {
  return pair.notScorable ? 0 : pair.ranking;
}

/**
 * ⛔ There is deliberately no "which reasons may be shown" function here.
 *
 * This layer produces a score and the provenance of the sentences behind it. Who
 * may read what is decided elsewhere — an ops dashboard, a member's own list, a
 * partner-facing panel and the print directory all have different answers, and
 * none of them are knowable from inside a scorer.
 *
 * Every reason carries `sourceOrgId` and `sourceVisibility`. A consumer that
 * wants the common filter can use `reasonsVisibleTo()` in edge-view.ts, which is
 * a convenience, not a gate.
 */
