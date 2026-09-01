import type { MeetingSlotInput, ScheduleAssignment, SchedulingPolicy } from "./types";
import { scoreSchedule, type ObjectiveInput, type ObjectiveResult } from "./objective";
import { breakTie } from "./tiebreak";

/**
 * Local search over legal schedules, maximizing the objective in ./objective.ts.
 *
 *     Σ over exhibitors:  matchTotal(e) × occupancy(e)
 *
 * The greedy in ./generate.ts produces the seed. This improves it by applying
 * moves that raise the objective and rejecting everything else — hill climbing,
 * deterministic, bounded.
 *
 * ⛔ LEGALITY IS A FILTER ON MOVES, NEVER A TERM IN THE SCORE. A move that would
 * double-book a person, repeat an org pairing, break group bounds, put an
 * exhibitor in a room they do not hold, or pair a refused org is not a worse
 * move — it is not a move. Nothing here trades a constraint against a score, and
 * a refusal is applied before any score is consulted.
 *
 * WHY THESE MOVES. The measured gap is room-TIME, not pairings: the greedy
 * delivered 122 of a possible 130 pairings while occupying 11.2% of suite-slots.
 * So the moves that matter are the ones that convert the same pairings into more
 * occupied slots (split) or use a dead slot at all (fill). A move that merely
 * relocates a meeting is deliberately absent — occupancy counts slots used, not
 * which ones, so relocation cannot change the objective and would only burn
 * iterations.
 *
 * ⚠️ Ties are pervasive — 39% of scored pairs share one value — so every
 * candidate ordering runs through breakTie(seed, …). Without it two runs of the
 * same input disagree on the ~40% of comparisons that are exactly equal, which
 * reads as instability to anyone diffing them.
 */

export type OptimizeContext = {
  meetingSlots: MeetingSlotInput[];
  policy: Pick<SchedulingPolicy, "meetingGroupMin" | "meetingGroupMax">;
  /** Exhibitor seat → their org and the suite they hold. */
  exhibitorSeats: ReadonlyMap<string, { orgId: string; suiteId: string }>;
  /** Delegate seat → their org and contact. */
  delegateSeats: ReadonlyMap<string, { orgId: string; contactId: string | null }>;
  /** Legality, decided outside: may these two ever meet? */
  mayMeet: (delegateSeatId: string, exhibitorSeatId: string) => boolean;
  objective: Omit<ObjectiveInput, "assignments" | "meetingSlots">;
  seed: number;
  /** Hard stop so a run is predictable. Each pass is O(meetings × slots). */
  maxPasses?: number;
};

export type OptimizeResult = {
  assignments: ScheduleAssignment[];
  before: ObjectiveResult;
  after: ObjectiveResult;
  movesApplied: { split: number; fill: number };
  passes: number;
};

type Slot = MeetingSlotInput;

/** Concurrent slots share (day, slotNumber) — slot N is the same minute in every suite. */
const timeKey = (slot: Slot) => `${slot.dayNumber}:${slot.slotNumber}`;

function cloneAssignments(assignments: ScheduleAssignment[]): ScheduleAssignment[] {
  return assignments.map((a) => ({ ...a, delegateSeatIds: [...a.delegateSeatIds] }));
}

/** When each delegate is already committed, and which orgs they have already met. */
function indexSchedule(assignments: ScheduleAssignment[], slotById: Map<string, Slot>) {
  const busyAt = new Map<string, Set<string>>();
  const metOrgs = new Map<string, Set<string>>();
  const usedSlotIds = new Set<string>();

  for (const assignment of assignments) {
    const slot = slotById.get(assignment.meetingSlotId);
    if (slot) usedSlotIds.add(slot.id);
    for (const delegateSeatId of assignment.delegateSeatIds) {
      if (slot) {
        const busy = busyAt.get(delegateSeatId) ?? new Set<string>();
        busy.add(timeKey(slot));
        busyAt.set(delegateSeatId, busy);
      }
      const met = metOrgs.get(delegateSeatId) ?? new Set<string>();
      met.add(assignment.exhibitorOrganizationId);
      metOrgs.set(delegateSeatId, met);
    }
  }
  return { busyAt, metOrgs, usedSlotIds };
}

export function optimizeSchedule(
  seedAssignments: ScheduleAssignment[],
  context: OptimizeContext
): OptimizeResult {
  const slotById = new Map(context.meetingSlots.map((s) => [s.id, s] as const));

  const slotsBySuite = new Map<string, Slot[]>();
  for (const slot of context.meetingSlots) {
    const list = slotsBySuite.get(slot.suiteId) ?? [];
    list.push(slot);
    slotsBySuite.set(slot.suiteId, list);
  }
  for (const list of slotsBySuite.values()) {
    list.sort((a, b) => a.dayNumber - b.dayNumber || a.slotNumber - b.slotNumber);
  }

  const measure = (assignments: ScheduleAssignment[]) =>
    scoreSchedule({ ...context.objective, assignments, meetingSlots: context.meetingSlots });

  const before = measure(seedAssignments);
  let current = cloneAssignments(seedAssignments);
  let currentValue = before.value;

  const movesApplied = { split: 0, fill: 0 };
  const maxPasses = context.maxPasses ?? 12;
  let passes = 0;

  for (; passes < maxPasses; passes += 1) {
    let improvedThisPass = false;

    // ── SPLIT ────────────────────────────────────────────────────────────────
    // The money move. Same pairings, more occupied slots: a group of four in one
    // slot becomes two groups of two in two slots, and occupancy doubles for the
    // exhibitor while matchTotal is unchanged. This is the mechanism behind
    // "delegate time is the binding constraint" — it converts spare seats into
    // room-time rather than spending delegate-slots on redundant company.
    const splitCandidates = [...current]
      .map((assignment, index) => ({ assignment, index }))
      .filter(({ assignment }) => assignment.delegateSeatIds.length >= context.policy.meetingGroupMin * 2)
      .sort((left, right) =>
        right.assignment.delegateSeatIds.length - left.assignment.delegateSeatIds.length ||
        breakTie(context.seed, left.assignment.meetingSlotId, right.assignment.meetingSlotId)
      );

    for (const { assignment, index } of splitCandidates) {
      const exhibitor = context.exhibitorSeats.get(assignment.exhibitorSeatId);
      if (!exhibitor) continue;

      const { busyAt } = indexSchedule(current, slotById);
      const suiteSlots = slotsBySuite.get(exhibitor.suiteId) ?? [];
      const occupiedByThisSuite = new Set(
        current
          .filter((a) => a.exhibitorSeatId === assignment.exhibitorSeatId)
          .map((a) => a.meetingSlotId)
      );

      // Move the tail of the group; keep both halves at or above the minimum.
      const keep = Math.max(
        context.policy.meetingGroupMin,
        Math.floor(assignment.delegateSeatIds.length / 2)
      );
      const moving = assignment.delegateSeatIds.slice(keep);
      if (moving.length < context.policy.meetingGroupMin) continue;

      const target = suiteSlots.find((slot) => {
        if (occupiedByThisSuite.has(slot.id)) return false;
        // Everyone moving has to be free at that minute — in ANY suite.
        return moving.every((delegateSeatId) => !busyAt.get(delegateSeatId)?.has(timeKey(slot)));
      });
      if (!target) continue;

      const next = cloneAssignments(current);
      next[index].delegateSeatIds = assignment.delegateSeatIds.slice(0, keep);
      next.push({
        meetingSlotId: target.id,
        exhibitorSeatId: assignment.exhibitorSeatId,
        exhibitorOrganizationId: assignment.exhibitorOrganizationId,
        delegateSeatIds: moving,
        matchScoreKeys: [],
      });

      const nextValue = measure(next).value;
      if (nextValue > currentValue) {
        current = next;
        currentValue = nextValue;
        movesApplied.split += 1;
        improvedThisPass = true;
        break; // re-index before trying the next move
      }
    }
    if (improvedThisPass) continue;

    // ── FILL ─────────────────────────────────────────────────────────────────
    // Use a dead slot at all: an exhibitor sitting idle, and delegates who have
    // not met that org and are free at that minute.
    const exhibitorOrder = [...context.exhibitorSeats.entries()].sort(([left], [right]) =>
      breakTie(context.seed, left, right)
    );

    for (const [exhibitorSeatId, exhibitor] of exhibitorOrder) {
      const { busyAt, metOrgs } = indexSchedule(current, slotById);
      const suiteSlots = slotsBySuite.get(exhibitor.suiteId) ?? [];
      const occupied = new Set(
        current.filter((a) => a.exhibitorSeatId === exhibitorSeatId).map((a) => a.meetingSlotId)
      );

      const emptySlot = suiteSlots.find((slot) => !occupied.has(slot.id));
      if (!emptySlot) continue;

      const eligible = [...context.delegateSeats.keys()]
        .filter((delegateSeatId) => {
          if (!context.mayMeet(delegateSeatId, exhibitorSeatId)) return false;
          if (metOrgs.get(delegateSeatId)?.has(exhibitor.orgId)) return false;
          if (busyAt.get(delegateSeatId)?.has(timeKey(emptySlot))) return false;
          return true;
        })
        .sort((left, right) => breakTie(context.seed, left, right))
        .slice(0, context.policy.meetingGroupMax);

      if (eligible.length < context.policy.meetingGroupMin) continue;

      const next = cloneAssignments(current);
      next.push({
        meetingSlotId: emptySlot.id,
        exhibitorSeatId,
        exhibitorOrganizationId: exhibitor.orgId,
        delegateSeatIds: eligible,
        matchScoreKeys: [],
      });

      const nextValue = measure(next).value;
      if (nextValue > currentValue) {
        current = next;
        currentValue = nextValue;
        movesApplied.fill += 1;
        improvedThisPass = true;
        break;
      }
    }

    if (!improvedThisPass) break;
  }

  return {
    assignments: current,
    before,
    after: measure(current),
    movesApplied,
    passes,
  };
}
