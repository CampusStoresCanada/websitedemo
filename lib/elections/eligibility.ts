/**
 * Who may vote, and whose institution may put a candidate forward.
 *
 * Pure predicates, mirroring lib/conference/membership-gate.ts.
 *
 * WHAT A NULL EXPIRY MEANS. CSC's membership year runs to August 31, and
 * renewals for the next year are collected in the weeks before it. A store with
 * no `membership_expires_at` has not completed its renewal yet -- it is an
 * OUTSTANDING RENEWAL, not a missing record. That distinction sets the whole
 * design: the strict rule is the correct default, because "no forward expiry"
 * genuinely means "has not paid for the year that covers the AGM", and the fix
 * is in the member's hands.
 *
 * Two things follow, and both are load-bearing:
 *
 *  1. Eligibility is a MOMENT, not a fact. A store that is ineligible in August
 *     becomes eligible the day it renews. Every gate re-evaluates rather than
 *     reading a snapshot taken when the election was created, and `evaluated_at`
 *     is recorded so a stale verdict is visible as stale.
 *  2. The reason text has to be actionable. A store told "ineligible" that is
 *     one payment away from eligible must be told THAT, not given a verdict it
 *     cannot interpret. `reasonCode: "renewal_outstanding"` exists to carry a
 *     renewal link in the UI.
 *
 * `active_status` remains available for associations whose membership carries no
 * expiry at all, and as a deliberate fallback if a renewal cycle runs late
 * enough to threaten the electorate -- but choosing it during a live renewal
 * means enfranchising stores that have not paid, which is a governance decision
 * and not a default.
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
  /** In good standing, but the rule in force does not require a forward expiry. */
  | "eligible_renewal_outstanding"
  | "not_a_voting_program"
  | "membership_not_active"
  /** Renewal not yet completed — recoverable by the member, today. */
  | "renewal_outstanding"
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
      reasonCode: covers === null ? "eligible_renewal_outstanding" : "eligible",
      reason:
        covers === null
          ? `${facts.name} is in good standing but has not yet completed its renewal, so coverage through the AGM is not established. Eligible under the active-status rule, which does not require it.`
          : `${facts.name} is in good standing.`,
    };
  }

  // active_status_and_dated_expiry — the default. A null expiry here means the
  // renewal is outstanding, so the reason is a prompt, not a dead end.
  if (covers === null) {
    return {
      ...base,
      isEligible: false,
      reasonCode: "renewal_outstanding",
      reason: `${facts.name} has not yet renewed for the membership year covering the AGM on ${agmDate}. Completing the renewal restores eligibility immediately.`,
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
  /** Every organization evaluated, including long-cancelled ones. */
  total: number;
  /**
   * Current members — the meaningful denominator.
   *
   * `total` counts every organization in a voting program ever, cancelled ones
   * included, so "19 of 80" reads as catastrophic turnout when 28 of that 80
   * left the association years ago. Anything shown to a human uses this.
   */
  currentMembers: number;
  /** No longer members at all. Not part of the electorate, not a problem to fix. */
  notCurrentMembers: number;
  eligible: number;
  ineligible: number;
  /** Eligible only because the rule in force tolerates an outstanding renewal. */
  eligibleOnOutstandingRenewal: number;
  /**
   * Ineligible today, but recoverable by the member without anyone's help.
   * This is the number to chase with a renewal campaign — and the number that
   * must be watched as nominations approach, because it is the electorate.
   */
  recoverableByRenewing: number;
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
  let eligibleOnOutstandingRenewal = 0;
  let recoverableByRenewing = 0;
  let notCurrentMembers = 0;

  for (const v of verdicts) {
    byReason[v.reasonCode] = (byReason[v.reasonCode] ?? 0) + 1;
    if (v.reasonCode === "membership_not_active" || v.reasonCode === "not_a_voting_program")
      notCurrentMembers++;
    if (v.isEligible) {
      eligible++;
      if (v.reasonCode === "eligible_renewal_outstanding") eligibleOnOutstandingRenewal++;
    } else if (v.reasonCode === "renewal_outstanding") {
      recoverableByRenewing++;
    }
  }

  return {
    total: verdicts.length,
    currentMembers: verdicts.length - notCurrentMembers,
    notCurrentMembers,
    eligible,
    ineligible: verdicts.length - eligible,
    eligibleOnOutstandingRenewal,
    recoverableByRenewing,
    byReason,
  };
}
