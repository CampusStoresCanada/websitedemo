import {
  buildScoreKey,
  exhibitorOrganizationByRegistration,
  validateScheduleConstraints,
} from "./constraints";
import { isBlackedOut } from "./blackout";
import { breakTie, deterministicOrder } from "./tiebreak";
import type {
  DelegateProfile,
  ExhibitorProfile,
  MatchScoreRecord,
  MeetingSlotInput,
  ScheduleAssignment,
  SchedulerGenerateResult,
  SchedulingPolicy,
} from "./types";

interface GenerateInput {
  delegates: DelegateProfile[];
  exhibitors: ExhibitorProfile[];
  meetingSlots: MeetingSlotInput[];
  matchScores: MatchScoreRecord[];
  policy: SchedulingPolicy;
  suitePinnedExhibitorBySuiteId?: Record<string, string>;
  /** Suites that belong to a booth holder — never handed to another exhibitor. */
  reservedSuiteIds?: ReadonlySet<string>;
  seed: number;
}

function selectActiveExhibitorsBySuite(
  exhibitors: ExhibitorProfile[],
  suiteIds: string[],
  seed: number,
  suitePinnedExhibitorBySuiteId?: Record<string, string>,
  reservedSuiteIds?: ReadonlySet<string>
): Map<string, ExhibitorProfile> {
  const orderedSuites = [...suiteIds].sort((a, b) => a.localeCompare(b));
  const exhibitorById = new Map(exhibitors.map((row) => [row.registrationId, row] as const));

  const map = new Map<string, ExhibitorProfile>();
  const pinnedRegistrationIds = new Set<string>();
  for (const suiteId of orderedSuites) {
    const pinnedRegistrationId = suitePinnedExhibitorBySuiteId?.[suiteId];
    if (!pinnedRegistrationId || pinnedRegistrationIds.has(pinnedRegistrationId)) continue;
    const exhibitor = exhibitorById.get(pinnedRegistrationId);
    if (!exhibitor) continue;
    map.set(suiteId, exhibitor);
    pinnedRegistrationIds.add(pinnedRegistrationId);
  }

  const orderedExhibitors = deterministicOrder(
    exhibitors.filter((item) => !pinnedRegistrationIds.has(item.registrationId)),
    seed,
    (item) => item.registrationId
  );
  let exhibitorIndex = 0;
  for (const suiteId of orderedSuites) {
    if (map.has(suiteId)) continue;
    /**
     * ⛔ A suite that belongs to somebody is never free-filled.
     *
     * It reaches here only when its holder had no spare exhibitor registration
     * to staff it — an org running two suites with one person, or a booth holder
     * with nobody registered. Without this the deterministic fill below would
     * hand that room to the next exhibitor in line, i.e. seat a competitor in a
     * booth someone else paid for. An empty room is the correct outcome.
     */
    if (reservedSuiteIds?.has(suiteId)) continue;
    if (exhibitorIndex >= orderedExhibitors.length) break;
    map.set(suiteId, orderedExhibitors[exhibitorIndex]);
    exhibitorIndex += 1;
  }
  return map;
}

function scoreMap(matchScores: MatchScoreRecord[]): Map<string, MatchScoreRecord> {
  return new Map(
    matchScores.map((score) => [buildScoreKey(score.delegateSeatId, score.exhibitorSeatId), score])
  );
}

function delegateCandidateOrder(params: {
  delegateIds: string[];
  exhibitorSeatId: string;
  scoreByKey: Map<string, MatchScoreRecord>;
  seed: number;
}): string[] {
  return [...params.delegateIds].sort((left, right) => {
    const leftScore =
      params.scoreByKey.get(buildScoreKey(left, params.exhibitorSeatId))?.totalScore ??
      Number.NEGATIVE_INFINITY;
    const rightScore =
      params.scoreByKey.get(buildScoreKey(right, params.exhibitorSeatId))?.totalScore ??
      Number.NEGATIVE_INFINITY;

    if (leftScore !== rightScore) return rightScore - leftScore;
    return breakTie(params.seed, left, right);
  });
}

export function generateSchedule(input: GenerateInput): SchedulerGenerateResult {
  const orderedSlots = [...input.meetingSlots].sort((a, b) => {
    if (a.dayNumber !== b.dayNumber) return a.dayNumber - b.dayNumber;
    if (a.slotNumber !== b.slotNumber) return a.slotNumber - b.slotNumber;
    return a.suiteId.localeCompare(b.suiteId);
  });
  const suiteIds = [...new Set(orderedSlots.map((slot) => slot.suiteId))];
  const suiteToExhibitor = selectActiveExhibitorsBySuite(
    input.exhibitors,
    suiteIds,
    input.seed,
    input.suitePinnedExhibitorBySuiteId,
    input.reservedSuiteIds
  );
  const scoreByKey = scoreMap(input.matchScores);
  const delegateById = new Map(
    input.delegates.map((delegate) => [delegate.registrationId, delegate])
  );
  const exhibitorOrgByRegistration = exhibitorOrganizationByRegistration(input.exhibitors);

  const delegateTargetMeetings = Math.ceil(suiteIds.length * input.policy.delegateCoveragePct);
  const exhibitorTargetMeetings = Math.max(1, Math.floor(orderedSlots.length / Math.max(1, input.exhibitors.length)));

  const delegateMeetingCount = new Map<string, number>();
  const delegateSeenExhibitorOrg = new Map<string, Set<string>>();

  const assignments: ScheduleAssignment[] = [];

  for (const slot of orderedSlots) {
    const exhibitor = suiteToExhibitor.get(slot.suiteId);
    if (!exhibitor) continue;

    const orderedDelegates = delegateCandidateOrder({
      delegateIds: input.delegates.map((delegate) => delegate.registrationId),
      exhibitorSeatId: exhibitor.registrationId,
      scoreByKey,
      seed: input.seed,
    });

    const selected: string[] = [];
    for (const delegateId of orderedDelegates) {
      if (selected.length >= input.policy.meetingGroupMax) break;

      // Blackout is checked against the parties themselves, never against the
      // score record. A score may rank a pairing; it may not authorise one.
      // See lib/scheduler/blackout.ts.
      const delegate = delegateById.get(delegateId);
      if (!delegate || isBlackedOut(delegate, exhibitor)) continue;

      const score = scoreByKey.get(buildScoreKey(delegateId, exhibitor.registrationId));
      if (!score || !Number.isFinite(score.totalScore)) continue;

      const seen = delegateSeenExhibitorOrg.get(delegateId) ?? new Set<string>();
      if (seen.has(exhibitor.organizationId)) continue;

      const meetings = delegateMeetingCount.get(delegateId) ?? 0;
      if (meetings >= delegateTargetMeetings) continue;

      selected.push(delegateId);
    }

    if (selected.length < input.policy.meetingGroupMin) {
      continue;
    }

    for (const delegateId of selected) {
      delegateMeetingCount.set(delegateId, (delegateMeetingCount.get(delegateId) ?? 0) + 1);
      const seen = delegateSeenExhibitorOrg.get(delegateId) ?? new Set<string>();
      seen.add(exhibitor.organizationId);
      delegateSeenExhibitorOrg.set(delegateId, seen);
    }

    assignments.push({
      meetingSlotId: slot.id,
      exhibitorSeatId: exhibitor.registrationId,
      exhibitorOrganizationId: exhibitor.organizationId,
      delegateSeatIds: selected,
      matchScoreKeys: selected.map((delegateId) =>
        buildScoreKey(delegateId, exhibitor.registrationId)
      ),
    });
  }

  // Repair pass: fill under-served delegates into existing groups with capacity.
  const delegatesBelowTarget = input.delegates
    .filter((delegate) => (delegateMeetingCount.get(delegate.registrationId) ?? 0) < delegateTargetMeetings)
    .map((delegate) => delegate.registrationId);

  for (const delegateId of delegatesBelowTarget) {
    const candidates = assignments
      .filter((assignment) => assignment.delegateSeatIds.length < input.policy.meetingGroupMax)
      .filter((assignment) => {
        const exhibitorOrgId =
          exhibitorOrgByRegistration.get(assignment.exhibitorSeatId) ??
          assignment.exhibitorOrganizationId;
        const seen = delegateSeenExhibitorOrg.get(delegateId) ?? new Set<string>();
        if (seen.has(exhibitorOrgId)) return false;

        const score = scoreByKey.get(buildScoreKey(delegateId, assignment.exhibitorSeatId));
        return Boolean(score && !score.isBlackout && Number.isFinite(score.totalScore));
      })
      .sort((left, right) => {
        const leftScore =
          scoreByKey.get(buildScoreKey(delegateId, left.exhibitorSeatId))?.totalScore ??
          Number.NEGATIVE_INFINITY;
        const rightScore =
          scoreByKey.get(buildScoreKey(delegateId, right.exhibitorSeatId))?.totalScore ??
          Number.NEGATIVE_INFINITY;
        if (leftScore !== rightScore) return rightScore - leftScore;
        return breakTie(input.seed, left.meetingSlotId, right.meetingSlotId);
      });

    for (const assignment of candidates) {
      if ((delegateMeetingCount.get(delegateId) ?? 0) >= delegateTargetMeetings) break;

      assignment.delegateSeatIds.push(delegateId);
      assignment.matchScoreKeys.push(buildScoreKey(delegateId, assignment.exhibitorSeatId));

      delegateMeetingCount.set(delegateId, (delegateMeetingCount.get(delegateId) ?? 0) + 1);
      const seen = delegateSeenExhibitorOrg.get(delegateId) ?? new Set<string>();
      seen.add(assignment.exhibitorOrganizationId);
      delegateSeenExhibitorOrg.set(delegateId, seen);
    }
  }

  const diagnostics = validateScheduleConstraints({
    assignments,
    delegates: input.delegates,
    exhibitors: input.exhibitors,
    delegateTargetMeetings,
    exhibitorTargetMeetings,
    policy: input.policy,
  });

  return {
    status: diagnostics.status,
    assignments,
    diagnostics,
  };
}
