import { describe, expect, it } from "vitest";
import { scoreSchedule } from "../objective";
import type { MeetingSlotInput, ScheduleAssignment } from "../types";

const SLOTS: MeetingSlotInput[] = [
  { id: "s1", dayNumber: 1, slotNumber: 1, suiteId: "suite-a" },
  { id: "s2", dayNumber: 1, slotNumber: 2, suiteId: "suite-a" },
  { id: "s3", dayNumber: 1, slotNumber: 3, suiteId: "suite-a" },
  { id: "s4", dayNumber: 1, slotNumber: 4, suiteId: "suite-a" },
];

const EXHIBITORS = new Map([["ex-1", { orgId: "partner-1", suiteId: "suite-a" }]]);
const DELEGATE_ORGS = new Map([
  ["d1", "member-1"],
  ["d2", "member-2"],
  ["d3", "member-3"],
  ["d4", "member-4"],
]);

/** Every member scores the same, so only structure moves the number. */
const FLAT = () => 10;

function meeting(slotId: string, delegates: string[]): ScheduleAssignment {
  return {
    meetingSlotId: slotId,
    exhibitorSeatId: "ex-1",
    exhibitorOrganizationId: "partner-1",
    delegateSeatIds: delegates,
    matchScoreKeys: [],
  };
}

function value(assignments: ScheduleAssignment[]): number {
  return scoreSchedule({
    assignments,
    meetingSlots: SLOTS,
    orgByDelegateSeatId: DELEGATE_ORGS,
    exhibitorSeats: EXHIBITORS,
    totalFor: FLAT,
  }).value;
}

describe("scoreSchedule — occupancy is TIME, not headcount", () => {
  it("⛔ prefers four delegates spread over four slots to four crammed into one", () => {
    /**
     * The whole point, and the thing I had backwards. Same four pairings either
     * way. One meeting of four occupies the room for a single slot and leaves the
     * exhibitor "staring at no one" for three; four meetings of one occupy all
     * four. Occupancy 1/4 vs 4/4, so the spread schedule scores 4× higher.
     */
    const crammed = value([meeting("s1", ["d1", "d2", "d3", "d4"])]);
    const spread = value([
      meeting("s1", ["d1"]),
      meeting("s2", ["d2"]),
      meeting("s3", ["d3"]),
      meeting("s4", ["d4"]),
    ]);
    expect(spread).toBeGreaterThan(crammed);
    expect(spread / crammed).toBeCloseTo(4, 5);
  });

  it("counts a group of two exactly as occupied as a group of four", () => {
    // Same slots used, so occupancy is identical; only matchTotal differs, and
    // it differs because there are more pairings — not because the room is fuller.
    const twos = scoreSchedule({
      assignments: [meeting("s1", ["d1", "d2"]), meeting("s2", ["d3", "d4"])],
      meetingSlots: SLOTS,
      orgByDelegateSeatId: DELEGATE_ORGS,
      exhibitorSeats: EXHIBITORS,
      totalFor: FLAT,
    });
    expect(twos.byExhibitor[0].occupancy).toBeCloseTo(0.5, 5);
    expect(twos.byExhibitor[0].slotsUsed).toBe(2);
  });

  it("scores an empty schedule at zero without dividing by zero", () => {
    const empty = scoreSchedule({
      assignments: [],
      meetingSlots: SLOTS,
      orgByDelegateSeatId: DELEGATE_ORGS,
      exhibitorSeats: EXHIBITORS,
      totalFor: FLAT,
    });
    expect(empty.value).toBe(0);
    expect(empty.overallOccupancy).toBe(0);
  });

  it("treats a missing match edge as 0, not as unknown", () => {
    // The engine drops genuine zeros and caps at top-50 per subject, so absence
    // is an answer. A schedule of unscored pairings is worth nothing, not
    // undefined.
    const unscored = scoreSchedule({
      assignments: [meeting("s1", ["d1", "d2"])],
      meetingSlots: SLOTS,
      orgByDelegateSeatId: DELEGATE_ORGS,
      exhibitorSeats: EXHIBITORS,
      totalFor: () => 0,
    });
    expect(unscored.value).toBe(0);
    // ...but the room was still occupied, which the report still says.
    expect(unscored.byExhibitor[0].occupancy).toBeCloseTo(0.25, 5);
  });

  it("reports occupancy across the whole floor, not just one suite", () => {
    const twoSuites: MeetingSlotInput[] = [
      ...SLOTS,
      { id: "s5", dayNumber: 1, slotNumber: 1, suiteId: "suite-b" },
    ];
    const result = scoreSchedule({
      assignments: [meeting("s1", ["d1"])],
      meetingSlots: twoSuites,
      orgByDelegateSeatId: DELEGATE_ORGS,
      exhibitorSeats: EXHIBITORS,
      totalFor: FLAT,
    });
    expect(result.overallOccupancy).toBeCloseTo(1 / 5, 5);
  });
});
