import type { MeetingSlotInput, ScheduleAssignment } from "./types";

/**
 * WHAT A GOOD SCHEDULE IS, stated once, as a number.
 *
 *     objective = Σ over exhibitors:  matchTotal(e) × timeOccupancy(e)
 *
 * The ED's framing: "maximize the match score multiplied by the percentage
 * occupancy for all the meetings."
 *
 * ⛔ OCCUPANCY IS TIME, NOT HEADCOUNT. A group of two occupies the room exactly
 * as much as a group of four — "the number of people in the booth isn't worth a
 * damn if the exhibitor has to spend 15 minutes staring at no one." Counting
 * seats instead of minutes inverts the whole result:
 *
 *   delegate time is the binding constraint (60 delegates × 23 slots = 1,380),
 *   so groups of 4 fill 345 of 713 suite-slots (48% occupancy) and groups of 2
 *   fill 690 (97%) — for the SAME 1,380 pairings. Every fourth chair is a
 *   delegate-slot spent on a meeting that was already happening.
 *
 * So group size is a consequence, not a setting. `meetingGroupMax` (4) is a
 * physical ceiling — an 8'×10' booth holds no more humans — not a target.
 *
 * Multiplying rather than adding is deliberate: an exhibitor with excellent
 * matches in a mostly-empty room scores badly, and so does a full room of poor
 * ones. It does mean the objective is NOT decomposable per meeting — a move
 * changes one exhibitor's occupancy and rescales all of their meetings — so
 * incremental evaluation has to be per exhibitor. See exhibitorTerm.
 *
 * ⛔ Pure, and legality is NOT part of it. No constraint checks, no blocklist, no
 * "excluded" term. Refusals are filtered before this is consulted — a score may
 * never be the reason two orgs meet, and never the reason they don't. Wanting an
 * exclusion flag in here is the direction Steve explicitly ruled out.
 *
 * The score itself comes from `match_edges` on the promoted run (`total` =
 * matchTotal = fit discounted by coverage), looked up per (member org, partner
 * org). A missing edge is 0, not unknown — the engine drops genuine zeros.
 */

/** (member org, partner org) → matchTotal. See lib/conference/meeting-match-scores.ts. */
export type PairScoreLookup = (memberOrgId: string, partnerOrgId: string) => number;

export type ObjectiveInput = {
  assignments: ScheduleAssignment[];
  meetingSlots: MeetingSlotInput[];
  /** Delegate seat → the member org they attend for. */
  orgByDelegateSeatId: ReadonlyMap<string, string>;
  /** Exhibitor seat → their partner org and the suite they sit in. */
  exhibitorSeats: ReadonlyMap<string, { orgId: string; suiteId: string }>;
  totalFor: PairScoreLookup;
};

export type ExhibitorTerm = {
  exhibitorSeatId: string;
  matchTotal: number;
  slotsUsed: number;
  slotsAvailable: number;
  occupancy: number;
  value: number;
};

/** One exhibitor's contribution. Exported so a search can rescore just what moved. */
export function exhibitorTerm(params: {
  exhibitorSeatId: string;
  exhibitorOrgId: string;
  assignments: ScheduleAssignment[];
  slotsAvailable: number;
  orgByDelegateSeatId: ReadonlyMap<string, string>;
  totalFor: PairScoreLookup;
}): ExhibitorTerm {
  const mine = params.assignments.filter(
    (a) => a.exhibitorSeatId === params.exhibitorSeatId
  );

  let matchTotal = 0;
  for (const assignment of mine) {
    for (const delegateSeatId of assignment.delegateSeatIds) {
      const memberOrgId = params.orgByDelegateSeatId.get(delegateSeatId);
      if (!memberOrgId) continue;
      matchTotal += params.totalFor(memberOrgId, params.exhibitorOrgId);
    }
  }

  // Distinct slots, not meetings: two rooms cannot help one exhibitor be in two
  // places, and a slot is occupied once however many people are in it.
  const slotsUsed = new Set(mine.map((a) => a.meetingSlotId)).size;
  const occupancy = params.slotsAvailable > 0 ? slotsUsed / params.slotsAvailable : 0;

  return {
    exhibitorSeatId: params.exhibitorSeatId,
    matchTotal,
    slotsUsed,
    slotsAvailable: params.slotsAvailable,
    occupancy,
    value: matchTotal * occupancy,
  };
}

export type ObjectiveResult = {
  value: number;
  byExhibitor: ExhibitorTerm[];
  /** Share of all suite-slots that have a meeting in them — the headline number. */
  overallOccupancy: number;
  totalMeetings: number;
  totalPairings: number;
};

export function scoreSchedule(input: ObjectiveInput): ObjectiveResult {
  const slotCountBySuite = new Map<string, number>();
  for (const slot of input.meetingSlots) {
    slotCountBySuite.set(slot.suiteId, (slotCountBySuite.get(slot.suiteId) ?? 0) + 1);
  }

  const byExhibitor: ExhibitorTerm[] = [];
  for (const [exhibitorSeatId, seat] of input.exhibitorSeats) {
    byExhibitor.push(
      exhibitorTerm({
        exhibitorSeatId,
        exhibitorOrgId: seat.orgId,
        assignments: input.assignments,
        slotsAvailable: slotCountBySuite.get(seat.suiteId) ?? 0,
        orgByDelegateSeatId: input.orgByDelegateSeatId,
        totalFor: input.totalFor,
      })
    );
  }

  const usedSlots = new Set(input.assignments.map((a) => a.meetingSlotId)).size;

  return {
    value: byExhibitor.reduce((sum, term) => sum + term.value, 0),
    byExhibitor,
    overallOccupancy: input.meetingSlots.length > 0 ? usedSlots / input.meetingSlots.length : 0,
    totalMeetings: input.assignments.length,
    totalPairings: input.assignments.reduce((sum, a) => sum + a.delegateSeatIds.length, 0),
  };
}
