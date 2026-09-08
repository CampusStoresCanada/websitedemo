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
 * ⛔ THAT TIEBREAK IS FOR TIES IN THE PRODUCT, NOT A DEMOTION OF THE SCORE.
 * "Occupancy first, score as tiebreaker" is a DIFFERENT and wrong objective: a
 * lexicographic order lets occupancy win every comparison and the score speak
 * only when two options are already exactly equal. That removes the trade this
 * product exists to express — a solver should give up some room-time for a much
 * better pairing, and take a worse pairing to fill a dead slot. I described it
 * that way in a handoff and Steve caught it. The score being coarse today is a
 * reason to sharpen the score, never to take it out of the objective.
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
 * DID THEY ASK FOR THIS? A stated top choice, at the grain it was stated at.
 *
 * ⛔ A SEPARATE TERM, NEVER FOLDED INTO matchTotal — and never into match_edges
 * upstream. `match_edges` is what the engine INFERS about a pair; a top choice
 * is what a person SAID. Merge them and nobody downstream can separate "we think
 * these two would get on" from "she asked for this by name" — including the
 * match session, when it later has to judge whether its own inference is any
 * good. It also makes the feedback loop undetectable: a stated preference
 * becomes indistinguishable from a score the recommender produced, so the next
 * run trains on its own output with no way to tell.
 *
 * ⛔ COUNTED AT ITS OWN GRAIN, exactly like the score terms above. An ORG pick
 * counts once per org in the room; a PERSON pick once per person. Blending them
 * is headcount inflation — a store sending four people who each picked vendor V
 * would produce four times the preference of a store sending one — the identical
 * bug already removed from matchTotal. They are also different assertions: an org
 * pick says "this store wants that company" (the commercial relationship, the
 * suite), a delegate pick says "this buyer wants that category". Averaging them
 * describes nobody.
 *
 * ⛔ SOFT. The ED: "not a guarantee, an expression of interest we should attempt
 * to accommodate." A member promised a meeting who does not get one is worse off
 * than one never promised, so this can be outweighed — a thumb on the scale,
 * never a reservation. Reserved slots are the mechanism if a pick must ever be
 * guaranteed, not a bigger weight.
 */
export type OrgPreferenceLookup = (declaringOrgId: string, chosenOrgId: string) => boolean;
export type PersonPreferenceLookup = (
  declaringContactId: string,
  chosenOrgId: string
) => boolean;

/**
 * What one satisfied top choice is worth — COMPUTED FROM THE RUN, never a constant.
 *
 *     W = p75(member_to_partner totals) − p50(same)
 *
 * "Honouring a stated pick is worth upgrading one pairing from median to
 * upper-quartile." That sentence stays true across a change of engine, model or
 * calibration, because it is defined in terms of the distribution rather than a
 * point on it.
 *
 * ⛔ THIS WAS 41.8 AND THAT WAS WRONG TWICE OVER — corrected by the match
 * session, who pulled one of the 387 edges carrying it:
 *
 *   Capilano University → Merangue: cohort 1, every other axis null.
 *   score 100.0 · confidence 0.03 · total 41.80
 *
 * One axis of nine fires, becomes 100% of the covered weight, and scores a
 * perfect fit. So 41.8 is not "a typical pairing" — it is the value of WE KNOW
 * NOTHING ABOUT THIS PAIR beyond a membership flag two-thirds of the roster
 * shares. Anchoring on it priced a stated human preference at the cost of a
 * coin-flip.
 *
 * ⛔ And the units are moving. In the engine replacing this one, `total` is a
 * PER-RUN PERCENTILE calibrated against that night's distribution — the median
 * sits near 50 by construction and 41.8 means something different every night. A
 * constant in score units silently re-scales when the distribution moves, with
 * no error. The match session lost 98% of its pairs to exactly that: a
 * hand-fitted band, then a recalibration, then silent clamping.
 *
 * ⚠️ Record the computed value on the run. A schedule from February is only
 * readable in June if you know what W was that night.
 */
export type TotalsDistribution = {
  count: number;
  distinct: number;
  p50: number;
  p75: number;
  /** p75 − p50, floored at 0. The preference weight for this run. */
  weight: number;
  /**
   * True when the scores carry almost no information — so few distinct values
   * that quartiles are not really quartiles.
   *
   * ⛔ A DIAGNOSTIC, NOT A CORRECTION. When this is true the right response is to
   * look at the engine, never to prop up the weight derived from it.
   */
  degenerate: boolean;
};

/**
 * The shape of a run's scores, and the weight that falls out of it.
 *
 * ⛔ NEVER ADD A FLOOR TO `weight`. If a run produces p75 = p50 the distribution
 * is degenerate — every pair scoring alike — and a preference weight is not the
 * problem to solve. A floor there would let stated picks silently drive the
 * entire schedule while the engine underneath was saying nothing at all, and the
 * schedule would look fine. W = 0 is the CORRECT failure: it makes a broken run
 * visible instead of papering over it. If you want a guard, assert on
 * `degenerate` — the distribution — never on the number derived from it.
 *
 * ⚠️ I argued for a floor on the belief that today's distribution was flat,
 * because 387 of 989 edges carry the identical 41.80. Measured, it is not:
 *
 *   old engine (promoted)      989 edges,    36 distinct, p50 24.46, p75 41.80 → W 17.34
 *   embedding space (newest) 1,700 edges, 1,700 distinct, p50 54.40, p75 77.79 → W 23.39
 *
 * 41.80 is modal but sits AT the 75th percentile, not the middle — those 387
 * edges are the top of a long thin tail, not its centre. Which is its own small
 * indictment of that engine: "we know nothing about this pair" is the upper
 * quartile of what it can say. Reasoning about a distribution is not measuring
 * one, and I did the former.
 */
/**
 * How far up the score distribution a stated pick is worth, as a percentile.
 *
 * ⛔ 0.90 — "honouring a pick is worth upgrading one pairing from median to TOP
 * DECILE" — chosen by Steve, 2026-09-08, on measurement rather than feel. At the
 * previous 0.75 an otherwise identical converged run honoured 475 requests; at
 * 0.90 it honoured 486, with no measurable cost: fit quality rose slightly
 * (74,107 → 74,841), occupancy 75% → 76%, group size unchanged.
 *
 * ⚠️ Most of the raw objective difference between the two runs was the
 * preference term simply counting for more — `preferenceShare` moved 10.2% →
 * 14.9% — NOT better scheduling. The eleven extra granted requests are the real
 * gain, and they are the number to quote.
 *
 * ⚠️ A DIAL WITH A MEANING, not a multiplier. Expressed as a percentile it
 * survives a recalibration of the underlying scores; `weight × 1.5` would not.
 */
export const DEFAULT_PREFERENCE_PERCENTILE = 0.9;

export function describeTotals(
  totals: readonly number[],
  /**
   * How far up the distribution a stated pick is worth, as a percentile.
   *
   * ⚠️ Defaults to DEFAULT_PREFERENCE_PERCENTILE (0.90). Pass 0.75 to get the
   * older, gentler "median to upper quartile" reading — useful for comparing
   * against runs recorded before the default changed.
   */
  upperPercentile = DEFAULT_PREFERENCE_PERCENTILE
): TotalsDistribution {
  const sorted = [...totals].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0, distinct: 0, p50: 0, p75: 0, weight: 0, degenerate: true };
  }
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const p50 = at(0.5);
  const p75 = at(upperPercentile);
  const distinct = new Set(sorted).size;
  return {
    count: sorted.length,
    distinct,
    p50,
    p75,
    weight: Math.max(0, p75 - p50),
    // Fewer than four distinct values cannot describe quartiles at all.
    degenerate: distinct < 4 || p75 === p50,
  };
}

/** The weight alone, for callers that do not need the rest of the shape. */
export function preferenceWeightFromTotals(totals: readonly number[]): number {
  return describeTotals(totals).weight;
}

/**
 * Fallback when there is no distribution to calibrate against — an empty run.
 *
 * ⛔ Zero, deliberately. A preference weight invented in the absence of any
 * scores would be a number nobody chose applied to a decision about real people.
 * Better that picks contribute nothing and the report says so.
 */
export const DEFAULT_PREFERENCE_WEIGHT = 0;

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
  /** Omit while nobody has stated a pick; contributes 0. */
  orgPreferredFor?: OrgPreferenceLookup;
  personPreferredFor?: PersonPreferenceLookup;
  /** From preferenceWeightFromTotals on the run being scheduled. */
  preferenceWeight?: number;
};

export type ExhibitorTerm = {
  exhibitorSeatId: string;
  matchTotal: number;
  slotsUsed: number;
  slotsAvailable: number;
  occupancy: number;
  /**
   * How many stated picks this exhibitor's meetings honoured, at grain.
   *
   * Reported separately so a schedule can say "they asked for this" in plain
   * words rather than as a pair that happened to score well — the whole reason
   * the preference is not folded into matchTotal.
   */
  satisfiedPreferences: number;
  /** Pairs where BOTH sides asked. Already counted as two in satisfiedPreferences. */
  mutualPreferences: number;
  /** What the picks contributed. Separable from `value` so the ratio is visible. */
  preferenceValue: number;
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
  orgPreferredFor?: OrgPreferenceLookup;
  personPreferredFor?: PersonPreferenceLookup;
  preferenceWeight?: number;
}): ExhibitorTerm {
  const mine = params.assignments.filter(
    (a) => a.exhibitorSeatId === params.exhibitorSeatId
  );

  let matchTotal = 0;
  let satisfiedPreferences = 0;
  let mutualPreferences = 0;
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
      // A PERSON's stated pick, honoured once for that person.
      if (
        params.personPreferredFor &&
        seat.contactId &&
        params.personPreferredFor(seat.contactId, params.exhibitorOrgId)
      ) {
        satisfiedPreferences += 1;
      }
    }
    // Org grain: once per ORG in the room, never once per body.
    for (const memberOrgId of orgsInTheRoom) {
      matchTotal += params.orgTotalFor(memberOrgId, params.exhibitorOrgId);

      /**
       * BOTH DIRECTIONS ARE STATEMENTS, and each is counted once.
       *
       * ⛔ Only the member's direction used to be read, so every partner's five
       * was collected and discarded. A meeting is an ask by whoever asked for
       * it, and an exhibitor asking for a store is exactly as much a stated
       * preference as the store asking for them.
       *
       * ⚠️ MUTUAL FALLS OUT OF COUNTING rather than being a bonus somebody
       * chose. Both sides asking is two statements, so it scores two — no
       * multiplier, no new constant. The match session is emphatic that a mutual
       * pick is far stronger evidence than a one-way one; this is the honest
       * arithmetic of that without inventing a weight for it.
       */
      const memberAsked =
        params.orgPreferredFor?.(memberOrgId, params.exhibitorOrgId) ?? false;
      const exhibitorAsked =
        params.orgPreferredFor?.(params.exhibitorOrgId, memberOrgId) ?? false;
      if (memberAsked) satisfiedPreferences += 1;
      if (exhibitorAsked) satisfiedPreferences += 1;
      if (memberAsked && exhibitorAsked) mutualPreferences += 1;
    }
  }

  // Distinct slots, not meetings: two rooms cannot help one exhibitor be in two
  // places, and a slot is occupied once however many people are in it.
  const slotsUsed = new Set(mine.map((a) => a.meetingSlotId)).size;
  const occupancy = params.slotsAvailable > 0 ? slotsUsed / params.slotsAvailable : 0;
  const preferenceValue =
    (params.preferenceWeight ?? DEFAULT_PREFERENCE_WEIGHT) * satisfiedPreferences;

  return {
    exhibitorSeatId: params.exhibitorSeatId,
    matchTotal,
    slotsUsed,
    slotsAvailable: params.slotsAvailable,
    occupancy,
    satisfiedPreferences,
    mutualPreferences,
    preferenceValue,
    /**
     * ⛔ The preference term is ADDED OUTSIDE the occupancy product, on purpose.
     *
     * Inside it, a pick honoured in a lightly-booked suite would be worth a
     * fraction of the same pick honoured in a full one — but a request granted
     * is granted, and its value has nothing to do with how busy that exhibitor's
     * afternoon was. Multiplying would also discount a poorly-booked exhibitor's
     * honoured picks toward zero, the opposite of accommodating them.
     *
     * ⚠️ THE COST OF THAT CHOICE: additive-and-outside means UNBOUNDED. The fit
     * term is a product whose second factor is at most 1, while an exhibitor
     * with ten honoured picks earns 10W. Push W high enough and the solver
     * chases picks and ignores the engine entirely — a failure that looks like a
     * working schedule. There is no cap here on purpose (a cap invented without
     * data is another unjustified number), so `preferenceValue` is reported
     * separately and MUST be checked against `value` on the first real draft.
     * Raised by the match session; the calibrated W above is what keeps it small
     * today, not any guard in this function.
     */
    value: matchTotal * occupancy + preferenceValue,
  };
}

export type ObjectiveResult = {
  value: number;
  byExhibitor: ExhibitorTerm[];
  /** Share of all suite-slots that have a meeting in them — the headline number. */
  overallOccupancy: number;
  totalMeetings: number;
  totalPairings: number;
  /** Stated picks this schedule honoured. Legible on its own, never inferred. */
  satisfiedPreferences: number;
  /** How many of those were BOTH sides asking — the strongest signal we hold. */
  mutualPreferences: number;
  /** What those picks were worth, and the weight used. Record both on the run. */
  preferenceValue: number;
  preferenceWeight: number;
  /**
   * Share of the objective coming from stated picks rather than fit, 0..1.
   *
   * ⚠️ THE NUMBER TO WATCH. Preference is additive and uncapped; if this climbs
   * toward 1 the solver has stopped optimizing for match quality and is only
   * granting requests. Nobody has seen it on real data — there are no picks yet.
   */
  preferenceShare: number;
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
        orgPreferredFor: input.orgPreferredFor,
        personPreferredFor: input.personPreferredFor,
        preferenceWeight: input.preferenceWeight,
      })
    );
  }

  const usedSlots = new Set(input.assignments.map((a) => a.meetingSlotId)).size;
  const totalValue = byExhibitor.reduce((sum, term) => sum + term.value, 0);
  const preferenceTotal = byExhibitor.reduce((sum, term) => sum + term.preferenceValue, 0);

  return {
    value: totalValue,
    byExhibitor,
    overallOccupancy: input.meetingSlots.length > 0 ? usedSlots / input.meetingSlots.length : 0,
    satisfiedPreferences: byExhibitor.reduce((sum, term) => sum + term.satisfiedPreferences, 0),
    mutualPreferences: byExhibitor.reduce((sum, term) => sum + term.mutualPreferences, 0),
    preferenceValue: preferenceTotal,
    preferenceWeight: input.preferenceWeight ?? DEFAULT_PREFERENCE_WEIGHT,
    preferenceShare: totalValue > 0 ? preferenceTotal / totalValue : 0,
    totalMeetings: input.assignments.length,
    totalPairings: input.assignments.reduce((sum, a) => sum + a.delegateSeatIds.length, 0),
  };
}
