import {
  buildScoreKey,
  exhibitorOrganizationByRegistration,
  validateScheduleConstraints,
} from "./constraints";
import { isBlackedOut } from "./blackout";
import { breakTie } from "./tiebreak";
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
  seed: number;
}

function selectActiveExhibitorsBySuite(
  exhibitors: ExhibitorProfile[],
  suiteIds: string[],
  seed: number,
  suitePinnedExhibitorBySuiteId?: Record<string, string>
): { bySuiteId: Map<string, ExhibitorProfile>; suitelessExhibitors: string[] } {
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

  /**
   * ⛔ NO FREE-FILL. A suite is only ever hosted by the org that holds it.
   *
   * This used to deal the leftover exhibitors round-robin into whatever suites
   * were unpinned — `deterministicOrder(...)` then one exhibitor per empty
   * suite. That is the v2 model showing through: suites were N anonymous rooms
   * from a count, and CSC allocated them. The seeding was ported to real Suite
   * entities ("1:1 from the Suite entities … instead of N anonymous rows from a
   * count"); the ALLOCATION never was.
   *
   * Under v3 a suite is part of a booth — `booth --includes--> suite` — so you
   * hold it by holding the booth, and nothing else can grant it. The free-fill
   * handed a $6,000 suite to an exhibitor who had not bought one: on the first
   * real run it put Boxercraft (booth 305, $4,000, no suite) into unsold suite
   * 107. That is inventory given away by a solver, which is not a decision a
   * solver gets to make.
   *
   * An exhibitor with no suite now gets no suite. Meetings are a suite benefit:
   * a booth that includes no suite gets none, by design, and the CALLER filters
   * those out before they reach here so they are not reported as a fault. If
   * CSC wants to lend a room out, that is a deliberate manual assignment
   * (`is_manual`), visible and attributable — not a side effect of the seed.
   */
  const suitelessExhibitors = exhibitors
    .filter((item) => !pinnedRegistrationIds.has(item.registrationId))
    .map((item) => item.registrationId);

  return { bySuiteId: map, suitelessExhibitors };
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
  const { bySuiteId: suiteToExhibitor, suitelessExhibitors } = selectActiveExhibitorsBySuite(
    input.exhibitors,
    suiteIds,
    input.seed,
    input.suitePinnedExhibitorBySuiteId
  );
  const scoreByKey = scoreMap(input.matchScores);
  const delegateById = new Map(
    input.delegates.map((delegate) => [delegate.registrationId, delegate])
  );
  const exhibitorOrgByRegistration = exhibitorOrganizationByRegistration(input.exhibitors);

  /**
   * ⛔ A DELEGATE'S CEILING IS TIMES, NOT SUITES.
   *
   * This was `suiteIds.length * pct`, and on CSC 2027 that is
   * ceil(31 × 0.75) = 24 — while there are only 23 DISTINCT MEETING TIMES
   * (713 slots ÷ 31 suites), and a person can be in one room at a time. So the
   * target exceeded the physical maximum by one, for every delegate, on every
   * run: DELEGATE_TARGET fired on 100% of delegates always, which is the same
   * as not having the check at all. A permanently-red warning is worse than a
   * missing one, because people learn to scroll past it.
   *
   * Suites and times are different numbers and the formula reached for the
   * wrong one. Coverage means "what share of the meeting day is this person
   * actually in a meeting", so the denominator is the day.
   */
  const distinctMeetingTimes = new Set(
    input.meetingSlots.map((slot) => `${slot.dayNumber}:${slot.slotNumber}`)
  ).size;
  const delegateTargetMeetings = Math.ceil(
    distinctMeetingTimes * input.policy.delegateCoveragePct
  );
  const exhibitorTargetMeetings = Math.max(1, Math.floor(orderedSlots.length / Math.max(1, input.exhibitors.length)));

  const delegateMeetingCount = new Map<string, number>();
  const delegateSeenExhibitorOrg = new Map<string, Set<string>>();

  /**
   * ⛔ A person cannot be in two rooms at once.
   *
   * Slots in different suites SHARE (dayNumber, slotNumber) — slot 1 is 09:30 in
   * every suite. Nothing tracked that, so with one exhibitor the schedule looked
   * perfect and with two, every single delegate was booked into both suites at
   * 09:30. The blackout / no-repeat-org / target checks all passed: none of them
   * is about time.
   */
  const slotKeyOf = (slot: MeetingSlotInput) => `${slot.dayNumber}:${slot.slotNumber}`;
  const delegateBusyAt = new Map<string, Set<string>>();
  const slotById = new Map(input.meetingSlots.map((slot) => [slot.id, slot] as const));

  const assignments: ScheduleAssignment[] = [];

  /**
   * SPREAD A LIGHTLY-BOOKED EXHIBITOR ACROSS THE DAY.
   *
   * The loop walks slots in order and fills greedily, so an exhibitor with only
   * enough demand for three meetings got slots 1, 2, 3 — three back-to-back
   * meetings at 09:30 and then an empty room until 17:15. Correct, and a bad
   * day for everyone in it.
   *
   * How many meetings a suite can actually hold is knowable before assigning:
   * every delegate may meet an org once (DUPLICATE_EXHIBITOR_ORG), so it is
   * ceil(eligible delegates / group max), capped by the slots the suite has.
   * Take that many slots evenly spaced across the day instead of the first N.
   *
   * ⚠️ A CEILING, not a quota — the loop still skips a slot it cannot fill, so
   * spreading never invents meetings. It only changes WHICH slots are offered.
   */
  const slotsBySuite = new Map<string, MeetingSlotInput[]>();
  for (const slot of orderedSlots) {
    const list = slotsBySuite.get(slot.suiteId) ?? [];
    list.push(slot);
    slotsBySuite.set(slot.suiteId, list);
  }

  /**
   * ⚠️ STAGGER the spread per suite, or spreading makes coverage worse.
   *
   * Offering every suite the same evenly-spaced slots (1, 8, 16) puts all the
   * lightly-booked exhibitors head-to-head at the same three times, and the
   * delegates they both want can only be in one room. Measured: Merangue lost a
   * meeting that way — two delegates never met them because both were sitting
   * with Crestar at 15:00.
   *
   * A phase offset per suite means concurrent exhibitors are offered different
   * times, so the same delegate can see both across the day.
   */
  const offeredSlotIds = new Set<string>();
  const suiteOrder = [...slotsBySuite.keys()].sort((a, b) => a.localeCompare(b));
  for (const [suiteId, suiteSlots] of slotsBySuite) {
    const exhibitor = suiteToExhibitor.get(suiteId);
    if (!exhibitor) continue;

    const eligible = input.delegates.filter(
      (delegate) => !isBlackedOut(delegate, exhibitor)
    ).length;
    const wanted = Math.min(
      suiteSlots.length,
      Math.ceil(eligible / Math.max(1, input.policy.meetingGroupMax))
    );
    if (wanted >= suiteSlots.length) {
      for (const slot of suiteSlots) offeredSlotIds.add(slot.id);
      continue;
    }
    // Evenly spaced, then phase-shifted by this suite's position so concurrent
    // suites are offered different times rather than the same ones.
    const step = suiteSlots.length / wanted;
    const phase = suiteOrder.length > 1
      ? (suiteOrder.indexOf(suiteId) / suiteOrder.length) * step
      : 0;
    for (let i = 0; i < wanted; i += 1) {
      const index = Math.min(suiteSlots.length - 1, Math.floor(i * step + phase));
      offeredSlotIds.add(suiteSlots[index].id);
    }
  }

  for (const slot of orderedSlots) {
    const exhibitor = suiteToExhibitor.get(slot.suiteId);
    if (!exhibitor) continue;
    if (!offeredSlotIds.has(slot.id)) continue;

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

      // Already in another suite at this time.
      if (delegateBusyAt.get(delegateId)?.has(slotKeyOf(slot))) continue;

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
      const busy = delegateBusyAt.get(delegateId) ?? new Set<string>();
      busy.add(slotKeyOf(slot));
      delegateBusyAt.set(delegateId, busy);
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

        // The repair pass adds a person to an EXISTING group, so it has to
        // respect the clock exactly like the main loop does.
        const slot = slotById.get(assignment.meetingSlotId);
        if (slot && delegateBusyAt.get(delegateId)?.has(slotKeyOf(slot))) return false;

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
      const repairSlot = slotById.get(assignment.meetingSlotId);
      if (repairSlot) {
        const busy = delegateBusyAt.get(delegateId) ?? new Set<string>();
        busy.add(slotKeyOf(repairSlot));
        delegateBusyAt.set(delegateId, busy);
      }
    }
  }

  const diagnostics = validateScheduleConstraints({
    assignments,
    meetingSlots: input.meetingSlots,
    delegates: input.delegates,
    exhibitors: input.exhibitors,
    delegateTargetMeetings,
    exhibitorTargetMeetings,
    policy: input.policy,
  });

  /**
   * An exhibitor with no suite is now UNSCHEDULED, not quietly given someone
   * else's room. Say so out loud: silently dropping a paid exhibitor from the
   * run is the same failure mode as reporting an unreadable roster as an empty
   * one. It is a warning, not infeasible — the schedule is valid, it just does
   * not include them, and whether a booth without a suite should get meetings
   * at all is a business decision, not the solver's.
   */
  /**
   * Reaching here means an exhibitor who DOES hold a suite still got no room —
   * the caller has already excluded booths that include no suite, because for
   * those, no meetings is the product rather than a fault.
   *
   * The realistic cause is staffing: each suite pins a DIFFERENT exhibitor
   * registration, so an org running two suites with one named person can only
   * fill one. That is worth saying — they paid for a room that will sit empty —
   * but it is not infeasible, and it is fixed by naming someone, not by code.
   */
  if (suitelessExhibitors.length > 0) {
    diagnostics.violations.push({
      code: "EXHIBITOR_WITHOUT_SUITE",
      severity: "soft",
      message:
        `${suitelessExhibitors.length} exhibitor(s) hold a suite but were not placed in one — ` +
        `usually an org with more suites than named staff, since each suite needs its own person. ` +
        `Name someone to the seat, or the room sits empty.`,
      details: { exhibitorRegistrationIds: suitelessExhibitors },
    });
    if (diagnostics.status === "completed") diagnostics.status = "completed_with_warnings";
  }

  return {
    status: diagnostics.status,
    assignments,
    diagnostics,
  };
}
