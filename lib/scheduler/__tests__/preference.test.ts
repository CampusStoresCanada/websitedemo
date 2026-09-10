import { describe, expect, it } from "vitest";
import {
  scoreSchedule,
  exhibitorTerm,
  preferenceWeightFromTotals,
  describeTotals,
  DEFAULT_PREFERENCE_WEIGHT,
} from "../objective";

/**
 * ⚠️ EVERY TEST BELOW PASSES AN EXPLICIT WEIGHT. The default is 0 — there is no
 * calibrated weight without a run to calibrate against — so a test that omitted
 * it would assert 0 === 0 and pass while proving nothing. Three of these were
 * briefly exactly that when the anchor changed from a constant to a computed
 * value, which is the whole argument for computing it.
 */
const W = 10;
import { optimizeSchedule, perturbSchedule } from "../optimize";
import type { MeetingSlotInput, ScheduleAssignment } from "../types";

/**
 * Top 5 as a SOFT CONSTRAINT on the solver.
 *
 * The ED: "not a guarantee, an expression of interest we should attempt to
 * accommodate." So these tests check two different things, and the second
 * matters more than the first: that a stated pick moves the solver, and that it
 * can still be outweighed.
 */

const SLOTS: MeetingSlotInput[] = Array.from({ length: 4 }, (_, i) => ({
  id: `s${i + 1}`,
  dayNumber: 1,
  slotNumber: i + 1,
  suiteId: "suite-a",
}));

const EXHIBITORS = new Map([["ex-1", { orgId: "partner-1", suiteId: "suite-a" }]]);

/** Four delegates, THREE of them from the same store — the headcount case. */
const DELEGATES = new Map([
  ["d1", { orgId: "member-1", contactId: "c1" }],
  ["d2", { orgId: "member-1", contactId: "c2" }],
  ["d3", { orgId: "member-1", contactId: "c3" }],
  ["d4", { orgId: "member-2", contactId: "c4" }],
]);

const oneMeeting = (delegateSeatIds: string[]): ScheduleAssignment[] => [
  {
    meetingSlotId: "s1",
    exhibitorSeatId: "ex-1",
    exhibitorOrganizationId: "partner-1",
    delegateSeatIds,
    matchScoreKeys: [],
  },
];

function term(params: {
  delegateSeatIds: string[];
  orgPreferredFor?: (m: string, p: string) => boolean;
  personPreferredFor?: (c: string, p: string) => boolean;
}) {
  return exhibitorTerm({
    exhibitorSeatId: "ex-1",
    exhibitorOrgId: "partner-1",
    assignments: oneMeeting(params.delegateSeatIds),
    slotsAvailable: 4,
    delegateSeats: DELEGATES,
    orgTotalFor: () => 0,
    orgPreferredFor: params.orgPreferredFor,
    personPreferredFor: params.personPreferredFor,
    preferenceWeight: W,
  });
}

describe("stated preferences enter at the grain they were stated at", () => {
  it("counts an ORG's pick ONCE however many of its people are in the room", () => {
    /**
     * ⛔ The headcount-inflation trap, arriving by a second door. An org pick is
     * a claim about a STORE. Counting it per body would make a store that sent
     * three buyers three times as enthusiastic as one that sent one — which is
     * the identical bug already removed from matchTotal, and the reason these
     * are two lookups rather than one merged "did anyone here want them".
     */
    // Directional: the STORE asked for the partner, not the reverse.
    const orgPicked = (declaring: string, chosen: string) =>
      declaring === "member-1" && chosen === "partner-1";
    const one = term({ delegateSeatIds: ["d1"], orgPreferredFor: orgPicked });
    const three = term({ delegateSeatIds: ["d1", "d2", "d3"], orgPreferredFor: orgPicked });

    expect(one.satisfiedPreferences).toBe(1);
    expect(three.satisfiedPreferences).toBe(1);
  });

  it("counts each PERSON's pick separately — they are different assertions", () => {
    // Ana wants RAINS; her colleague in course materials does not. Two buyers
    // from one store asking for the same vendor is two people asking.
    const personPicked = (contactId: string) => contactId === "c1" || contactId === "c2";
    const both = term({ delegateSeatIds: ["d1", "d2", "d3"], personPreferredFor: personPicked });
    expect(both.satisfiedPreferences).toBe(2);
  });

  it("adds org and person picks rather than collapsing them", () => {
    // A store asking AND one of its buyers asking are two facts, not one
    // restated. Neither absorbs the other.
    const t = term({
      delegateSeatIds: ["d1"],
      orgPreferredFor: (declaring: string, chosen: string) =>
        declaring === "member-1" && chosen === "partner-1",
      personPreferredFor: () => true,
    });
    expect(t.satisfiedPreferences).toBe(2);
  });

  it("is worth nothing when nobody asked", () => {
    expect(term({ delegateSeatIds: ["d1", "d2"] }).satisfiedPreferences).toBe(0);
  });
});

describe("the preference term sits outside the occupancy product", () => {
  it("is worth the same in a quiet suite as a busy one", () => {
    /**
     * A request granted is granted. Multiplying it by occupancy would discount a
     * poorly-booked exhibitor's honoured picks toward zero — the opposite of
     * accommodating them.
     */
    const quiet = exhibitorTerm({
      exhibitorSeatId: "ex-1",
      exhibitorOrgId: "partner-1",
      assignments: oneMeeting(["d1"]),
      slotsAvailable: 40,
      delegateSeats: DELEGATES,
      orgTotalFor: () => 0,
      orgPreferredFor: (declaring: string) => declaring === "member-1",
      preferenceWeight: W,
    });
    const busy = exhibitorTerm({
      exhibitorSeatId: "ex-1",
      exhibitorOrgId: "partner-1",
      assignments: oneMeeting(["d1"]),
      slotsAvailable: 1,
      delegateSeats: DELEGATES,
      orgTotalFor: () => 0,
      orgPreferredFor: (declaring: string) => declaring === "member-1",
      preferenceWeight: W,
    });
    expect(quiet.value).toBe(W);
    expect(busy.value).toBe(W);
  });

  it("reports satisfied picks on their own, not buried in the score", () => {
    /**
     * The match session's ask: "if a schedule satisfies a stated pick, that
     * should be legible in the output as 'they asked for this', not as a pair
     * that scored well." So it is a count, reported beside the value.
     */
    const result = scoreSchedule({
      assignments: oneMeeting(["d1", "d4"]),
      meetingSlots: SLOTS,
      delegateSeats: DELEGATES,
      exhibitorSeats: EXHIBITORS,
      orgTotalFor: () => 5,
      orgPreferredFor: (memberOrgId) => memberOrgId === "member-2",
      preferenceWeight: W,
    });
    expect(result.satisfiedPreferences).toBe(1);
    expect(result.byExhibitor[0].matchTotal).toBe(10); // untouched by the pick
  });
});

describe("the solver actually maximizes for it", () => {
  it.each([1,2,3,7,42,99,123,777])("prefers the delegate who asked (seed %i)", (SEED) => {
    /**
     * THE POINT OF THE WIRE. Two candidates the engine cannot separate — both
     * score identically — and one of them asked for this exhibitor by name.
     * Without the term the choice is arbitrary; with it the stated pick wins.
     */
    const context = {
      meetingSlots: SLOTS,
      policy: { meetingGroupMin: 1, meetingGroupMax: 1 },
      exhibitorSeats: EXHIBITORS,
      delegateSeats: DELEGATES,
      mayMeet: () => true,
      objective: {
        delegateSeats: DELEGATES,
        exhibitorSeats: EXHIBITORS,
        orgTotalFor: () => 10,
        personPreferredFor: (contactId: string) => contactId === "c4",
        preferenceWeight: W,
      },
      seed: SEED,
    } as Parameters<typeof optimizeSchedule>[1];

    const result = optimizeSchedule([], context);
    const seated = result.assignments.flatMap((a) => a.delegateSeatIds);
    expect(seated).toContain("d4");
    expect(result.after.satisfiedPreferences).toBeGreaterThan(0);
  });

  it("stays SOFT — a much better pairing still outweighs a stated pick", () => {
    /**
     * ⛔ The guard that keeps this an expression of interest rather than a
     * reservation. A member promised a meeting who does not get one is worse off
     * than one who was never promised, so the weight must lose to a big enough
     * score difference. If this test ever fails, the dial has been turned into a
     * lock and the ED's framing has been quietly overridden.
     */
    const asked = scoreSchedule({
      assignments: oneMeeting(["d1"]),
      meetingSlots: SLOTS,
      delegateSeats: DELEGATES,
      exhibitorSeats: EXHIBITORS,
      orgTotalFor: () => 0,
      personPreferredFor: (contactId: string) => contactId === "c1",
      preferenceWeight: W,
    });
    const muchBetterMatch = scoreSchedule({
      assignments: oneMeeting(["d4"]),
      meetingSlots: SLOTS,
      delegateSeats: DELEGATES,
      exhibitorSeats: EXHIBITORS,
      orgTotalFor: () => 58 * 20,
      preferenceWeight: W,
    });
    expect(muchBetterMatch.value).toBeGreaterThan(asked.value);
    expect(asked.satisfiedPreferences).toBe(1);
    expect(muchBetterMatch.satisfiedPreferences).toBe(0);
  });
});

describe("the weight is computed from the run, never chosen", () => {
  it("defaults to the median-to-TOP-DECILE gap of that run's own totals", () => {
    /**
     * "Honouring a stated pick is worth upgrading one pairing from median to top
     * decile" — a sentence that stays true across a change of engine, model or
     * calibration, because it names the distribution rather than a point on it.
     *
     * ⚠️ Default moved from 0.75 to 0.90 on 2026-09-08, on measurement: an
     * otherwise identical converged run honoured 486 requests instead of 475,
     * with fit quality and occupancy both slightly UP rather than traded away.
     */
    const totals = [10, 20, 30, 40, 50, 60, 70, 80];
    expect(preferenceWeightFromTotals(totals)).toBe(80 - 50);
  });

  it("still supports the older, gentler upper-quartile reading", () => {
    // Kept so a run recorded before the default changed can be reproduced.
    const totals = [10, 20, 30, 40, 50, 60, 70, 80];
    expect(describeTotals(totals, 0.75).weight).toBe(70 - 50);
  });

  it("is ZERO on a degenerate distribution, and says so", () => {
    /**
     * ⛔ AND THERE IS NO FLOOR, PERMANENTLY. Every pair scoring alike means the
     * engine is saying nothing; a preference weight is not the problem to solve.
     * A floor here would let stated picks drive the entire schedule while the
     * scores underneath were silent — and the schedule would look fine. W = 0 is
     * the correct failure because it is a VISIBLE one, and `degenerate` is the
     * thing to assert on rather than the weight derived from it.
     */
    const flat = describeTotals([41.8, 41.8, 41.8, 41.8]);
    expect(flat.weight).toBe(0);
    expect(flat.degenerate).toBe(true);
  });

  it("is NOT zero on either real engine — measured, not reasoned about", () => {
    /**
     * ⚠️ I argued for a floor believing today's distribution was flat, because
     * 387 of 989 edges carry the identical 41.80. The match session measured it:
     * 41.80 is modal but sits AT p75, not the middle — those edges are the top of
     * a long thin tail. Old engine W = 17.34; the embedding space, where all
     * 1,700 edges are distinct, W = 23.39. Frequency is not centrality.
     */
    const longThinTail = [
      ...Array.from({ length: 12 }, (_, i) => 1 + i * 2),
      ...Array.from({ length: 8 }, () => 41.8),
    ];
    const shape = describeTotals(longThinTail);
    expect(shape.degenerate).toBe(false);
    expect(shape.weight).toBeGreaterThan(0);
    expect(shape.p75).toBe(41.8);
  });

  it("is ZERO with no run to calibrate against", () => {
    // ⛔ Never a fallback constant. A weight invented in the absence of any
    // scores would be a number nobody chose, applied to real people's meetings.
    expect(preferenceWeightFromTotals([])).toBe(0);
    expect(DEFAULT_PREFERENCE_WEIGHT).toBe(0);
  });

  it("never goes negative", () => {
    expect(preferenceWeightFromTotals([5])).toBe(0);
  });
});

describe("a stated pick must survive SCARCITY, not just influence a tie", () => {
  /**
   * ⛔ THE TEST THAT CAUGHT THE WIRE BEING DECORATIVE.
   *
   * Everything above passes even when the preference term cannot reach the
   * decision, because those cases can seat everybody — the asker gets in for
   * free. The question that discriminates is who gets a seat when there are not
   * enough: FILL used to sort candidates by `breakTie` alone and slice to
   * meetingGroupMax, so the objective only ever saw a finished move. Measured
   * before the fix: 5 of 8 seeds left the asker out, which is the base rate.
   *
   * Found on the first real draft run — one test delegate stated the only
   * person-grain pick in the harness and got zero meetings while her two
   * colleagues each met all four exhibitors.
   */
  const ONE_SLOT: MeetingSlotInput[] = [
    { id: "only", dayNumber: 1, slotNumber: 1, suiteId: "suite-a" },
  ];
  const FOUR = new Map([
    ["d1", { orgId: "m1", contactId: "c1" }],
    ["d2", { orgId: "m2", contactId: "c2" }],
    ["d3", { orgId: "m3", contactId: "c3" }],
    ["d4", { orgId: "m4", contactId: "c4" }],
  ]);

  it.each([1, 2, 3, 7, 42, 99, 123, 777])(
    "seats the delegate who asked when only two of four fit (seed %i)",
    (seed) => {
      const result = optimizeSchedule([], {
        meetingSlots: ONE_SLOT,
        policy: { meetingGroupMin: 1, meetingGroupMax: 2 },
        exhibitorSeats: EXHIBITORS,
        delegateSeats: FOUR,
        mayMeet: () => true,
        objective: {
          delegateSeats: FOUR,
          exhibitorSeats: EXHIBITORS,
          orgTotalFor: () => 10,
          personPreferredFor: (contactId: string) => contactId === "c4",
          preferenceWeight: 50,
        },
        seed,
      } as Parameters<typeof optimizeSchedule>[1]);
      expect(result.assignments.flatMap((a) => a.delegateSeatIds)).toContain("d4");
    }
  );

  it("also ranks on MATCH SCORE, which was blind in the same way", () => {
    // The larger half of the same bug: fill ignored the one score source too,
    // so who filled a slot had nothing to do with match quality.
    const result = optimizeSchedule([], {
      meetingSlots: ONE_SLOT,
      policy: { meetingGroupMin: 1, meetingGroupMax: 1 },
      exhibitorSeats: EXHIBITORS,
      delegateSeats: FOUR,
      mayMeet: () => true,
      objective: {
        delegateSeats: FOUR,
        exhibitorSeats: EXHIBITORS,
        orgTotalFor: (memberOrgId: string) => (memberOrgId === "m3" ? 100 : 1),
      },
      seed: 5,
    } as Parameters<typeof optimizeSchedule>[1]);
    expect(result.assignments.flatMap((a) => a.delegateSeatIds)).toEqual(["d3"]);
  });
});

describe("both sides can ask, and mutual is simply two asks", () => {
  /**
   * ⛔ A PARTNER'S FIVE USED TO BE DISCARDED. The lookup was keyed
   * (memberOrgId, partnerOrgId), so only a member's direction could ever match —
   * partners filled in the same picker, on the same page, and the solver never
   * read a word of it. Steve: an exhibitor's pick weighs the same as a member's.
   *
   * ⚠️ Mutual needs NO multiplier. Both sides asking is two statements and
   * scores two, which is why the strongest signal in the table costs no new
   * constant to express.
   */
  const askOnly = (declaringOrgId: string) => (d: string, _c: string) => d === declaringOrgId;

  it("counts a partner's pick that no member reciprocated", () => {
    const t = term({ delegateSeatIds: ["d1"], orgPreferredFor: askOnly("partner-1") });
    expect(t.satisfiedPreferences).toBe(1);
    expect(t.mutualPreferences).toBe(0);
  });

  it("counts a member's pick that no partner reciprocated", () => {
    const t = term({ delegateSeatIds: ["d1"], orgPreferredFor: askOnly("member-1") });
    expect(t.satisfiedPreferences).toBe(1);
    expect(t.mutualPreferences).toBe(0);
  });

  it("scores a mutual pick as two, and reports it as mutual", () => {
    const t = term({
      delegateSeatIds: ["d1"],
      orgPreferredFor: (d: string, c: string) =>
        (d === "member-1" && c === "partner-1") || (d === "partner-1" && c === "member-1"),
    });
    expect(t.satisfiedPreferences).toBe(2);
    expect(t.mutualPreferences).toBe(1);
  });

  it("still counts an org pick once however many of its people are in the room", () => {
    // The headcount rule holds in both directions.
    const both = (d: string, c: string) =>
      (d === "member-1" && c === "partner-1") || (d === "partner-1" && c === "member-1");
    const one = term({ delegateSeatIds: ["d1"], orgPreferredFor: both });
    const three = term({ delegateSeatIds: ["d1", "d2", "d3"], orgPreferredFor: both });
    expect(one.satisfiedPreferences).toBe(2);
    expect(three.satisfiedPreferences).toBe(2);
  });
});

describe("nobody leaves with zero while a seat is free", () => {
  /**
   * Steve: "if that means one person ends up with 0 meetings I am going to get
   * skewered by the board no matter how mathematically elegant that is."
   *
   * ⛔ LEXICOGRAPHIC, not a weight. A delegate at zero outranks every delegate
   * who already has one, however good the alternative pairing scores. As a bonus
   * it would be tunable, and a large enough score gap would buy someone's whole
   * conference.
   */
  it("seats the uncovered delegate ahead of a much better-matched one", () => {
    /**
     * ⚠️ THE SHAPE MATTERS AND MY FIRST VERSION OF THIS TEST WAS VACUOUS. Two
     * exhibitors sharing one suite cannot both seat the same delegate — the
     * busy-at-that-minute check and "never meet the same org twice" already
     * force the second seat to somebody else, so the test passed with the floor
     * deleted. It only discriminates when the star COULD legitimately take both:
     * two exhibitors, two DIFFERENT suites, two DIFFERENT times.
     */
    const TWO_SLOTS: MeetingSlotInput[] = [
      { id: "s1", dayNumber: 1, slotNumber: 1, suiteId: "suite-a" },
      { id: "s2", dayNumber: 1, slotNumber: 2, suiteId: "suite-b" },
    ];
    const TWO_EX = new Map([
      ["ex-1", { orgId: "partner-1", suiteId: "suite-a" }],
      ["ex-2", { orgId: "partner-2", suiteId: "suite-b" }],
    ]);
    const PAIR = new Map([
      ["star", { orgId: "m-star", contactId: "c-star" }],
      ["nobody", { orgId: "m-nobody", contactId: "c-nobody" }],
    ]);

    const result = optimizeSchedule([], {
      meetingSlots: TWO_SLOTS,
      policy: { meetingGroupMin: 1, meetingGroupMax: 1 },
      exhibitorSeats: TWO_EX,
      delegateSeats: PAIR,
      mayMeet: () => true,
      // The star scores 1000× better with everyone, is free at both times and
      // has met neither org — so without the floor it takes both seats and
      // "nobody" flies home having met no one.
      objective: {
        delegateSeats: PAIR,
        exhibitorSeats: TWO_EX,
        orgTotalFor: (memberOrgId: string) => (memberOrgId === "m-star" ? 1000 : 1),
      },
      seed: 3,
    } as Parameters<typeof optimizeSchedule>[1]);

    expect(result.assignments.flatMap((a) => a.delegateSeatIds)).toContain("nobody");
  });
});

describe("rescue: nobody leaves with zero even when every seat is taken", () => {
  /**
   * ⛔ THE CASE THE FILL FLOOR CANNOT FIX. Preferring uncovered delegates only
   * helps while an empty slot exists. Here every slot is full, so the only way
   * to seat the forgotten delegate is to DISPLACE someone — the move the search
   * did not have, and the reason Buyer 2 sat at zero on the first real draft.
   *
   * ⚠️ It lowers the objective on purpose. That is why it is a repair pass and
   * not a term: a floor is a constraint, like a blackout, not a number to trade.
   */
  const TWO_SLOTS: MeetingSlotInput[] = [
    { id: "s1", dayNumber: 1, slotNumber: 1, suiteId: "suite-a" },
    { id: "s2", dayNumber: 1, slotNumber: 2, suiteId: "suite-b" },
  ];
  const TWO_EX = new Map([
    ["ex-1", { orgId: "partner-1", suiteId: "suite-a" }],
    ["ex-2", { orgId: "partner-2", suiteId: "suite-b" }],
  ]);
  const PAIR = new Map([
    ["rich", { orgId: "m-rich", contactId: "c-rich" }],
    ["forgotten", { orgId: "m-forgotten", contactId: "c-forgotten" }],
  ]);

  /** Both rooms full, one delegate holding both — the other holding nothing. */
  const hoarded = [
    {
      meetingSlotId: "s1",
      exhibitorSeatId: "ex-1",
      exhibitorOrganizationId: "partner-1",
      delegateSeatIds: ["rich"],
      matchScoreKeys: [],
    },
    {
      meetingSlotId: "s2",
      exhibitorSeatId: "ex-2",
      exhibitorOrganizationId: "partner-2",
      delegateSeatIds: ["rich"],
      matchScoreKeys: [],
    },
  ];

  function run(seed: number) {
    return optimizeSchedule(hoarded, {
      meetingSlots: TWO_SLOTS,
      policy: { meetingGroupMin: 1, meetingGroupMax: 1 }, // full: no room to join
      exhibitorSeats: TWO_EX,
      delegateSeats: PAIR,
      mayMeet: () => true,
      objective: {
        delegateSeats: PAIR,
        exhibitorSeats: TWO_EX,
        // The hoarder scores far better, so every improvement move keeps them.
        orgTotalFor: (memberOrgId: string) => (memberOrgId === "m-rich" ? 1000 : 1),
      },
      seed,
    } as Parameters<typeof optimizeSchedule>[1]);
  }

  it.each([1, 2, 42, 777])("seats the forgotten delegate (seed %i)", (seed) => {
    const result = run(seed);
    expect(result.assignments.flatMap((a) => a.delegateSeatIds)).toContain("forgotten");
  });

  it("leaves the displaced delegate with a meeting, never zero", () => {
    const seated = run(42).assignments.flatMap((a) => a.delegateSeatIds);
    expect(seated).toContain("rich");
    expect(seated).toContain("forgotten");
  });

  it("records the repair separately from the improvements", () => {
    // A non-zero rescue count means the objective's best answer left somebody
    // with nothing and we took score back off the table to fix it. That should
    // be visible, not folded into the optimisation numbers.
    expect(run(42).movesApplied.rescue).toBeGreaterThan(0);
  });

  it("declines when nobody can be bumped without creating a new zero", () => {
    /**
     * Three delegates, one room, two seats: somebody must miss out and the pass
     * must NOT shuffle the problem onto a different person.
     */
    const ONE_SLOT: MeetingSlotInput[] = [
      { id: "only", dayNumber: 1, slotNumber: 1, suiteId: "suite-a" },
    ];
    const ONE_EX = new Map([["ex-1", { orgId: "partner-1", suiteId: "suite-a" }]]);
    const THREE = new Map([
      ["a", { orgId: "m-a", contactId: "c-a" }],
      ["b", { orgId: "m-b", contactId: "c-b" }],
      ["c", { orgId: "m-c", contactId: "c-c" }],
    ]);
    const result = optimizeSchedule(
      [
        {
          meetingSlotId: "only",
          exhibitorSeatId: "ex-1",
          exhibitorOrganizationId: "partner-1",
          delegateSeatIds: ["a", "b"],
          matchScoreKeys: [],
        },
      ],
      {
        meetingSlots: ONE_SLOT,
        policy: { meetingGroupMin: 1, meetingGroupMax: 2 },
        exhibitorSeats: ONE_EX,
        delegateSeats: THREE,
        mayMeet: () => true,
        objective: { delegateSeats: THREE, exhibitorSeats: ONE_EX, orgTotalFor: () => 10 },
        seed: 9,
      } as Parameters<typeof optimizeSchedule>[1]
    );
    // Still exactly two seated — the third is unreachable, and that is honest.
    expect(result.assignments.flatMap((a) => a.delegateSeatIds)).toHaveLength(2);
    expect(result.movesApplied.rescue).toBe(0);
  });
});

describe("perturbSchedule", () => {
  /**
   * ⛔ IT MOVES WITHOUT IMPROVING — that is the whole job. Hill climbing cannot
   * leave the hill it started on, and restarts leave it by throwing the answer
   * away. This leaves it by pushing.
   */
  const SLOTS: MeetingSlotInput[] = [
    { id: "a1", dayNumber: 1, slotNumber: 1, suiteId: "A" },
    { id: "b1", dayNumber: 1, slotNumber: 2, suiteId: "B" },
  ];
  const EX = new Map([
    ["exA", { orgId: "pA", suiteId: "A" }],
    ["exB", { orgId: "pB", suiteId: "B" }],
  ]);
  const DELS = new Map([
    ["d1", { orgId: "m1", contactId: null }],
    ["d2", { orgId: "m2", contactId: null }],
  ]);
  const base = [
    { meetingSlotId: "a1", exhibitorSeatId: "exA", exhibitorOrganizationId: "pA",
      delegateSeatIds: ["d1"], matchScoreKeys: [] },
    { meetingSlotId: "b1", exhibitorSeatId: "exB", exhibitorOrganizationId: "pB",
      delegateSeatIds: ["d2"], matchScoreKeys: [] },
  ];
  const ctx = {
    meetingSlots: SLOTS, policy: { meetingGroupMin: 1, meetingGroupMax: 2 },
    exhibitorSeats: EX, delegateSeats: DELS, mayMeet: () => true,
    objective: { delegateSeats: DELS, exhibitorSeats: EX, orgTotalFor: () => 10 },
    seed: 1,
  } as Parameters<typeof optimizeSchedule>[1];

  it("keeps group sizes, so bounds cannot break", () => {
    const out = perturbSchedule(base, ctx, 7, 3);
    expect(out.map((a) => a.delegateSeatIds.length)).toEqual([1, 1]);
  });

  it("never seats anyone the blackout filter forbids", () => {
    const blocked = { ...ctx, mayMeet: () => false } as Parameters<typeof optimizeSchedule>[1];
    const out = perturbSchedule(base, blocked, 7, 5);
    // No legal move exists, so it must return the schedule untouched.
    expect(out).toEqual(base);
  });

  it("is deterministic for a given seed", () => {
    expect(perturbSchedule(base, ctx, 42, 3)).toEqual(perturbSchedule(base, ctx, 42, 3));
  });
});
