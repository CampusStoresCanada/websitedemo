/**
 * Default weights per direction.
 *
 * These are the seed values only — they belong in a policy set, snapshotted onto
 * every run, so they can be tuned without a deploy and so any historical score
 * can be explained by the weights that actually produced it.
 *
 * The four directions ask genuinely different questions of the same pair, which
 * is why the numbers are not shared:
 *
 *  - A member asking "who can supply me" is asking about their own stated
 *    requirements, so certification carries nearly as much as category.
 *  - A partner asking "who could buy from me" is asking a sales question, and
 *    timing — when is this store next in market — outranks everything except
 *    category.
 *  - Members comparing themselves to each other care about cohort and what each
 *    other runs in-house, not about categories they both buy.
 *  - ⚠️ Between partners, category overlap is inverted inside the feature: same
 *    class means competitor, same department means complement.
 */

import type { MatchAxis, MatchWeights, DirectionWeights } from "./types";

const ZERO: DirectionWeights = {
  category: 0,
  certification: 0,
  province: 0,
  timing: 0,
  requirements: 0,
  services: 0,
  cohort: 0,
  semantic: 0,
  behavioural: 0,
};

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  // "Who can supply me?"
  member_to_partner: {
    ...ZERO,
    category: 30,
    certification: 25,
    province: 12,
    requirements: 12,
    semantic: 10,
    services: 5,
    timing: 3,
    cohort: 3,
  },

  // "Who could buy from me?"
  partner_to_member: {
    ...ZERO,
    category: 30,
    timing: 22,
    certification: 15,
    province: 10,
    requirements: 8,
    semantic: 8,
    services: 4,
    cohort: 3,
  },

  // "Which stores are worth knowing?"
  member_to_member: {
    ...ZERO,
    cohort: 45,
    semantic: 25,
    services: 22,
    category: 8,
  },

  // "Who complements us?" — not "who is like us".
  partner_to_partner: {
    ...ZERO,
    category: 45,
    semantic: 30,
    cohort: 25,
  },

  /**
   * How hard a thin profile is discounted when ranking.
   * `ranking = score × (floor + (1 − floor) × confidence)`.
   *
   * At 0.4 a single strong axis still surfaces — which matters while only 13 of
   * 81 members have filled anything in — but a fully-answered profile with the
   * same fit quality always ranks above it.
   */
  confidenceFloor: 0.4,
};

/** Total weight a direction can spend, used to turn spent weight into confidence. */
export function totalWeight(weights: DirectionWeights): number {
  return (Object.keys(weights) as MatchAxis[]).reduce((sum, axis) => sum + weights[axis], 0);
}
