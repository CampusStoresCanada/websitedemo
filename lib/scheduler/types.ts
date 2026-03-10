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
  primaryCategory: string | null;
  secondaryCategories: string[];
  buyingCyclesTargeted: string[];
  meetingOutcomeIntent: string[];
  salesReadiness: Record<string, unknown> | null;
}

export interface ScoreBreakdown {
  category_overlap: number;
  buying_timeline_match: number;
  priority_alignment: number;
  top_5_preference: number;
  meeting_intent_match: number;
  purchasing_authority: number;
  blackout_penalty: number;
}

export interface MatchScoreRecord {
  delegateRegistrationId: string;
  exhibitorRegistrationId: string;
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
  exhibitorRegistrationId: string;
  exhibitorOrganizationId: string;
  delegateRegistrationIds: string[];
  matchScoreKeys: string[];
}

export type ConstraintSeverity = "hard" | "soft";

export interface ConstraintViolation {
  code:
    | "GROUP_BOUNDS"
    | "DELEGATE_TARGET"
    | "EXHIBITOR_TARGET"
    | "ORG_COVERAGE"
    | "BLACKOUT"
    | "DUPLICATE_EXHIBITOR_ORG"
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
}

export interface SchedulerDependencyError {
  code: "DEPENDENCY_NOT_READY";
  dependency: "CHUNK_12_COMMERCE_ELIGIBILITY";
  message: string;
}

export type SwapCountMode = "requested" | "committed";

export interface SwapAlternative {
  scheduleId: string;
  exhibitorRegistrationId: string;
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
  delegateRegistrationId: string;
  dropScheduleId: string;
  replacementExhibitorId: string | null;
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
