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

/**
 * One scheduled nudge during the ballot window.
 *
 * `audience` is the part that matters and the part a bare day-number cannot
 * express: "not_yet_voted" chases only institutions with no ballot on file,
 * which is almost always what is wanted. "everyone" exists for the opening
 * announcement, where there is nobody to exclude yet.
 */
export type NonWorkingDayPolicy = "move_earlier" | "move_later" | "send_anyway";

export interface ReminderStep {
  /** Days before ballots close. 0 is the closing day itself. */
  daysBeforeClose: number;
  /** Shown to the admin, and used in the send log. */
  label: string;
  audience: "not_yet_voted" | "everyone";
  /**
   * What to do when the computed date is a weekend or a national holiday.
   *
   * Campus stores are shut, so a nudge that lands then is read on Monday at the
   * earliest — by which time "closing tomorrow" may be a lie. Defaults to moving
   * EARLIER rather than later: later can fall past the close, and a reminder
   * after the deadline is worse than one a day early.
   *
   * "send_anyway" is a real option. If somebody deliberately wants a Sunday
   * send, the software should let them and simply stop mentioning it.
   */
  onNonWorkingDay?: NonWorkingDayPolicy;
}

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
    /** Applied to the nominee's institution to reach the BALLOT. */
    nomineeRule: EligibilityRule;
    /**
     * Applied to taking part at all — putting a name forward, co-signing one.
     *
     * Deliberately looser than the ballot rules. A store in its grace period is
     * still a member: it can nominate a colleague and it can co-sign. What it
     * cannot do is put a candidate ON the ballot or cast a vote, because by then
     * the renewal has to be done. The board set the grace policy; this honours
     * it without pretending a member in grace has stopped being a member.
     */
    participationRule: EligibilityRule;
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

  /**
   * How the association chases a vote once ballots are open.
   *
   * The renewal series encodes this as a bare list of day-numbers, which is
   * enough for a machine and useless to the person deciding whether it is
   * humane. Each step here carries its own label and audience so the admin
   * screen can say what will happen, to whom, and on what date, instead of
   * showing "[10, 3, 1]" and leaving them to work it out.
   */
  reminders: {
    enabled: boolean;
    steps: ReminderStep[];
    /**
     * Never send two reminders closer together than this. A guard against an
     * admin editing the steps into a cluster that reads as harassment.
     */
    minimumGapDays: number;
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
  // The by-law countbacks are MINIMUMS, not fixed dates: Part V S2(a)/(b) say
  // "no fewer than 120 days", S3(a) "no less than 60 days", S3(c) "no less than
  // 30 days". Running earlier than the minimum is compliant; running later is
  // not. The only true fixture is the 90-day nomination close, which is a member
  // RIGHT to nominate up to that date and so must not be brought forward.
  //
  // These sit ahead of the minimums on purpose. Campus stores close from the
  // third Friday of December to the first Monday of January, and a ballot whose
  // deadline lands in that stretch collects out-of-office replies rather than
  // votes. At 60/30 the 2027 ballot would have run Nov 22 – Dec 22 and died in
  // the holidays; at 64/45 it runs Nov 18 – Dec 7 and closes clear of them.
  // This mirrors what the association already does by instinct — the 2026 ballot
  // ran Nov 12–28 for a January 15 meeting.
  //
  // Notice of the meeting cannot be moved this way: Part VII S4(b) is a window
  // fixed relative to the meeting. See lib/elections/agm-notice.ts, which counts
  // the window's usable days instead and recommends its opening edge.
  schedule: {
    nominationsOpenDaysBefore: 120,
    nominationsCloseDaysBefore: 90,
    ballotsOpenDaysBefore: 64,
    ballotsCloseDaysBefore: 45,
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
    // In grace you may nominate and co-sign; you are not on the ballot and you
    // do not vote until you have renewed.
    participationRule: "active_status",
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
  // The CSC ballot window is 19 days (64 -> 45 days before the AGM). These sit
  // at roughly the half-way point, the final week, and the last working day.
  //
  // 10/3/1 was the obvious spacing and it does not survive the weekend rule: for
  // the 2027 cycle, "1 day before" is Sunday 6 December, which moves back to
  // Friday the 4th — on top of the 3-day step. Any fixed set of offsets will
  // collide in some year; planReminders refuses the plan when it does, and the
  // admin moves one. These offsets are simply a set that works for the cycle in
  // front of us.
  reminders: {
    enabled: true,
    steps: [
      { daysBeforeClose: 12, label: "Halfway nudge", audience: "not_yet_voted", onNonWorkingDay: "move_earlier" },
      { daysBeforeClose: 5, label: "Final week", audience: "not_yet_voted", onNonWorkingDay: "move_earlier" },
      { daysBeforeClose: 1, label: "Last chance", audience: "not_yet_voted", onNonWorkingDay: "move_earlier" },
    ],
    minimumGapDays: 2,
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
    // Steps are normalised rather than spread: an election snapshotted before
    // `onNonWorkingDay` existed has steps without it, and a missing policy must
    // resolve to the default rather than to undefined behaviour at send time.
    reminders: {
      ...CSC_ELECTIONS_CONFIG.reminders,
      ...overrides.reminders,
      steps: (overrides.reminders?.steps ?? CSC_ELECTIONS_CONFIG.reminders.steps).map(
        (step) => ({
          ...step,
          onNonWorkingDay: step.onNonWorkingDay ?? "move_earlier",
        })
      ),
    },
  } as ElectionsConfig;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
