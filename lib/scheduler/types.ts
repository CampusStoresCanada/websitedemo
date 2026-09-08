export interface DelegateProfile {
  registrationId: string;
  organizationId: string;
  userId: string;
  categoryResponsibilities: string[];
  buyingTimeline: string[];
  topPriorities: string[];
  meetingIntent: string[];
  purchasingAuthority: string | null;
  top5Preferences: string[];
  blackoutList: string[];
}

export interface ExhibitorProfile {
  registrationId: string;
  organizationId: string;
  userId: string;
  /** Organization ids this exhibitor will not meet. A partner can fire a
   *  customer — blackout is symmetrical. See lib/scheduler/blackout.ts. */
  blackoutList: string[];
  primaryCategory: string | null;
  secondaryCategories: string[];
  buyingCyclesTargeted: string[];
  meetingOutcomeIntent: string[];
  salesReadiness: Record<string, unknown> | null;
}

/**
 * Per-axis match values, straight from the engine's `match_edges.breakdown`.
 *
 * ⛔ null ≠ 0. null means the axis had NOTHING TO SAY about this pair; 0 means
 * it looked and found no fit. Collapsing null to 0 punishes a pair for what we
 * do not know, which is the bug the confidence mechanism exists to avoid.
 *
 * Open-keyed on purpose. It was seven fixed v2 axis names
 * (category_overlap, buying_timeline_match, priority_alignment,
 * top_5_preference, meeting_intent_match, purchasing_authority,
 * blackout_penalty) — five of which read columns that no longer have a home.
 * The engine's axes are category, certification, province, timing,
 * requirements, services, cohort, semantic and behavioural, and they will
 * change again as signals light up. A consumer reads keys it recognises and
 * passes the rest through.
 */
export type ScoreBreakdown = Record<string, number | null>;

export interface MatchScoreRecord {
  delegateSeatId: string;
  exhibitorSeatId: string;
  exhibitorOrganizationId: string;
  totalScore: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  isBlackout: boolean;
  isTop5: boolean;
}

export interface SchedulingPolicy {
  delegateCoveragePct: number;
  meetingGroupMin: number;
  meetingGroupMax: number;
  orgCoveragePct: number;
  tiebreakMode: string;
  feasibilityRelaxation: boolean;
}

export interface MeetingSlotInput {
  id: string;
  dayNumber: number;
  slotNumber: number;
  suiteId: string;
}

export interface ScheduleAssignment {
  meetingSlotId: string;
  exhibitorSeatId: string;
  exhibitorOrganizationId: string;
  delegateSeatIds: string[];
  matchScoreKeys: string[];
}

/**
 * `info` is REPORTED AND NEVER COUNTED. Status derivation reacts to hard
 * (infeasible) and soft (completed_with_warnings) only, so an info row falls
 * through to "completed" — which is the point: some things a human should see
 * are not defects, and putting them in the warning pile teaches people to
 * ignore the warning pile.
 */
export type ConstraintSeverity = "hard" | "soft" | "info";

export interface ConstraintViolation {
  code:
    | "GROUP_BOUNDS"
    | "DELEGATE_TARGET"
    | "EXHIBITOR_TARGET"
    | "ORG_COVERAGE"
    | "BLACKOUT"
    | "DUPLICATE_EXHIBITOR_ORG"
    | "DELEGATE_DOUBLE_BOOKED"
    | "DELEGATE_SELF_EXCLUDED"
    | "PERSON_COVERAGE"
    | "EXHIBITOR_WITHOUT_SUITE"
    | "POLICY_RELAXATION_DISABLED";
  severity: ConstraintSeverity;
  message: string;
  details?: Record<string, unknown>;
}

/** Hard violations mean the schedule is structurally broken; soft ones are
 *  target shortfalls that admins should review but don't invalidate the run. */
export interface SchedulerDiagnosticReport {
  status: "completed" | "completed_with_warnings" | "infeasible";
  violations: ConstraintViolation[];
  delegateTargetMeetings: number;
  totalAssignments: number;
  delegatesBelowTarget: string[];
  exhibitorsBelowTarget: string[];
  orgCoveragePctAchieved: number;
  /**
   * Share of delegates who COULD meet someone and did — person grain.
   *
   * Deliberately separate from orgCoveragePctAchieved, which can read 100%
   * while individual people got nothing: an org is "covered" as soon as one of
   * its attendees is scheduled. See PERSON_COVERAGE in constraints.ts.
   */
  personCoveragePctAchieved: number;
}

export interface SchedulerGenerateResult {
  status: "completed" | "completed_with_warnings" | "infeasible";
  assignments: ScheduleAssignment[];
  diagnostics: SchedulerDiagnosticReport;
}

export interface SchedulerRunSummary {
  runId: string;
  conferenceId: string;
  runMode: "draft" | "active" | "archived";
  status: "running" | "completed" | "failed" | "infeasible";
  runSeed: number;
  startedAt: string;
  completedAt: string | null;
  totalDelegates: number | null;
  totalExhibitors: number | null;
  totalMeetingsCreated: number | null;
  /**
   * Present only on a late-add run — a run that EXTENDED a frozen schedule
   * instead of rebuilding one.
   *
   * ⛔ `alsoGained` is the re-send list, not a curiosity. Those delegates hold a
   * schedule that is now out of date, and `conference_schedule_ready` exists to
   * send them the new one. A late add is not finished when the run is promoted;
   * it is finished when the people whose day changed have been told.
   */
  lateAdd?: {
    /** Had no meetings, now have at least one. */
    newlySeated: string[];
    /** Already had meetings and picked up another — re-send their schedule. */
    alsoGained: string[];
    /** Still hold nothing: no under-full room and no legal companion. */
    stillWithoutMeetings: string[];
    /** Meetings that did not exist in the frozen schedule. */
    addedMeetings: number;
  };
}

export interface SchedulerDependencyError {
  code: "DEPENDENCY_NOT_READY";
  dependency: "CHUNK_12_COMMERCE_ELIGIBILITY";
  message: string;
}

export type SwapCountMode = "requested" | "committed";

export interface SwapAlternative {
  scheduleId: string;
  exhibitorSeatId: string;
  exhibitorOrganizationId: string;
  score: number;
  scoreDeltaFromOriginal: number;
  scoreBreakdown: ScoreBreakdown;
  reasons: string[];
  whyLower: string[];
}

export interface SwapRequestSummary {
  id: string;
  conferenceId: string;
  schedulerRunId: string;
  delegateSeatId: string;
  dropScheduleId: string;
  replacementExhibitorSeatId: string | null;
  replacementScheduleId: string | null;
  status:
    | "requested"
    | "options_generated"
    | "approved_committed"
    | "denied_invalid"
    | "denied_cap_reached"
    | "canceled";
  swapNumber: number;
  adminOverride: boolean;
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SwapCapStatus {
  baseCap: number;
  approvedExtraSwaps: number;
  effectiveCap: number;
  consumed: number;
  remaining: number;
  countMode: SwapCountMode;
}
