import type { MeetingSlotInput, ScheduleAssignment, SchedulingPolicy } from "./types";
import {
  scoreSchedule,
  DEFAULT_PREFERENCE_WEIGHT,
  type ObjectiveInput,
  type ObjectiveResult,
} from "./objective";
import { breakTie, seededRandom } from "./tiebreak";

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
  /**
   * How many delegate-pair swaps to examine per pass.
   *
   * ⚠️ Not merely a budget. The swap neighbourhood is every pair of meetings ×
   * every pair of their delegates, which is far too large to enumerate; the cap
   * plus SEED-ORDERED scanning is what gives each restart a different slice of
   * it to explore, and therefore a different local optimum. Raising it deepens
   * one draw; raising restarts widens the sample. They are different levers.
   */
  maxSwapTrials?: number;
};

export type OptimizeResult = {
  assignments: ScheduleAssignment[];
  before: ObjectiveResult;
  after: ObjectiveResult;
  /**
   * `rescue` is not an improvement — it is the floor being enforced. A non-zero
   * count means the objective's best schedule left somebody with no meetings at
   * all and we took score back off the table to fix it.
   */
  movesApplied: { split: number; fill: number; swap: number; rescue: number };
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

/**
 * Disturb a schedule without regard to whether it gets better.
 *
 * ⛔ THE POINT IS TO MOVE, NOT TO IMPROVE. Hill climbing stops at the top of
 * whatever hill it started on; the only way off is to be pushed. Every move in
 * `optimizeSchedule` is accepted solely when it raises the objective, so on its
 * own it can never leave a local optimum — which is why random restarts existed
 * at all.
 *
 * ⚠️ But a restart throws the good answer away. Measured on a converged run: 51
 * of 54 draws started cold, spent ~92 seconds each, and finished worse than a
 * schedule already in hand. Perturbing the incumbent instead spends that time
 * NEAR the good answer.
 *
 * Legality is still absolute — a perturbation may not create a pairing the
 * blackout filter forbids, double-book a person, repeat an exhibitor org for
 * someone, or break group bounds. Swapping two delegates between meetings
 * preserves group sizes by construction, so bounds cannot be violated here.
 */
export function perturbSchedule(
  assignments: ScheduleAssignment[],
  context: OptimizeContext,
  seed: number,
  /** How many random legal swaps to apply. Larger = further from the incumbent. */
  strength: number
): ScheduleAssignment[] {
  const slotById = new Map(context.meetingSlots.map((slot) => [slot.id, slot] as const));
  let current = cloneAssignments(assignments);
  const random = seededRandom(seed);

  let applied = 0;
  // Bounded so a schedule with no legal swap left cannot spin forever.
  for (let attempt = 0; attempt < strength * 40 && applied < strength; attempt += 1) {
    if (current.length < 2) break;
    const a = Math.floor(random() * current.length);
    const b = Math.floor(random() * current.length);
    if (a === b) continue;

    const left = current[a];
    const right = current[b];
    if (left.exhibitorSeatId === right.exhibitorSeatId) continue;
    const leftSlot = slotById.get(left.meetingSlotId);
    const rightSlot = slotById.get(right.meetingSlotId);
    if (!leftSlot || !rightSlot) continue;
    if (left.delegateSeatIds.length === 0 || right.delegateSeatIds.length === 0) continue;

    const leftDelegate =
      left.delegateSeatIds[Math.floor(random() * left.delegateSeatIds.length)];
    const rightDelegate =
      right.delegateSeatIds[Math.floor(random() * right.delegateSeatIds.length)];
    if (leftDelegate === rightDelegate) continue;

    const { busyAt, metOrgs } = indexSchedule(current, slotById);
    const canMove = (
      mover: string,
      from: ScheduleAssignment,
      to: ScheduleAssignment,
      toSlot: MeetingSlotInput
    ): boolean => {
      if (!context.mayMeet(mover, to.exhibitorSeatId)) return false;
      if (metOrgs.get(mover)?.has(to.exhibitorOrganizationId)) return false;
      const fromSlot = slotById.get(from.meetingSlotId);
      const busy = busyAt.get(mover);
      if (!busy) return true;
      return !busy.has(timeKey(toSlot)) || timeKey(toSlot) === timeKey(fromSlot!);
    };
    if (!canMove(leftDelegate, left, right, rightSlot)) continue;
    if (!canMove(rightDelegate, right, left, leftSlot)) continue;

    const next = cloneAssignments(current);
    next[a].delegateSeatIds = left.delegateSeatIds
      .filter((id) => id !== leftDelegate)
      .concat(rightDelegate);
    next[b].delegateSeatIds = right.delegateSeatIds
      .filter((id) => id !== rightDelegate)
      .concat(leftDelegate);
    current = next;
    applied += 1;
  }

  return current;
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

  const movesApplied = { split: 0, fill: 0, swap: 0, rescue: 0 };
  /**
   * ⛔ A BACKSTOP, NOT A BUDGET — and it was 12, which made it the operative rule.
   *
   * Each pass applies exactly ONE improving move and then restarts, so a cap of
   * 12 meant the optimizer performed at most twelve moves however many were
   * available. Measured at 65 delegates: 270 groups were legally splittable and
   * it split twelve of them, then stopped. FILL never ran once. SWAP never ran
   * once. Occupancy sat at 44% while the same people, re-spread, reach 70%.
   *
   *   maxPasses 12  → 12 moves,  44% occupancy, objective 34,687
   *   maxPasses 250 → 208 moves, 70% occupancy, objective 59,437
   *
   * The loop already stops on its own when no move improves, and it converges at
   * 208 moves here, so a high ceiling costs nothing — it exits early either way.
   *
   * ⚠️ This also invalidated every measurement taken before it was found: the
   * swap move looked worthless and restarts looked weak because every draw was
   * throttled identically, twelve moves in and done. Third time today a number
   * that read as a safety limit turned out to be the thing deciding the answer
   * (see DELEGATE_TARGET's impossible 24, and the 41.8 preference weight).
   */
  const maxPasses = context.maxPasses ?? 5000;
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

      /**
       * ⛔ RANK BY WHAT THE MOVE IS WORTH, then break ties on the seed.
       *
       * This sorted on `breakTie` ALONE and then sliced to meetingGroupMax —
       * so when more delegates were eligible than would fit, WHO got the seat
       * was decided by a hash and nothing else. The objective was consulted
       * only afterwards, to accept or reject the finished move, by which point
       * the choice of people had already been made blind.
       *
       * Two consequences, both measured:
       *   - a delegate who stated a top choice was seated no more often than
       *     anyone else. Four delegates, two seats, one asker: 5 of 8 seeds left
       *     the asker out. That is the base rate — the preference term was in
       *     the objective and unable to reach the decision.
       *   - match quality was ignored in exactly the same way, which is the
       *     larger version of the same bug: the one score source did not reach
       *     the fill decision either.
       *
       * The accept-check below is still the real objective; this only decides
       * who is CONSIDERED first, which is what the slice makes final. The org
       * term is included per delegate as an approximation — the true objective
       * counts it once per org in the room — so this is a ranking heuristic and
       * deliberately not a second scorer. `breakTie` stays as the tiebreaker,
       * because the score is coarse and ties are common.
       */
      const fillValue = (delegateSeatId: string): number => {
        const seat = context.delegateSeats.get(delegateSeatId);
        if (!seat) return 0;
        const obj = context.objective;
        const weight = obj.preferenceWeight ?? DEFAULT_PREFERENCE_WEIGHT;
        let value = obj.orgTotalFor(seat.orgId, exhibitor.orgId);
        if (obj.personTotalFor && seat.contactId) {
          value += obj.personTotalFor(seat.contactId, exhibitor.orgId);
        }
        // Both directions: an exhibitor asking for this store counts as much as
        // the store asking for them. Mutual therefore sorts above one-way.
        if (obj.orgPreferredFor?.(seat.orgId, exhibitor.orgId)) value += weight;
        if (obj.orgPreferredFor?.(exhibitor.orgId, seat.orgId)) value += weight;
        if (seat.contactId && obj.personPreferredFor?.(seat.contactId, exhibitor.orgId)) {
          value += weight;
        }
        return value;
      };

      /**
       * ⛔ NOBODY LEAVES WITH ZERO WHILE A SEAT IS FREE.
       *
       * Steve: "if that means one person ends up with 0 meetings I am going to
       * get skewered by the board no matter how mathematically elegant that is."
       * That is the floor, and it is not a tunable percentage — it is one, and
       * it is categorical. He could not name a number ABOVE one, and correctly
       * refused to guess; above one, the objective maximizes and that is fine.
       *
       * So this is a LEXICOGRAPHIC first key, not a weight added to the score: a
       * delegate with no meetings at all outranks every delegate who already has
       * one, however good the second pairing looks. Expressing it as a bonus
       * would make it tunable, and a big enough score difference would quietly
       * buy someone's entire conference.
       *
       * ⚠️ This gets us to non-zero WHERE THERE IS ROOM. It cannot rescue anyone
       * once every slot is full, because FILL only fills empty slots and there is
       * no move that displaces a seated delegate — see the missing relocate.
       * PERSON_COVERAGE still reports whoever is left at zero.
       */
      const hasNoMeetings = (delegateSeatId: string): boolean =>
        (metOrgs.get(delegateSeatId)?.size ?? 0) === 0;

      const eligible = [...context.delegateSeats.keys()]
        .filter((delegateSeatId) => {
          if (!context.mayMeet(delegateSeatId, exhibitorSeatId)) return false;
          if (metOrgs.get(delegateSeatId)?.has(exhibitor.orgId)) return false;
          if (busyAt.get(delegateSeatId)?.has(timeKey(emptySlot))) return false;
          return true;
        })
        .sort(
          (left, right) =>
            Number(hasNoMeetings(right)) - Number(hasNoMeetings(left)) ||
            fillValue(right) - fillValue(left) ||
            breakTie(context.seed, left, right)
        )
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

    if (improvedThisPass) continue;

    // ── SWAP ─────────────────────────────────────────────────────────────────
    /**
     * TRADE TWO DELEGATES BETWEEN TWO MEETINGS. The move that makes this a
     * search rather than a dice roll.
     *
     * ⛔ WITHOUT IT, RESTARTS ARE THEATRE. SPLIT redistributes one exhibitor's
     * own group across their own slots; FILL uses an empty slot. Neither can
     * change WHICH delegate sits with WHICH exhibitor once the grid is full — so
     * every reseed funnelled into the same assignment and more draws bought
     * nothing. Measured before this existed: at 12 suites and 100% occupancy the
     * objective was identical (29,240) at 1, 10, 50 and 200 restarts. Steve:
     * "instead of exploring an improvement we're just rolling the dice."
     *
     * ⚠️ The neighbourhood is enormous — every pair of meetings × every pair of
     * their delegates — so it is scanned in SEED ORDER and capped per pass.
     * That cap is not just a budget: it is what makes restarts meaningful again,
     * because a different seed examines a different slice of the neighbourhood
     * and therefore reaches a different local optimum.
     *
     * Legality is re-checked for BOTH delegates in their new rooms — a swap is
     * only a move if both halves are legal. Group sizes are preserved by
     * construction, so bounds cannot be violated.
     */
    const swapOrder = current
      .map((assignment, index) => ({ assignment, index }))
      .sort((left, right) =>
        breakTie(context.seed, left.assignment.meetingSlotId, right.assignment.meetingSlotId)
      );

    const maxSwapTrials = context.maxSwapTrials ?? 4000;
    let trials = 0;
    let swapped = false;

    outer: for (let a = 0; a < swapOrder.length && trials < maxSwapTrials; a += 1) {
      for (let b = a + 1; b < swapOrder.length && trials < maxSwapTrials; b += 1) {
        const left = swapOrder[a];
        const right = swapOrder[b];
        if (left.assignment.exhibitorSeatId === right.assignment.exhibitorSeatId) continue;

        const leftSlot = slotById.get(left.assignment.meetingSlotId);
        const rightSlot = slotById.get(right.assignment.meetingSlotId);
        if (!leftSlot || !rightSlot) continue;

        const { busyAt, metOrgs } = indexSchedule(current, slotById);

        for (const leftDelegate of left.assignment.delegateSeatIds) {
          for (const rightDelegate of right.assignment.delegateSeatIds) {
            trials += 1;
            if (trials > maxSwapTrials) break outer;
            if (leftDelegate === rightDelegate) continue;

            // Each must be allowed in the OTHER room, not already have met that
            // org, and be free at that minute once their own meeting is vacated.
            const legal = (
              mover: string,
              from: (typeof left)["assignment"],
              to: (typeof right)["assignment"],
              toSlot: MeetingSlotInput
            ): boolean => {
              if (!context.mayMeet(mover, to.exhibitorSeatId)) return false;
              const met = metOrgs.get(mover);
              if (met?.has(to.exhibitorOrganizationId)) return false;
              const fromSlot = slotById.get(from.meetingSlotId);
              const busy = busyAt.get(mover);
              if (!busy) return true;
              // Their own slot is being vacated, so it does not block them.
              return !busy.has(timeKey(toSlot)) || timeKey(toSlot) === timeKey(fromSlot!);
            };

            if (!legal(leftDelegate, left.assignment, right.assignment, rightSlot)) continue;
            if (!legal(rightDelegate, right.assignment, left.assignment, leftSlot)) continue;

            const next = cloneAssignments(current);
            next[left.index].delegateSeatIds = left.assignment.delegateSeatIds
              .filter((id) => id !== leftDelegate)
              .concat(rightDelegate);
            next[right.index].delegateSeatIds = right.assignment.delegateSeatIds
              .filter((id) => id !== rightDelegate)
              .concat(leftDelegate);

            const nextValue = measure(next).value;
            if (nextValue > currentValue) {
              current = next;
              currentValue = nextValue;
              movesApplied.swap += 1;
              swapped = true;
              break outer;
            }
          }
        }
      }
    }
    if (swapped) continue;

    if (!improvedThisPass) break;
  }

  /**
   * ── RESCUE ────────────────────────────────────────────────────────────────
   * NOBODY LEAVES WITH ZERO. Runs after the improvement loop, and is NOT an
   * improvement move.
   *
   * ⛔ IT DELIBERATELY LOWERS THE OBJECTIVE. FILL prefers uncovered delegates,
   * but that only helps while an empty slot exists; once every slot is full a
   * delegate the greedy skipped can never get in, because no other move
   * displaces a seated person. This is that move — and the swap it makes is
   * usually worse on score, which is exactly why it cannot live inside the
   * objective. Steve: "if that means one person ends up with 0 meetings I am
   * going to get skewered by the board no matter how mathematically elegant
   * that is." A floor is a constraint, not a term, for the same reason a
   * blackout is a filter and not a number.
   *
   * ⚠️ It only ever displaces someone who KEEPS at least one meeting, so it can
   * never create the problem it is fixing. Delegates are rescued in a
   * deterministic order and the richest seated delegate is the one bumped, so a
   * schedule stays reproducible.
   */
  const rescueUncovered = () => {
    for (let guard = 0; guard < context.delegateSeats.size; guard += 1) {
      const { busyAt, metOrgs } = indexSchedule(current, slotById);

      const uncovered = [...context.delegateSeats.keys()]
        .filter((id) => (metOrgs.get(id)?.size ?? 0) === 0)
        .sort((left, right) => breakTie(context.seed, left, right));
      if (uncovered.length === 0) return;

      let repaired = false;
      for (const delegateSeatId of uncovered) {
        for (let index = 0; index < current.length; index += 1) {
          const assignment = current[index];
          const slot = slotById.get(assignment.meetingSlotId);
          if (!slot) continue;
          if (!context.mayMeet(delegateSeatId, assignment.exhibitorSeatId)) continue;
          if (busyAt.get(delegateSeatId)?.has(timeKey(slot))) continue;
          if (metOrgs.get(delegateSeatId)?.has(assignment.exhibitorOrganizationId)) continue;

          // Room to simply join? Then this is not a displacement at all.
          if (assignment.delegateSeatIds.length < context.policy.meetingGroupMax) {
            const next = cloneAssignments(current);
            next[index].delegateSeatIds = [...assignment.delegateSeatIds, delegateSeatId];
            current = next;
            currentValue = measure(current).value;
            repaired = true;
            break;
          }

          // Otherwise bump whoever has the most meetings and would still have one.
          const bumpable = assignment.delegateSeatIds
            .filter((seated) => (metOrgs.get(seated)?.size ?? 0) > 1)
            .sort(
              (left, right) =>
                (metOrgs.get(right)?.size ?? 0) - (metOrgs.get(left)?.size ?? 0) ||
                breakTie(context.seed, left, right)
            );
          const bumped = bumpable[0];
          if (!bumped) continue;

          const next = cloneAssignments(current);
          next[index].delegateSeatIds = assignment.delegateSeatIds
            .filter((seated) => seated !== bumped)
            .concat(delegateSeatId);
          current = next;
          currentValue = measure(current).value;
          movesApplied.rescue += 1;
          repaired = true;
          break;
        }
        if (repaired) break;
      }
      // Nobody could be helped without breaking something — stop rather than spin.
      if (!repaired) return;
    }
  };

  rescueUncovered();

  return {
    assignments: current,
    before,
    after: measure(current),
    movesApplied,
    passes,
  };
}
