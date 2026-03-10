import {
  buildScoreKey,
  exhibitorOrganizationByRegistration,
  validateScheduleConstraints,
} from "./constraints";
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
  seed: number;
}

function selectActiveExhibitorsBySuite(
  exhibitors: ExhibitorProfile[],
  suiteIds: string[],
  seed: number
): Map<string, ExhibitorProfile> {
  const orderedSuites = [...suiteIds].sort((a, b) => a.localeCompare(b));
  const orderedExhibitors = deterministicOrder(exhibitors, seed, (item) => item.registrationId);

  const map = new Map<string, ExhibitorProfile>();
  for (let index = 0; index < orderedSuites.length; index += 1) {
    if (index >= orderedExhibitors.length) break;
    map.set(orderedSuites[index], orderedExhibitors[index]);
  }
  return map;
}

function scoreMap(matchScores: MatchScoreRecord[]): Map<string, MatchScoreRecord> {
  return new Map(
    matchScores.map((score) => [buildScoreKey(score.delegateRegistrationId, score.exhibitorRegistrationId), score])
  );
}

function delegateCandidateOrder(params: {
  delegateIds: string[];
  exhibitorRegistrationId: string;
  scoreByKey: Map<string, MatchScoreRecord>;
  seed: number;
}): string[] {
  return [...params.delegateIds].sort((left, right) => {
    const leftScore =
      params.scoreByKey.get(buildScoreKey(left, params.exhibitorRegistrationId))?.totalScore ??
      Number.NEGATIVE_INFINITY;
    const rightScore =
      params.scoreByKey.get(buildScoreKey(right, params.exhibitorRegistrationId))?.totalScore ??
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
  const suiteToExhibitor = selectActiveExhibitorsBySuite(input.exhibitors, suiteIds, input.seed);
  const scoreByKey = scoreMap(input.matchScores);
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
      exhibitorRegistrationId: exhibitor.registrationId,
      scoreByKey,
      seed: input.seed,
    });

    const selected: string[] = [];
    for (const delegateId of orderedDelegates) {
      if (selected.length >= input.policy.meetingGroupMax) break;

      const score = scoreByKey.get(buildScoreKey(delegateId, exhibitor.registrationId));
      if (!score || score.isBlackout || !Number.isFinite(score.totalScore)) continue;

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
      exhibitorRegistrationId: exhibitor.registrationId,
      exhibitorOrganizationId: exhibitor.organizationId,
      delegateRegistrationIds: selected,
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
      .filter((assignment) => assignment.delegateRegistrationIds.length < input.policy.meetingGroupMax)
      .filter((assignment) => {
        const exhibitorOrgId =
          exhibitorOrgByRegistration.get(assignment.exhibitorRegistrationId) ??
          assignment.exhibitorOrganizationId;
        const seen = delegateSeenExhibitorOrg.get(delegateId) ?? new Set<string>();
        if (seen.has(exhibitorOrgId)) return false;

        const score = scoreByKey.get(buildScoreKey(delegateId, assignment.exhibitorRegistrationId));
        return Boolean(score && !score.isBlackout && Number.isFinite(score.totalScore));
      })
      .sort((left, right) => {
        const leftScore =
          scoreByKey.get(buildScoreKey(delegateId, left.exhibitorRegistrationId))?.totalScore ??
          Number.NEGATIVE_INFINITY;
        const rightScore =
          scoreByKey.get(buildScoreKey(delegateId, right.exhibitorRegistrationId))?.totalScore ??
          Number.NEGATIVE_INFINITY;
        if (leftScore !== rightScore) return rightScore - leftScore;
        return breakTie(input.seed, left.meetingSlotId, right.meetingSlotId);
      });

    for (const assignment of candidates) {
      if ((delegateMeetingCount.get(delegateId) ?? 0) >= delegateTargetMeetings) break;

      assignment.delegateRegistrationIds.push(delegateId);
      assignment.matchScoreKeys.push(buildScoreKey(delegateId, assignment.exhibitorRegistrationId));

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
