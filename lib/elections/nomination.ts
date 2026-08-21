/**
 * Nomination validity: co-signatures, consents, and candidate eligibility.
 *
 * Pure. Every rule is read off the snapshotted config rather than the by-law
 * directly, so an amendment changes a policy value instead of this file.
 */

import type { ElectionsConfig } from "./config";

export interface Cosignature {
  organizationId: string;
  contactId: string;
  signedAt: string | null;
  revokedAt: string | null;
}

export interface CosignatureStatus {
  required: number;
  valid: number;
  satisfied: boolean;
  /** Distinct organizations that have validly signed. */
  signingOrganizationIds: string[];
  problems: string[];
  /**
   * Sitting directors who signed. Not a problem — at CSC every director is also
   * an org admin, so the board can satisfy the two-signature rule among
   * themselves, which makes it a record of institutional support rather than a
   * meaningful filter. Surfaced so the audit trail shows it plainly, especially
   * where a signer is also standing for election.
   */
  signedByDirectors: string[];
}

export function evaluateCosignatures(
  cosignatures: Cosignature[],
  config: ElectionsConfig,
  opts: {
    source: "nominating_committee" | "member";
    nomineeContactId: string;
    nomineeOrganizationId: string;
    /** Contact ids of people currently holding a seat on the electing body. */
    sittingDirectorContactIds?: readonly string[];
  }
): CosignatureStatus {
  const problems: string[] = [];
  const required =
    opts.source === "nominating_committee" && config.nominations.committeeSlateExemptFromCosignatures
      ? 0
      : config.nominations.cosignersRequired;

  const live = cosignatures.filter((c) => c.signedAt && !c.revokedAt);

  const selfSigned = live.filter((c) => c.contactId === opts.nomineeContactId);
  if (selfSigned.length && !config.nominations.selfCosignatureAllowed) {
    problems.push("A nominee cannot co-sign their own nomination.");
  }

  const counting = config.nominations.selfCosignatureAllowed
    ? live
    : live.filter((c) => c.contactId !== opts.nomineeContactId);

  const orgIds = config.nominations.cosignersMustBeDistinctOrgs
    ? [...new Set(counting.map((c) => c.organizationId))]
    : counting.map((c) => c.organizationId);

  if (config.nominations.cosignersMustBeDistinctOrgs && orgIds.length < counting.length) {
    problems.push(
      "Co-signatures must come from different member institutions — two people at the same store count once."
    );
  }

  const valid = orgIds.length;
  if (valid < required) {
    problems.push(
      `${valid} of ${required} co-signature${required === 1 ? "" : "s"} received. A nomination needs ${required} from ${required === 1 ? "a member institution" : "different member institutions"}.`
    );
  }

  const directorSet = new Set(opts.sittingDirectorContactIds ?? []);
  const signedByDirectors = counting
    .filter((c) => directorSet.has(c.contactId))
    .map((c) => c.contactId);

  return {
    required,
    valid,
    satisfied: valid >= required && problems.length === 0,
    signingOrganizationIds: orgIds,
    problems,
    signedByDirectors,
  };
}

export interface CandidateFacts {
  contactId: string;
  displayName: string;
  organizationId: string;
  /** Employed by an institution that is an eligible member. */
  isMemberStoreEmployee: boolean;
  /**
   * Consecutive terms already served on this body, counted from
   * governance_role_assignments. NULL means the history has not been entered —
   * which is different from zero, and must not be treated as "fine".
   */
  consecutiveTermsServed: number | null;
}

export interface CandidateEligibility {
  eligible: boolean;
  blocking: string[];
  /** Cannot be evaluated for lack of data. Never silently treated as a pass. */
  unverifiable: string[];
}

export function evaluateCandidateEligibility(
  facts: CandidateFacts,
  config: ElectionsConfig
): CandidateEligibility {
  const blocking: string[] = [];
  const unverifiable: string[] = [];

  if (config.candidacy.mustBeMemberStoreEmployee && !facts.isMemberStoreEmployee) {
    blocking.push(
      `${facts.displayName} is not recorded as an employee of a member institution in good standing.`
    );
  }

  const cap = config.candidacy.maxConsecutiveTerms;
  if (cap !== null) {
    if (facts.consecutiveTermsServed === null) {
      // The term-limit rule exists but there is no history to check it against.
      // Reporting that honestly beats returning "eligible" from missing data.
      unverifiable.push(
        `Consecutive-term history has not been recorded for ${facts.displayName}, so the ${cap}-term limit cannot be checked. Enter their term history before validating this nomination.`
      );
    } else if (facts.consecutiveTermsServed >= cap) {
      blocking.push(
        `${facts.displayName} has served ${facts.consecutiveTermsServed} consecutive terms and has reached the limit of ${cap}.`
      );
    }
  }

  return { eligible: blocking.length === 0, blocking, unverifiable };
}

export interface NominationCompleteness {
  complete: boolean;
  missing: string[];
}

/**
 * Everything that must be true before a nomination reaches the ballot.
 *
 * Note that acceptance and store permission are TWO consents (By-Law Part V
 * S2(d)), not one: the candidate agreeing to stand does not by itself mean their
 * employer has agreed to let them serve.
 */
export function evaluateNominationCompleteness(
  nomination: {
    candidateAcceptedAt: string | null;
    candidateDeclinedAt: string | null;
    storePermissionGrantedAt: string | null;
    withdrawnAt: string | null;
    bio: string | null;
    platform: string | null;
  },
  cosignatures: CosignatureStatus,
  candidate: CandidateEligibility,
  config: ElectionsConfig
): NominationCompleteness {
  const missing: string[] = [];

  if (nomination.withdrawnAt) missing.push("The nominee has withdrawn.");
  if (nomination.candidateDeclinedAt) missing.push("The nominee declined the nomination.");
  if (!nomination.candidateAcceptedAt) missing.push("The nominee has not yet accepted.");

  if (config.nominations.requireStorePermission && !nomination.storePermissionGrantedAt)
    missing.push("The nominee's institution has not yet granted permission for them to serve.");

  if (config.nominations.requireBio && !nomination.bio?.trim())
    missing.push("A biography is required.");
  if (config.nominations.requirePlatform && !nomination.platform?.trim())
    missing.push("A candidate statement is required.");

  missing.push(...cosignatures.problems);
  missing.push(...candidate.blocking);
  missing.push(...candidate.unverifiable);

  return { complete: missing.length === 0, missing };
}
