import { describe, expect, it } from "vitest";
import { lateAddFill } from "../late-add";
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

    const out = lateAddFill(crammed, context(seats));

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
    const late = lateAddFill(crammed, context(seats));
    expect(snapshot(late.assignments)).toContain(snapshot(crammed)[0]);
  });

  it("seats latecomers in spare room and names who else gained a meeting", () => {
    const seats = delegates(["d1", "d2", "d3", "d4", "late-1", "late-2"]);
    const out = lateAddFill(crammed, context(seats));

    // Two latecomers can fill an empty slot together — group minimum is 2.
    expect(out.newlySeated).toEqual(["late-1", "late-2"]);
    expect(out.added.length).toBeGreaterThan(0);
    // Nobody already seated was disturbed, so nothing was taken from anyone.
    expect(out.stillWithoutMeetings).toEqual([]);
  });

  it("reports honestly when there is no room rather than forcing a seat", () => {
    // One slot, already used by the only exhibitor: no empty slot exists.
    const oneSlot = [SLOTS[0]];
    const seats = delegates(["d1", "d2", "late-1", "late-2"]);
    const frozen: ScheduleAssignment[] = [
      { ...crammed[0], delegateSeatIds: ["d1", "d2"] },
    ];

    const out = lateAddFill(frozen, context(seats, { meetingSlots: oneSlot }));

    expect(out.added).toEqual([]);
    expect(out.newlySeated).toEqual([]);
    expect(out.stillWithoutMeetings).toEqual(["late-1", "late-2"]);
    // And critically: the existing meeting is untouched.
    expect(snapshot(out.assignments)).toEqual(snapshot(frozen));
  });

  it("names the already-seated delegate whose printed day gains a meeting", () => {
    // Two suites. d1 already meets partner-1 at s1 and that is frozen. A
    // latecomer arrives; the only legal companion for partner-2's empty room is
    // d1, who has not met partner-2. Nobody is moved — but d1's schedule, sent
    // on 18 January, now has a meeting on it that it did not have.
    const bSlots: MeetingSlotInput[] = Array.from({ length: 3 }, (_, i) => ({
      id: `b${i + 1}`,
      dayNumber: 1,
      slotNumber: i + 4,
      suiteId: "suite-b",
    }));
    const seats = delegates(["d1", "late-1"]);
    const twoExhibitors = new Map([
      ["ex-1", { orgId: "partner-1", suiteId: "suite-a" }],
      ["ex-2", { orgId: "partner-2", suiteId: "suite-b" }],
    ]);
    const frozen: ScheduleAssignment[] = [
      {
        meetingSlotId: "s1",
        exhibitorSeatId: "ex-1",
        exhibitorOrganizationId: "partner-1",
        delegateSeatIds: ["d1"],
        matchScoreKeys: [],
      },
    ];

    const out = lateAddFill(
      frozen,
      context(seats, {
        meetingSlots: [...SLOTS, ...bSlots],
        exhibitorSeats: twoExhibitors,
        objective: { delegateSeats: seats, exhibitorSeats: twoExhibitors, orgTotalFor: () => 10 },
      })
    );

    expect(out.newlySeated).toEqual(["late-1"]);
    // ⛔ The assertion that matters: d1 is reported, so whoever runs the late
    // add knows to tell them. Silence here would be the bug.
    expect(out.alsoGained).toEqual(["d1"]);
    // d1's ORIGINAL meeting is still intact — gaining one is not moving one.
    expect(snapshot(out.assignments)).toContain("s1|ex-1|d1");
  });

  it("a lone latecomer cannot be seated alone — group minimum is 2", () => {
    const seats = delegates(["d1", "d2", "d3", "d4", "late-1"]);
    const out = lateAddFill(crammed, context(seats));

    // Everyone else has already met partner-1, so there is no legal companion
    // and no legal meeting. This is a real limitation, not a defect: the
    // answer is a phone call, not a group of one.
    expect(out.newlySeated).toEqual([]);
    expect(out.stillWithoutMeetings).toEqual(["late-1"]);
  });
});
