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
  /** Employed by an institution that is a member in good standing. */
  isMemberStoreEmployee: boolean;
  /**
   * The nominee's institution has RENEWED far enough to cover the meeting.
   *
   * Separate from `isMemberStoreEmployee` on purpose. A store in its grace
   * period is still a member and may put a name forward — but a candidate only
   * reaches the ballot if the renewal is done. Left undefined by callers that
   * do not distinguish the two, in which case it is not checked.
   */
  institutionRenewedThroughAgm?: boolean;
  /** Why not, in the institution's own terms, for the chase list. */
  renewalReason?: string | null;
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

  // The grace-period case: nominated legitimately, but not on the ballot until
  // the renewal lands. Blocking rather than unverifiable — it is a known fact
  // with a known fix, and the deadline is the nomination close.
  if (facts.institutionRenewedThroughAgm === false) {
    blocking.push(
      facts.renewalReason ??
        `${facts.displayName}'s institution has not completed its renewal, so this nomination cannot go on the ballot. Renewing before nominations close resolves it.`
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


/**
 * Who, of the sitting board, should be invited to co-sign a nomination.
 *
 * By-Law Part V S2(c) wants two Primary Store contacts behind a name, which
 * assumes the nominee knows two to ask. A first-time nominee from a small store
 * often does not, and that ignorance was never meant to be the filter — so the
 * ask can be fanned out to the board, whose job includes being asked.
 *
 * It is a wider ask, not a different rule. Each director is invited as
 * themselves, at their own store, so a board co-signature is still a Primary
 * Store contact of a member institution.
 *
 * Three exclusions, all from S2(c) rather than taste:
 *   - a director at the nominee's own store, because the two co-signatures must
 *     come from institutions other than the one already putting the name
 *     forward;
 *   - the nominee, if they happen to sit on the board;
 *   - anyone already invited directly, so the same person is not asked twice
 *     through two routes.
 */
export function resolveBoardInvitations(
  directors: readonly { contactId: string; organizationId: string }[],
  alreadyInvited: readonly { contactId: string }[],
  nominee: { contactId: string; organizationId: string }
): { contactId: string; organizationId: string }[] {
  const invited = new Set(alreadyInvited.map((i) => i.contactId));
  const out: { contactId: string; organizationId: string }[] = [];

  for (const d of directors) {
    if (!d.contactId || !d.organizationId) continue;
    if (d.organizationId === nominee.organizationId) continue;
    if (d.contactId === nominee.contactId) continue;
    if (invited.has(d.contactId)) continue;
    invited.add(d.contactId);
    out.push(d);
  }
  return out;
}
