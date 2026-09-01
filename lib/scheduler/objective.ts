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
 * ⛔ EACH FACT IS COUNTED AT THE GRAIN IT WAS ASSERTED AT.
 *
 *   meetingScore(m, e) = Σ over DISTINCT member orgs in m:  orgEdge(org, e)
 *                      + Σ over delegates in m:             personEdge(person, e) ?? 0
 *
 * The first version summed one blended score per delegate, which counted the org
 * edge once per body. Four people from one store contributed that store's org
 * fact four times — and because occupancy is time, adding the fourth body cost
 * nothing. The optimizer's best move became packing four people from the
 * highest-scoring store into every meeting: free score, no occupancy penalty,
 * and it inverts the small-group result it is supposed to produce. Caught by the
 * match-scoring session on review.
 *
 * So an org edge — a claim about an ORG PAIR — is counted once per org in the
 * room. A person edge is additive per person on top of it. The org prior is
 * never discarded, just never multiplied by headcount.
 *
 * ⚠️ THE SCORE IS A STEP FUNCTION, SO TIES WILL DOMINATE. Measured on the
 * promoted run, member_to_partner: 989 edges, only 36 DISTINCT VALUES, and 387
 * of them (39%) are the identical 41.80. Range 1.22–58.00.
 *
 * A search that ranks on this alone becomes arbitrary between runs on ~40% of
 * pairs, which reads as instability to anyone diffing two runs of the same
 * input. Any ordering built on the objective needs a deterministic secondary key
 * — `breakTie(seed, …)` in ./tiebreak.ts, which the greedy already uses.
 *
 * ⛔ Maximize `total`, never `score`. `score` is raw fit that ignores how much we
 * know: there are edges at score=100 with confidence=0.03 — one axis agreeing
 * loudly and nothing else known about the pair. `total` is fit already
 * discounted by coverage, and lands those at 41.80 rather than 100.
 *
 * ⚠️ Scales are not comparable across directions (partner_to_partner medians
 * more than double member_to_partner). Never sum or threshold across them. This
 * consumes member_to_partner only.
 *
 * ⚠️ "MISSING = 0" IS TRUE OF ORG EDGES AND NOT OF PERSON EDGES. On the promoted
 * run every pair was computed and every nonzero one stored (the top-50 cap never
 * bound), so a missing org edge means computed-and-scored-zero. A missing PERSON
 * edge means never computed at person grain — unknown, not zero. Same word,
 * different fact. Person absence therefore ADDS NOTHING rather than asserting
 * no-affinity, which is why these are two terms and not a fallback chain.
 */

/** (member org, partner org) → matchTotal. Missing = 0, and that is exact. */
export type OrgScoreLookup = (memberOrgId: string, partnerOrgId: string) => number;

/**
 * (member contact, partner org) → person-grain refinement, 0 when not computed.
 *
 * Deliberately buyer↔COMPANY, not buyer↔rep: CSC does not staff a partner's
 * suite, so which rep works the booth is not ours to optimize over.
 */
export type PersonScoreLookup = (memberContactId: string, partnerOrgId: string) => number;

export type DelegateSeatFacts = { orgId: string; contactId: string | null };

export type ObjectiveInput = {
  assignments: ScheduleAssignment[];
  meetingSlots: MeetingSlotInput[];
  /** Delegate seat → the member org they attend for, and who they are. */
  delegateSeats: ReadonlyMap<string, DelegateSeatFacts>;
  /** Exhibitor seat → their partner org and the suite they sit in. */
  exhibitorSeats: ReadonlyMap<string, { orgId: string; suiteId: string }>;
  orgTotalFor: OrgScoreLookup;
  /** Omit while person edges do not exist; it contributes 0. */
  personTotalFor?: PersonScoreLookup;
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
  delegateSeats: ReadonlyMap<string, DelegateSeatFacts>;
  orgTotalFor: OrgScoreLookup;
  personTotalFor?: PersonScoreLookup;
}): ExhibitorTerm {
  const mine = params.assignments.filter(
    (a) => a.exhibitorSeatId === params.exhibitorSeatId
  );

  let matchTotal = 0;
  for (const assignment of mine) {
    const orgsInTheRoom = new Set<string>();
    for (const delegateSeatId of assignment.delegateSeatIds) {
      const seat = params.delegateSeats.get(delegateSeatId);
      if (!seat) continue;
      orgsInTheRoom.add(seat.orgId);
      // Person grain: additive, and absent means "not computed", so it adds 0.
      if (params.personTotalFor && seat.contactId) {
        matchTotal += params.personTotalFor(seat.contactId, params.exhibitorOrgId);
      }
    }
    // Org grain: once per ORG in the room, never once per body.
    for (const memberOrgId of orgsInTheRoom) {
      matchTotal += params.orgTotalFor(memberOrgId, params.exhibitorOrgId);
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
        delegateSeats: input.delegateSeats,
        orgTotalFor: input.orgTotalFor,
        personTotalFor: input.personTotalFor,
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
