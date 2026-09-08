import { describe, expect, it } from "vitest";
import { lateAdd } from "../late-add";
import { optimizeSchedule } from "../optimize";
import type { MeetingSlotInput, ScheduleAssignment } from "../types";

/**
 * Post-freeze behaviour. The property under test is not "produces a good
 * schedule" — it is "does not move anybody", which is a different and stricter
 * thing that the objective cannot express.
 */

const SLOTS: MeetingSlotInput[] = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i + 1}`,
  dayNumber: 1,
  slotNumber: i + 1,
  suiteId: "suite-a",
}));

const EXHIBITORS = new Map([["ex-1", { orgId: "partner-1", suiteId: "suite-a" }]]);

function delegates(ids: string[]) {
  return new Map(ids.map((id) => [id, { orgId: `member-${id}`, contactId: null }]));
}

function context(delegateSeats: ReturnType<typeof delegates>, overrides = {}) {
  return {
    meetingSlots: SLOTS,
    policy: { meetingGroupMin: 2, meetingGroupMax: 4 },
    exhibitorSeats: EXHIBITORS,
    delegateSeats,
    mayMeet: () => true,
    objective: {
      delegateSeats,
      exhibitorSeats: EXHIBITORS,
      orgTotalFor: () => 10,
    },
    seed: 42,
    ...overrides,
  } as Parameters<typeof optimizeSchedule>[1];
}

/** Four delegates crammed into one slot — the shape SPLIT exists to break up. */
const crammed: ScheduleAssignment[] = [
  {
    meetingSlotId: "s1",
    exhibitorSeatId: "ex-1",
    exhibitorOrganizationId: "partner-1",
    delegateSeatIds: ["d1", "d2", "d3", "d4"],
    matchScoreKeys: [],
  },
];

const snapshot = (a: ScheduleAssignment[]) =>
  a
    .map((m) => `${m.meetingSlotId}|${m.exhibitorSeatId}|${[...m.delegateSeatIds].sort().join(",")}`)
    .sort();

describe("late add after the freeze", () => {
  it("leaves every frozen meeting exactly as it was", () => {
    const seats = delegates(["d1", "d2", "d3", "d4", "late-1", "late-2"]);
    const before = snapshot(crammed);

    const out = lateAdd(crammed, context(seats));

    // Every original meeting survives with the same people in it.
    for (const original of before) {
      expect(snapshot(out.assignments)).toContain(original);
    }
  });

  it("does what the full optimizer would NOT do — proving the gate is live", () => {
    const seats = delegates(["d1", "d2", "d3", "d4", "late-1", "late-2"]);

    // The full search rearranges this schedule: that is its job.
    const full = optimizeSchedule(crammed, context(seats));
    const movedSomebody =
      snapshot(full.assignments).find((m) => m.startsWith("s1|")) !==
      snapshot(crammed)[0];
    expect(full.movesApplied.split + full.movesApplied.swap).toBeGreaterThan(0);
    expect(movedSomebody).toBe(true);

    // The late add, given the identical input, does not.
    const late = lateAdd(crammed, context(seats));
    expect(snapshot(late.assignments)).toContain(snapshot(crammed)[0]);
  });

  it("seats latecomers in spare room and names who else gained a meeting", () => {
    const seats = delegates(["d1", "d2", "d3", "d4", "late-1", "late-2"]);
    const out = lateAdd(crammed, context(seats));

    // Two latecomers can fill an empty slot together — group minimum is 2.
    expect(out.newlySeated).toEqual(["late-1", "late-2"]);
    expect(out.added.length).toBeGreaterThan(0);
    // Nobody already seated was disturbed, so nothing was taken from anyone.
    expect(out.stillWithoutMeetings).toEqual([]);
  });

  it("reports honestly when there is genuinely no room", () => {
    // One slot, and the meeting in it is already at meetingGroupMax. JOIN has
    // nothing under-full to join and FILL has no empty slot to open.
    const oneSlot = [SLOTS[0]];
    const seats = delegates(["d1", "d2", "d3", "d4", "late-1"]);

    const out = lateAdd(crammed, context(seats, { meetingSlots: oneSlot }));

    expect(out.added).toEqual([]);
    expect(out.newlySeated).toEqual([]);
    expect(out.stillWithoutMeetings).toEqual(["late-1"]);
    // And critically: the existing meeting is untouched.
    expect(snapshot(out.assignments)).toEqual(snapshot(crammed));
  });

  it("seats a LONE latecomer by joining a room, costing nobody anything", () => {
    // The case Steve described: "they become a three". d1 and d2 already meet
    // partner-1 at s1. late-1 arrives alone — too few for a new meeting, but an
    // existing room has space.
    const seats = delegates(["d1", "d2", "late-1"]);
    const frozen: ScheduleAssignment[] = [
      { ...crammed[0], delegateSeatIds: ["d1", "d2"] },
    ];

    const out = lateAdd(frozen, context(seats));

    expect(out.newlySeated).toEqual(["late-1"]);
    // ⛔ THE POINT: nobody else gained a meeting. JOIN put late-1 into a room
    // that already existed, so no schedule but late-1's changed at all.
    expect(out.alsoGained).toEqual([]);
    expect(out.added).toEqual([]);
    // d1 and d2 still meet partner-1 at s1 — they simply have company.
    expect(snapshot(out.assignments)).toEqual(["s1|ex-1|d1,d2,late-1"]);
  });

  it("names everyone whose day gains a meeting when FILL has to open a room", () => {
    // JOIN cannot help here — partner-1's only meeting is at max — so a lone
    // latecomer can only be seated by opening partner-2's room, and a new
    // meeting needs a minimum of two. FILL therefore recruits people who were
    // never promised that meeting, and every one of them is reported.
    const bSlots: MeetingSlotInput[] = Array.from({ length: 3 }, (_, i) => ({
      id: `b${i + 1}`,
      dayNumber: 1,
      slotNumber: i + 4,
      suiteId: "suite-b",
    }));
    const seats = delegates(["d1", "d2", "d3", "d4", "late-1"]);
    const twoExhibitors = new Map([
      ["ex-1", { orgId: "partner-1", suiteId: "suite-a" }],
      ["ex-2", { orgId: "partner-2", suiteId: "suite-b" }],
    ]);

    const out = lateAdd(
      crammed,
      context(seats, {
        meetingSlots: [...SLOTS, ...bSlots],
        exhibitorSeats: twoExhibitors,
        objective: { delegateSeats: seats, exhibitorSeats: twoExhibitors, orgTotalFor: () => 10 },
      })
    );

    expect(out.newlySeated).toEqual(["late-1"]);
    // ⛔ The assertion that matters: seating ONE person cost several others a
    // change to their printed day, and the caller is told exactly who. Silence
    // here would be the bug — this is the list that owes a phone call.
    expect(out.alsoGained.length).toBeGreaterThan(0);
    // Nothing was taken from them: the original meeting is intact.
    expect(snapshot(out.assignments)).toContain(snapshot(crammed)[0]);
  });

  it("waits rather than inventing a meeting of one", () => {
    const seats = delegates(["d1", "d2", "d3", "d4", "late-1"]);
    const out = lateAdd(crammed, context(seats));

    // Both additive moves are exhausted, for different reasons: JOIN finds no
    // under-full room (the only meeting is at max), and FILL finds no legal
    // companion (everyone else has already met partner-1, and a new meeting
    // needs two). Steve: "they still don't meet solo. They become a three or
    // wait for another solo add." This is the waiting case, and waiting is a
    // correct outcome rather than a failure — their schedule is not shipped the
    // moment they register.
    expect(out.newlySeated).toEqual([]);
    expect(out.stillWithoutMeetings).toEqual(["late-1"]);
  });
});
