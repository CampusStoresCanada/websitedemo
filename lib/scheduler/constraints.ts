import type {
  ConstraintViolation,
  DelegateProfile,
  ExhibitorProfile,
  ScheduleAssignment,
  SchedulerDiagnosticReport,
  SchedulingPolicy,
} from "./types";

interface ConstraintInput {
  assignments: ScheduleAssignment[];
  delegates: DelegateProfile[];
  exhibitors: ExhibitorProfile[];
  delegateTargetMeetings: number;
  exhibitorTargetMeetings: number;
  policy: SchedulingPolicy;
}

function pct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 10000) / 100;
}

export function validateScheduleConstraints(input: ConstraintInput): SchedulerDiagnosticReport {
  const delegateById = new Map(input.delegates.map((delegate) => [delegate.registrationId, delegate]));
  const delegateMeetingCount = new Map<string, number>();
  const exhibitorMeetingCount = new Map<string, number>();
  const delegateSeenOrg = new Map<string, Set<string>>();
  const coveredDelegateOrgs = new Set<string>();

  const violations: ConstraintViolation[] = [];

  for (const assignment of input.assignments) {
    if (
      assignment.delegateRegistrationIds.length < input.policy.meetingGroupMin ||
      assignment.delegateRegistrationIds.length > input.policy.meetingGroupMax
    ) {
      violations.push({
        code: "GROUP_BOUNDS",
        severity: "hard",
        message: "Meeting group size is outside policy bounds",
        details: {
          meetingSlotId: assignment.meetingSlotId,
          size: assignment.delegateRegistrationIds.length,
          min: input.policy.meetingGroupMin,
          max: input.policy.meetingGroupMax,
        },
      });
    }

    exhibitorMeetingCount.set(
      assignment.exhibitorRegistrationId,
      (exhibitorMeetingCount.get(assignment.exhibitorRegistrationId) ?? 0) + 1
    );

    for (const delegateId of assignment.delegateRegistrationIds) {
      const delegate = delegateById.get(delegateId);
      if (!delegate) continue;

      delegateMeetingCount.set(delegateId, (delegateMeetingCount.get(delegateId) ?? 0) + 1);
      coveredDelegateOrgs.add(delegate.organizationId);

      if (delegate.blackoutList.includes(assignment.exhibitorOrganizationId)) {
        violations.push({
          code: "BLACKOUT",
          severity: "hard",
          message: "Blackout violation detected",
          details: {
            delegateRegistrationId: delegateId,
            exhibitorOrganizationId: assignment.exhibitorOrganizationId,
            meetingSlotId: assignment.meetingSlotId,
          },
        });
      }

      const seen = delegateSeenOrg.get(delegateId) ?? new Set<string>();
      if (seen.has(assignment.exhibitorOrganizationId)) {
        violations.push({
          code: "DUPLICATE_EXHIBITOR_ORG",
          severity: "hard",
          message: "Delegate was assigned duplicate exhibitor organization",
          details: {
            delegateRegistrationId: delegateId,
            exhibitorOrganizationId: assignment.exhibitorOrganizationId,
          },
        });
      }
      seen.add(assignment.exhibitorOrganizationId);
      delegateSeenOrg.set(delegateId, seen);
    }
  }

  const delegatesBelowTarget = input.delegates
    .filter(
      (delegate) => (delegateMeetingCount.get(delegate.registrationId) ?? 0) < input.delegateTargetMeetings
    )
    .map((delegate) => delegate.registrationId);

  if (delegatesBelowTarget.length > 0) {
    violations.push({
      code: "DELEGATE_TARGET",
      severity: "soft",
      message: "One or more delegates are below target meetings",
      details: {
        target: input.delegateTargetMeetings,
        delegateRegistrationIds: delegatesBelowTarget,
      },
    });
  }

  const exhibitorsBelowTarget = input.exhibitors
    .filter(
      (exhibitor) =>
        (exhibitorMeetingCount.get(exhibitor.registrationId) ?? 0) < input.exhibitorTargetMeetings
    )
    .map((exhibitor) => exhibitor.registrationId);

  if (exhibitorsBelowTarget.length > 0) {
    violations.push({
      code: "EXHIBITOR_TARGET",
      severity: "soft",
      message: "One or more exhibitors are below target meetings",
      details: {
        target: input.exhibitorTargetMeetings,
        exhibitorRegistrationIds: exhibitorsBelowTarget,
      },
    });
  }

  const uniqueDelegateOrgs = new Set(input.delegates.map((delegate) => delegate.organizationId));
  const coverage = pct(coveredDelegateOrgs.size, uniqueDelegateOrgs.size);

  if (coverage < input.policy.orgCoveragePct) {
    violations.push({
      code: "ORG_COVERAGE",
      severity: "soft",
      message: "Delegate organization coverage is below policy threshold",
      details: {
        requiredPct: input.policy.orgCoveragePct,
        achievedPct: coverage,
      },
    });
  }

  if (input.policy.feasibilityRelaxation) {
    violations.push({
      code: "POLICY_RELAXATION_DISABLED",
      severity: "soft",
      message: "Feasibility relaxation policy is set but scheduler enforces hard constraints only",
      details: {
        policyValue: input.policy.feasibilityRelaxation,
      },
    });
  }

  const hasHardViolation = violations.some((v) => v.severity === "hard");
  const hasSoftViolation = violations.some((v) => v.severity === "soft");

  const status = hasHardViolation
    ? "infeasible"
    : hasSoftViolation
      ? "completed_with_warnings"
      : "completed";

  return {
    status,
    violations,
    delegateTargetMeetings: input.delegateTargetMeetings,
    totalAssignments: input.assignments.length,
    delegatesBelowTarget,
    exhibitorsBelowTarget,
    orgCoveragePctAchieved: coverage,
  };
}

export function buildScoreKey(delegateRegistrationId: string, exhibitorRegistrationId: string): string {
  return `${delegateRegistrationId}:${exhibitorRegistrationId}`;
}

export function isScoreKeyForExhibitor(scoreKey: string, exhibitorRegistrationId: string): boolean {
  return scoreKey.endsWith(`:${exhibitorRegistrationId}`);
}

export function exhibitorOrganizationByRegistration(
  exhibitors: ExhibitorProfile[]
): Map<string, string> {
  return new Map(exhibitors.map((exhibitor) => [exhibitor.registrationId, exhibitor.organizationId]));
}
