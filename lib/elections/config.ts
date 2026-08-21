/**
 * Election rules as data.
 *
 * Every value here is something a by-law amendment could change, which is why
 * none of it is a constant anywhere else in the codebase. CSC is actively
 * redrafting By-Law No. 1; when the new text lands it becomes a new published
 * policy set, and elections that already opened stay pinned to the config they
 * were created under (`elections.config`). A re-tally must use the rule that was
 * actually in force, not whatever is current.
 *
 * The CSC defaults below encode By-Law No. 1 (approved 2014-01-30) as written,
 * with two places where the code deliberately follows practice instead. Both are
 * called out at the field, because a silent divergence between the document and
 * the software is exactly the thing that gets discovered during a contested
 * result.
 */

export type ElectorateRule =
  /** Every active org admin of an eligible member org may cast that org's ballot. */
  | "org_admins"
  /** Only a single designated contact per org may cast. */
  | "designated_contact";

export type EligibilityRule =
  /** Membership status is active/grace/reactivated at evaluation. */
  | "active_status"
  /** The above, AND a known expiry date that covers the AGM. */
  | "active_status_and_dated_expiry";

export type TieResolution =
  /** The ballot produces an ordering; the members elect at the AGM. */
  | "refer_to_agm"
  /** Seat is left vacant and the board appoints for the unexpired term. */
  | "board_appoints";

export interface ElectionsConfig {
  /** Countbacks in days before the AGM. By-Law Part V S2-S3. */
  schedule: {
    nominationsOpenDaysBefore: number;
    nominationsCloseDaysBefore: number;
    ballotsOpenDaysBefore: number;
    ballotsCloseDaysBefore: number;
  };

  /**
   * Which weekday-of-month the AGM falls on, when the association pins it by
   * rule rather than by resolution each year. `null` = entered by hand.
   */
  agmRule: { month: number; weekday: number; occurrence: number } | null;

  electorate: {
    rule: ElectorateRule;
    /**
     * One ballot per institution regardless of how many admins it has. This is
     * the constraint that carries the by-law's intent -- one vote per Member
     * Store -- without pretending stores only have one administrator.
     */
    oneBallotPerOrganization: boolean;
    /** Any admin of the org may revise the org's ballot until the close. */
    anyAdminMayEdit: boolean;
  };

  eligibility: {
    /** Applied to the voting institution. */
    voterRule: EligibilityRule;
    /** Applied to the nominee's institution. */
    nomineeRule: EligibilityRule;
    /**
     * Exclude organizations flagged `is_test`. True for any real election.
     * Configurable rather than hardcoded so a scratch election can exercise the
     * full nomination and ballot flow end to end without touching real member
     * records -- which is the only way this gets tested before September.
     */
    excludeTestOrganizations: boolean;
  };

  nominations: {
    /**
     * Co-signers required on a member-sourced nomination. By-Law Part V S2(c)
     * requires two. Note that at CSC every sitting director is also an org
     * admin, so the board can satisfy this among themselves -- it is a record
     * of institutional support, not a meaningful filter. Kept because it is
     * cheap and it is what the document says.
     */
    cosignersRequired: number;
    /** Co-signers must come from distinct organizations. */
    cosignersMustBeDistinctOrgs: boolean;
    /** May a nominee co-sign their own nomination? */
    selfCosignatureAllowed: boolean;
    /** By-Law Part V S2(d): the nominee's store must permit them to serve. */
    requireStorePermission: boolean;
    /** Nominating-committee nominations bypass the co-signature requirement. */
    committeeSlateExemptFromCosignatures: boolean;
    requireBio: boolean;
    requirePlatform: boolean;
  };

  candidacy: {
    /** By-Law Part IV S1 -- only employees of member stores may be elected. */
    mustBeMemberStoreEmployee: boolean;
    /**
     * Consecutive terms a director may be elected to. NULL disables the cap.
     * Enforceable only once term history exists in governance_role_assignments;
     * there is no other source for it.
     *
     * ⚠️ The two circulating copies of By-Law No. 1 DISAGREE on this number and
     * on nothing else -- see CSC_ELECTIONS_CONFIG below. It is the one field
     * here that should not be changed without documentary authority.
     */
    maxConsecutiveTerms: number | null;
  };

  ballot: {
    /** Ballot lists candidates alphabetically. By-Law Part V S3(a). */
    alphabetical: boolean;
    /** Allow selecting fewer than the number of seats. */
    allowUndervote: boolean;
    allowAbstain: boolean;
  };

  tabulation: {
    /** Top N by vote count fill N seats. */
    method: "plurality_at_large";
    tieResolution: TieResolution;
    /**
     * Never true. Present so that the absence of an automatic tie-break is an
     * explicit, reviewable setting rather than an unstated assumption.
     */
    autoBreakTies: false;
  };

  /**
   * Whether reaching the nomination close with more nominees than seats is
   * enough on its own to trigger a ballot.
   *
   * At CSC there is a human step in between: the nominating committee talks to
   * nominees throughout the window, both about withdrawing where they are
   * unlikely to be elected and about improving how well the slate represents the
   * membership (institution type, size, geography). That is a continuous review
   * task, not an approval gate -- so the software never blocks on it, it just
   * makes the picture visible while there is still time to act.
   */
  gate: {
    reviewIsContinuous: boolean;
    /** Committee may ask a nominee to withdraw; only the nominee may withdraw. */
    committeeMayRequestWithdrawal: boolean;
  };
}

/**
 * By-Law No. 1 (2014) as written, except where noted at the field.
 *
 * Divergences from the document, both deliberate:
 *  - `electorate.rule` is "org_admins", not the single "Primary Store Contact"
 *    of Part III S2(b). That term is deprecated and several member stores --
 *    including ones represented on the current board -- run with two or more
 *    administrators by their own insistence. The one-vote-per-store intent is
 *    preserved by `oneBallotPerOrganization`.
 *  - `gate.reviewIsContinuous` replaces a formal slate-approval step. See the
 *    field comment.
 */
export const CSC_ELECTIONS_CONFIG: ElectionsConfig = {
  schedule: {
    nominationsOpenDaysBefore: 120,
    nominationsCloseDaysBefore: 90,
    ballotsOpenDaysBefore: 60,
    ballotsCloseDaysBefore: 30,
  },
  // Third Thursday of January. weekday 4 = Thursday (ISO: Mon=1).
  // Moved from Wednesday for 2027 on the Executive Director's conflict; the
  // board terms compiled in September 2026 already run to "January 21, 2027",
  // which is the third Thursday, so the association is de facto on Thursday
  // already. Every countback below shifts with it automatically.
  agmRule: { month: 1, weekday: 4, occurrence: 3 },
  electorate: {
    rule: "org_admins",
    oneBallotPerOrganization: true,
    anyAdminMayEdit: true,
  },
  eligibility: {
    // Strict, because at CSC a missing expiry means an OUTSTANDING RENEWAL
    // rather than a missing record — the membership year ends August 31 and
    // renewals run into September. "Pay or you don't get this" is the intended
    // policy, and the ineligible verdict is recoverable by the member the same
    // day. Eligibility is therefore re-evaluated at every gate, never snapshotted
    // once when the election is created.
    voterRule: "active_status_and_dated_expiry",
    nomineeRule: "active_status_and_dated_expiry",
    excludeTestOrganizations: true,
  },
  nominations: {
    cosignersRequired: 2,
    cosignersMustBeDistinctOrgs: true,
    selfCosignatureAllowed: false,
    requireStorePermission: true,
    committeeSlateExemptFromCosignatures: true,
    requireBio: true,
    requirePlatform: true,
  },
  candidacy: {
    mustBeMemberStoreEmployee: true,
    // FOUR. Confirmed 2026-08-21 against the by-laws as filed with the federal
    // government. Worth knowing WHY that confirmation was needed: the bylaws
    // folder holds two files both titled "Approved January 30, 2014" whose only
    // difference across all 13 pages is this word -- one says three. Under three
    // the sitting President and Vice-President would both have been barred from
    // standing in 2027, having each served three consecutive terms.
    maxConsecutiveTerms: 4,
  },
  ballot: {
    alphabetical: true,
    allowUndervote: true,
    allowAbstain: true,
  },
  tabulation: {
    method: "plurality_at_large",
    tieResolution: "refer_to_agm",
    autoBreakTies: false,
  },
  gate: {
    reviewIsContinuous: true,
    committeeMayRequestWithdrawal: true,
  },
};

/** Deep-merge a partial override onto the defaults. */
export function resolveElectionsConfig(
  overrides?: DeepPartial<ElectionsConfig> | null
): ElectionsConfig {
  if (!overrides) return CSC_ELECTIONS_CONFIG;
  return {
    ...CSC_ELECTIONS_CONFIG,
    ...overrides,
    schedule: { ...CSC_ELECTIONS_CONFIG.schedule, ...overrides.schedule },
    agmRule:
      overrides.agmRule === null
        ? null
        : overrides.agmRule
          ? { ...CSC_ELECTIONS_CONFIG.agmRule!, ...overrides.agmRule }
          : CSC_ELECTIONS_CONFIG.agmRule,
    electorate: { ...CSC_ELECTIONS_CONFIG.electorate, ...overrides.electorate },
    eligibility: { ...CSC_ELECTIONS_CONFIG.eligibility, ...overrides.eligibility },
    nominations: { ...CSC_ELECTIONS_CONFIG.nominations, ...overrides.nominations },
    candidacy: { ...CSC_ELECTIONS_CONFIG.candidacy, ...overrides.candidacy },
    ballot: { ...CSC_ELECTIONS_CONFIG.ballot, ...overrides.ballot },
    tabulation: { ...CSC_ELECTIONS_CONFIG.tabulation, ...overrides.tabulation },
    gate: { ...CSC_ELECTIONS_CONFIG.gate, ...overrides.gate },
  } as ElectionsConfig;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
