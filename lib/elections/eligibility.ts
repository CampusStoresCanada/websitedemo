/**
 * Who may vote, and whose institution may put a candidate forward.
 *
 * Pure predicates, mirroring lib/conference/membership-gate.ts. The important
 * difference from that module is the failure direction.
 *
 * `membershipCoversConference()` returns false on a null expiry, which is right
 * for a purchase gate -- refusing to sell on missing data is safe. Applied to an
 * electorate the same rule is the opposite of safe: 33 of CSC's 52 active member
 * stores have `membership_expires_at` NULL on both `organizations` and
 * `memberships`, so an expiry-based rule silently removes 63% of the electorate,
 * and a store that is dropped never finds out. Hence two named rules, and a
 * reason recorded on every verdict either way.
 */

import type { EligibilityRule } from "./config";

/** Statuses that count as a member in good standing. Matches isOrgAccessActive(). */
const ACTIVE_STATUSES = ["active", "grace", "reactivated"];

export interface OrgEligibilityFacts {
  organizationId: string;
  name: string;
  /** Resolved membership status -- prefer resolveMembershipStatus() upstream. */
  membershipStatus: string | null;
  /** From organizations or memberships. Frequently null; see the module note. */
  membershipExpiresAt: string | null;
  /** True where the org's type maps to a program that carries a vote. */
  isVotingProgram: boolean;
}

export type EligibilityReasonCode =
  | "eligible"
  | "eligible_expiry_unknown"
  | "not_a_voting_program"
  | "membership_not_active"
  | "membership_expires_before_agm";

export interface EligibilityVerdict {
  organizationId: string;
  isEligible: boolean;
  reasonCode: EligibilityReasonCode;
  reason: string;
  ruleKey: EligibilityRule;
  facts: {
    membershipStatus: string | null;
    membershipExpiresAt: string | null;
    expiryKnown: boolean;
    coversAgm: boolean | null;
  };
}

/**
 * Does a known expiry cover the AGM? Returns null when no expiry is recorded --
 * deliberately tri-state, because "we do not know" and "no, it lapses" are
 * different facts and only one of them is the store's fault.
 */
export function expiryCoversAgm(
  membershipExpiresAt: string | null,
  agmDate: string
): boolean | null {
  if (!membershipExpiresAt) return null;
  // Both are YYYY-MM-DD-prefixed; lexicographic compare is safe.
  return membershipExpiresAt.slice(0, 10) >= agmDate.slice(0, 10);
}

export function evaluateOrgEligibility(
  facts: OrgEligibilityFacts,
  rule: EligibilityRule,
  agmDate: string
): EligibilityVerdict {
  const covers = expiryCoversAgm(facts.membershipExpiresAt, agmDate);
  const base = {
    organizationId: facts.organizationId,
    ruleKey: rule,
    facts: {
      membershipStatus: facts.membershipStatus,
      membershipExpiresAt: facts.membershipExpiresAt,
      expiryKnown: facts.membershipExpiresAt !== null,
      coversAgm: covers,
    },
  };

  if (!facts.isVotingProgram) {
    return {
      ...base,
      isEligible: false,
      reasonCode: "not_a_voting_program",
      reason: `${facts.name} is not in a membership program that carries a vote.`,
    };
  }

  if (!facts.membershipStatus || !ACTIVE_STATUSES.includes(facts.membershipStatus)) {
    return {
      ...base,
      isEligible: false,
      reasonCode: "membership_not_active",
      reason: `${facts.name} has membership status "${facts.membershipStatus ?? "none"}", which is not in good standing.`,
    };
  }

  if (rule === "active_status") {
    return {
      ...base,
      isEligible: true,
      reasonCode: covers === null ? "eligible_expiry_unknown" : "eligible",
      reason:
        covers === null
          ? `${facts.name} is in good standing. No expiry date is recorded, so coverage through the AGM could not be confirmed — eligible under the active-status rule.`
          : `${facts.name} is in good standing.`,
    };
  }

  // active_status_and_dated_expiry — the strict reading.
  if (covers === null) {
    return {
      ...base,
      isEligible: false,
      reasonCode: "eligible_expiry_unknown",
      reason: `${facts.name} is in good standing but has NO recorded membership expiry, so the strict rule cannot confirm coverage through ${agmDate}. This is a data gap, not a lapse.`,
    };
  }
  if (!covers) {
    return {
      ...base,
      isEligible: false,
      reasonCode: "membership_expires_before_agm",
      reason: `${facts.name}'s membership expires ${facts.membershipExpiresAt}, before the AGM on ${agmDate}.`,
    };
  }

  return {
    ...base,
    isEligible: true,
    reasonCode: "eligible",
    reason: `${facts.name} is in good standing through the AGM on ${agmDate}.`,
  };
}

export interface EligibilitySummary {
  total: number;
  eligible: number;
  ineligible: number;
  /** Eligible, but only because the rule tolerates a missing expiry. */
  eligibleOnUnknownExpiry: number;
  /** Would flip to ineligible under active_status_and_dated_expiry. */
  wouldFailStrictRule: number;
  byReason: Record<string, number>;
}

/**
 * Summarize a run, and -- importantly -- report how many verdicts would change
 * under the other rule. Choosing between the two rules should be an evidenced
 * decision, not a preference.
 */
export function summarizeEligibility(verdicts: EligibilityVerdict[]): EligibilitySummary {
  const byReason: Record<string, number> = {};
  let eligible = 0;
  let eligibleOnUnknownExpiry = 0;
  let wouldFailStrictRule = 0;

  for (const v of verdicts) {
    byReason[v.reasonCode] = (byReason[v.reasonCode] ?? 0) + 1;
    if (v.isEligible) {
      eligible++;
      if (!v.facts.expiryKnown) {
        eligibleOnUnknownExpiry++;
        wouldFailStrictRule++;
      } else if (v.facts.coversAgm === false) {
        wouldFailStrictRule++;
      }
    }
  }

  return {
    total: verdicts.length,
    eligible,
    ineligible: verdicts.length - eligible,
    eligibleOnUnknownExpiry,
    wouldFailStrictRule,
    byReason,
  };
}
