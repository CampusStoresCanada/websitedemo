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

  /**
   * ⛔ MEASURE AGAINST WHAT WAS ACHIEVABLE FOR THIS PERSON, not a flat target.
   *
   * Steve: "if we have someone blacklist all the partners and then come to the
   * conference... what are they doing?" Exactly the right question, and the flat
   * version could not answer it. Someone who refuses every exhibitor gets zero
   * meetings BY THEIR OWN CHOICE, and appeared in this list identical to a
   * delegate the solver simply never picked up. One is not a failure at all; the
   * other is the failure this check exists to catch. A metric that cannot tell
   * them apart reports the wrong number in both directions — and it drags the
   * headline down with people we did nothing wrong by.
   *
   * So a delegate's ceiling is the number of exhibitor ORGS they may actually
   * meet — distinct orgs (they meet each at most once, see DUPLICATE_EXHIBITOR_ORG)
   * minus anyone blacked out in either direction — capped by the target.
   */
  const exhibitorOrgs = [...new Set(input.exhibitors.map((e) => e.organizationId))];
  const reachableOrgCount = (delegate: (typeof input.delegates)[number]): number =>
    exhibitorOrgs.filter((orgId) => {
      const exhibitor = input.exhibitors.find((e) => e.organizationId === orgId);
      if (!exhibitor) return false;
      return !isBlackedOut(
        { organizationId: delegate.organizationId, blackoutList: delegate.blackoutList },
        { organizationId: orgId, blackoutList: exhibitor.blackoutList }
      );
    }).length;

  const delegatesBelowTarget: string[] = [];
  /** Zero meetings because they refused everyone — their call, not our miss. */
  const delegatesSelfExcluded: string[] = [];

  for (const delegate of input.delegates) {
    const achieved = delegateMeetingCount.get(delegate.registrationId) ?? 0;
    const reachable = reachableOrgCount(delegate);
    if (reachable === 0) {
      delegatesSelfExcluded.push(delegate.registrationId);
      continue;
    }
    // Never demand more than this person could possibly have had.
    if (achieved < Math.min(input.delegateTargetMeetings, reachable)) {
      delegatesBelowTarget.push(delegate.registrationId);
    }
  }

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

  /**
   * Reported, never a violation. Someone attending while meeting nobody is not a
   * scheduling defect — but it IS worth a human knowing, because it says
   * something about why they come (sessions, peers, the AGM) that no other
   * signal says.
   */
  if (delegatesSelfExcluded.length > 0) {
    violations.push({
      code: "DELEGATE_SELF_EXCLUDED",
      severity: "info",
      message: "Delegates attending with no meetable exhibitors, by their own refusals",
      details: { delegateSeatIds: delegatesSelfExcluded },
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

  /**
   * PER-PERSON COVERAGE — did anyone fly here and meet nobody?
   *
   * ⛔ ORG COVERAGE CANNOT ANSWER THIS AND NEVER COULD. It asks what share of
   * member ORGS got at least one meeting, so a store sending four buyers is
   * "covered" when one of them meets somebody and the other three meet nobody.
   * The people who lose out are invisible at exactly the grain they are people.
   *
   * ⛔ AND IT IS NOT A PERCENTAGE. Every other coverage number here has a
   * tolerance, and a tolerance is right for "how full is the day". It is wrong
   * here: 97% coverage means 3% of the room flew to Toronto, sat through the
   * meeting block, and met no one. There is no share of that which is fine, so
   * the gate is any-at-all rather than a threshold somebody can tune down to
   * make a run look green.
   *
   * ⛔ Self-excluded delegates are OUT OF THE DENOMINATOR, not counted as
   * failures — they refused everyone, which is their call. Including them would
   * make the number unfixable by us and therefore ignorable.
   */
  const reachableDelegates = input.delegates.filter((d) => reachableOrgCount(d) > 0);
  const delegatesWithNoMeetings = reachableDelegates
    .filter((d) => (delegateMeetingCount.get(d.registrationId) ?? 0) === 0)
    .map((d) => d.registrationId);
  const personCoverage = pct(
    reachableDelegates.length - delegatesWithNoMeetings.length,
    reachableDelegates.length
  );

  if (delegatesWithNoMeetings.length > 0) {
    violations.push({
      code: "PERSON_COVERAGE",
      severity: "soft",
      message: "One or more delegates have no meetings at all",
      details: {
        delegateSeatIds: delegatesWithNoMeetings,
        achievedPct: personCoverage,
        /** Named so a reader does not confuse this with ORG_COVERAGE passing. */
        note: "These delegates could have met someone and were scheduled with nobody.",
      },
    });
  }

  const uniqueDelegateOrgs = new Set(input.delegates.map((delegate) => delegate.organizationId));
  const coverage = pct(coveredDelegateOrgs.size, uniqueDelegateOrgs.size);

  /**
   * ⛔ UNIT MISMATCH — `pct()` returns 0..100, the policy is stored 0..1.
   *
   * This read `coverage < input.policy.orgCoveragePct`, i.e. `50 < 0.7`, which
   * is false for every coverage above zero. ORG_COVERAGE therefore fired ONLY
   * when not a single delegate org was scheduled, and passed silently in every
   * case it was written to catch. The exact mirror of DELEGATE_TARGET, which
   * demanded 24 of a possible 23 and so fired always: one gate stuck green, one
   * stuck red, neither carrying information. Both found the same afternoon.
   */
  if (coverage < input.policy.orgCoveragePct * 100) {
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
    /** Share of delegates who could meet someone and did. See PERSON_COVERAGE. */
    personCoveragePctAchieved: personCoverage,
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
