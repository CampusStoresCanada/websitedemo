import { describe, expect, it } from "vitest";
import { runSchedulerSearch } from "../run-search";
import type { MeetingSlotInput, ScheduleAssignment } from "../types";

/**
 * The late-add SEAM, not the move.
 *
 * `lateAdd()` is covered next door. What was never exercised is
 * `runSchedulerSearch({ extendFrom })` — the branch that decides a run extends a
 * frozen schedule instead of searching for a new one. It is the join between the
 * solver and everything that persists or emails a result, and it had no test at
 * all: a scoped run could have silently fallen through to the full search and
 * nothing would have noticed until January.
 */

const SLOTS: MeetingSlotInput[] = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i + 1}`,
  dayNumber: 1,
  slotNumber: i + 1,
  suiteId: "suite-a",
}));

const EXHIBITOR_SEATS = new Map([["ex-1", { orgId: "partner-1", suiteId: "suite-a" }]]);

function inputs(delegateIds: string[], extendFrom?: ScheduleAssignment[]) {
  const delegateSeats = new Map(
    delegateIds.map((id) => [id, { orgId: `member-${id}`, contactId: null }])
  );
  return {
    delegates: delegateIds.map((id) => ({
      registrationId: id,
      organizationId: `member-${id}`,
      blackoutList: [] as string[],
    })),
    exhibitors: [
      { registrationId: "ex-1", organizationId: "partner-1", blackoutList: [] as string[] },
    ],
    meetingSlots: SLOTS,
    matchScores: [],
    policy: { meetingGroupMin: 2, meetingGroupMax: 4 },
    suitePinnedExhibitorBySuiteId: { "suite-a": "ex-1" },
    delegateSeats,
    exhibitorSeats: EXHIBITOR_SEATS,
    orgTotalFor: () => 10,
    personTotalFor: () => 0,
    orgPreferredFor: () => false,
    personPreferredFor: () => false,
    orgTotals: [10, 10, 10],
    seed: 7,
    restarts: 3,
    extendFrom,
  } as unknown as Parameters<typeof runSchedulerSearch>[0];
}

const frozen: ScheduleAssignment[] = [
  {
    meetingSlotId: "s1",
    exhibitorSeatId: "ex-1",
    exhibitorOrganizationId: "partner-1",
    delegateSeatIds: ["d1", "d2"],
    matchScoreKeys: [],
  },
];

const shape = (a: ScheduleAssignment[]) =>
  a.map((m) => `${m.meetingSlotId}|${[...m.delegateSeatIds].sort().join(",")}`).sort();

describe("runSchedulerSearch — the late-add scope", () => {
  it("reports lateAdd, which a full search never does", () => {
    const full = runSchedulerSearch(inputs(["d1", "d2", "d3"]));
    expect(full.lateAdd).toBeUndefined();

    const scoped = runSchedulerSearch(inputs(["d1", "d2", "late-1"], frozen));
    expect(scoped.lateAdd).toBeDefined();
  });

  it("keeps everyone who was already seated", () => {
    const out = runSchedulerSearch(inputs(["d1", "d2", "late-1"], frozen));
    // d1 and d2 still meet partner-1 at s1. Anything else is a broken promise.
    expect(shape(out.assignments)).toContain("s1|d1,d2,late-1");
  });

  it("seats the latecomer by JOIN, costing nobody else a meeting", () => {
    const out = runSchedulerSearch(inputs(["d1", "d2", "late-1"], frozen));
    expect(out.lateAdd?.newlySeated).toEqual(["late-1"]);
    expect(out.lateAdd?.alsoGained).toEqual([]);
    expect(out.lateAdd?.addedMeetings).toBe(0);
  });

  it("does not search — one draw, and it says so rather than looking flat", () => {
    const out = runSchedulerSearch(inputs(["d1", "d2", "late-1"], frozen));
    /**
     * ⛔ restarts: 3 was passed and deliberately ignored. A restart reseeds the
     * greedy and builds a fresh schedule, which is exactly what a late add must
     * never do. `restarts: 1` in the spread should read as "this did not
     * search", not as "the search found nothing".
     */
    expect(out.spread.restarts).toBe(1);
    expect(out.rescueMoves).toBe(0);
  });

  it("reports diagnostics for the schedule it is keeping", () => {
    const out = runSchedulerSearch(inputs(["d1", "d2", "late-1"], frozen));
    // Recomputed against the extended assignments, not the greedy draw that was
    // only run to obtain the delegate target.
    expect(out.diagnostics).toBeDefined();
    expect(out.objectiveValue).toBeGreaterThan(0);
  });
});
