import { isBlackedOut } from "./blackout";
import type {
  MeetingSlotInput,
  ConstraintViolation,
  DelegateProfile,
  ExhibitorProfile,
  ScheduleAssignment,
  SchedulerDiagnosticReport,
  SchedulingPolicy,
} from "./types";

interface ConstraintInput {
  assignments: ScheduleAssignment[];
  /** Needed to tell concurrent slots apart — slot N is the same time in every suite. */
  meetingSlots: MeetingSlotInput[];
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
  /**
   * ⛔ HARD: nobody is in two rooms at once.
   *
   * Checked here as well as avoided in the generator, because the generator is
   * not the only writer — the repair pass, swaps and manual assignment all edit
   * assignments, and a schedule that puts a person in two suites at 09:30 is not
   * a soft preference to weigh, it is impossible. It went unnoticed until a
   * second exhibitor was named, at which point EVERY delegate was double-booked.
   */
  const slotTimeById = new Map(
    input.meetingSlots.map((slot) => [slot.id, `${slot.dayNumber}:${slot.slotNumber}`] as const)
  );
  const delegateSlotTimes = new Map<string, Set<string>>();
  const doubleBooked: Array<{ delegateId: string; when: string }> = [];
  for (const assignment of input.assignments) {
    const when = slotTimeById.get(assignment.meetingSlotId);
    if (!when) continue;
    for (const delegateId of assignment.delegateSeatIds) {
      const seen = delegateSlotTimes.get(delegateId) ?? new Set<string>();
      if (seen.has(when)) {
        doubleBooked.push({ delegateId, when });
      }
      seen.add(when);
      delegateSlotTimes.set(delegateId, seen);
    }
  }
  const doubleBookingViolations: ConstraintViolation[] = doubleBooked.map(({ delegateId, when }) => {
    const [dayNumber, slotNumber] = when.split(":");
    return {
      code: "DELEGATE_DOUBLE_BOOKED" as const,
      severity: "hard" as const,
      message: "A delegate is booked into two suites at the same time",
      details: { delegateSeatId: delegateId, dayNumber: Number(dayNumber), slotNumber: Number(slotNumber) },
    };
  });

  const delegateById = new Map(input.delegates.map((delegate) => [delegate.registrationId, delegate]));
  const exhibitorPartyByRegistration = new Map(
    input.exhibitors.map((exhibitor) => [
      exhibitor.registrationId,
      { organizationId: exhibitor.organizationId, blackoutList: exhibitor.blackoutList },
    ])
  );
  const delegateMeetingCount = new Map<string, number>();
  const exhibitorMeetingCount = new Map<string, number>();
  const delegateSeenOrg = new Map<string, Set<string>>();
  const coveredDelegateOrgs = new Set<string>();

  const violations: ConstraintViolation[] = [...doubleBookingViolations];

  for (const assignment of input.assignments) {
    if (
      assignment.delegateSeatIds.length < input.policy.meetingGroupMin ||
      assignment.delegateSeatIds.length > input.policy.meetingGroupMax
    ) {
      violations.push({
        code: "GROUP_BOUNDS",
        severity: "hard",
        message: "Meeting group size is outside policy bounds",
        details: {
          meetingSlotId: assignment.meetingSlotId,
          size: assignment.delegateSeatIds.length,
          min: input.policy.meetingGroupMin,
          max: input.policy.meetingGroupMax,
        },
      });
    }

    exhibitorMeetingCount.set(
      assignment.exhibitorSeatId,
      (exhibitorMeetingCount.get(assignment.exhibitorSeatId) ?? 0) + 1
    );

    for (const delegateId of assignment.delegateSeatIds) {
      const delegate = delegateById.get(delegateId);
      if (!delegate) continue;

      delegateMeetingCount.set(delegateId, (delegateMeetingCount.get(delegateId) ?? 0) + 1);
      coveredDelegateOrgs.add(delegate.organizationId);

      // Two-way: either side declaring the other is a violation.
      const exhibitorParty = exhibitorPartyByRegistration.get(
        assignment.exhibitorSeatId
      ) ?? { organizationId: assignment.exhibitorOrganizationId, blackoutList: [] };
      if (isBlackedOut(delegate, exhibitorParty)) {
        violations.push({
          code: "BLACKOUT",
          severity: "hard",
          message: "Blackout violation detected",
          details: {
            delegateSeatId: delegateId,
            exhibitorOrganizationId: assignment.exhibitorOrganizationId,
            meetingSlotId: assignment.meetingSlotId,
            declaredBy: delegate.blackoutList.includes(assignment.exhibitorOrganizationId)
              ? "delegate"
              : "exhibitor",
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
            delegateSeatId: delegateId,
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
        delegateSeatIds: delegatesBelowTarget,
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
        exhibitorSeatIds: exhibitorsBelowTarget,
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

export function buildScoreKey(delegateSeatId: string, exhibitorSeatId: string): string {
  return `${delegateSeatId}:${exhibitorSeatId}`;
}

export function isScoreKeyForExhibitor(scoreKey: string, exhibitorSeatId: string): boolean {
  return scoreKey.endsWith(`:${exhibitorSeatId}`);
}

export function exhibitorOrganizationByRegistration(
  exhibitors: ExhibitorProfile[]
): Map<string, string> {
  return new Map(exhibitors.map((exhibitor) => [exhibitor.registrationId, exhibitor.organizationId]));
}
