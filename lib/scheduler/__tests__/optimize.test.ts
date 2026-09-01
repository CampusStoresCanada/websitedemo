import { describe, expect, it } from "vitest";
import { optimizeSchedule } from "../optimize";
import type { MeetingSlotInput, ScheduleAssignment } from "../types";

const SLOTS: MeetingSlotInput[] = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i + 1}`,
  dayNumber: 1,
  slotNumber: i + 1,
  suiteId: "suite-a",
}));

const EXHIBITORS = new Map([["ex-1", { orgId: "partner-1", suiteId: "suite-a" }]]);

const DELEGATES = new Map([
  ["d1", { orgId: "member-1", contactId: null }],
  ["d2", { orgId: "member-2", contactId: null }],
  ["d3", { orgId: "member-3", contactId: null }],
  ["d4", { orgId: "member-4", contactId: null }],
]);

const POLICY = { meetingGroupMin: 2, meetingGroupMax: 4 };

function context(overrides: Partial<Parameters<typeof optimizeSchedule>[1]> = {}) {
  return {
    meetingSlots: SLOTS,
    policy: POLICY,
    exhibitorSeats: EXHIBITORS,
    delegateSeats: DELEGATES,
    mayMeet: () => true,
    objective: {
      delegateSeats: DELEGATES,
      exhibitorSeats: EXHIBITORS,
      orgTotalFor: () => 10,
    },
    seed: 42,
    ...overrides,
  } as Parameters<typeof optimizeSchedule>[1];
}

const crammed: ScheduleAssignment[] = [
  {
    meetingSlotId: "s1",
    exhibitorSeatId: "ex-1",
    exhibitorOrganizationId: "partner-1",
    delegateSeatIds: ["d1", "d2", "d3", "d4"],
    matchScoreKeys: [],
  },
];

describe("optimizeSchedule", () => {
  it("splits a packed meeting into more occupied slots — the whole point", () => {
    /**
     * Same four pairings either way. One group of four occupies one slot of six
     * and leaves the exhibitor idle for five; splitting converts spare seats into
     * room-time, which is what "delegate time is the binding constraint" means in
     * practice.
     */
    const result = optimizeSchedule(crammed, context());

    expect(result.after.value).toBeGreaterThan(result.before.value);
    expect(result.after.totalMeetings).toBeGreaterThan(result.before.totalMeetings);
    expect(result.movesApplied.split).toBeGreaterThan(0);
    // Pairings are conserved — nobody gained or lost a meeting partner.
    expect(result.after.totalPairings).toBe(result.before.totalPairings);
  });

  it("never double-books a delegate while improving", () => {
    const result = optimizeSchedule(crammed, context());
    const seen = new Map<string, Set<string>>();
    for (const assignment of result.assignments) {
      const slot = SLOTS.find((s) => s.id === assignment.meetingSlotId)!;
      for (const delegateSeatId of assignment.delegateSeatIds) {
        const times = seen.get(delegateSeatId) ?? new Set<string>();
        const when = `${slot.dayNumber}:${slot.slotNumber}`;
        expect(times.has(when)).toBe(false);
        times.add(when);
        seen.set(delegateSeatId, times);
      }
    }
  });

  it("keeps every group within the policy bounds", () => {
    const result = optimizeSchedule(crammed, context());
    for (const assignment of result.assignments) {
      expect(assignment.delegateSeatIds.length).toBeGreaterThanOrEqual(POLICY.meetingGroupMin);
      expect(assignment.delegateSeatIds.length).toBeLessThanOrEqual(POLICY.meetingGroupMax);
    }
  });

  it("⛔ will not pair delegates the legality filter refuses, at any score", () => {
    /**
     * A score may never authorise a pairing. mayMeet refuses d3 and d4 entirely,
     * so no move may introduce them even though the objective would rise.
     */
    const result = optimizeSchedule(
      [
        {
          meetingSlotId: "s1",
          exhibitorSeatId: "ex-1",
          exhibitorOrganizationId: "partner-1",
          delegateSeatIds: ["d1", "d2"],
          matchScoreKeys: [],
        },
      ],
      context({ mayMeet: (delegateSeatId: string) => delegateSeatId === "d1" || delegateSeatId === "d2" })
    );
    const everyone = result.assignments.flatMap((a) => a.delegateSeatIds);
    expect(everyone).not.toContain("d3");
    expect(everyone).not.toContain("d4");
  });

  it("never books a delegate with the same exhibitor org twice", () => {
    const result = optimizeSchedule(crammed, context());
    const pairs = new Set<string>();
    for (const assignment of result.assignments) {
      for (const delegateSeatId of assignment.delegateSeatIds) {
        const key = `${delegateSeatId}|${assignment.exhibitorOrganizationId}`;
        expect(pairs.has(key)).toBe(false);
        pairs.add(key);
      }
    }
  });

  it("is deterministic for the same seed and input", () => {
    const a = optimizeSchedule(crammed, context());
    const b = optimizeSchedule(crammed, context());
    expect(JSON.stringify(a.assignments)).toBe(JSON.stringify(b.assignments));
  });

  it("leaves an already-optimal schedule alone", () => {
    const spread: ScheduleAssignment[] = [
      { meetingSlotId: "s1", exhibitorSeatId: "ex-1", exhibitorOrganizationId: "partner-1", delegateSeatIds: ["d1", "d2"], matchScoreKeys: [] },
      { meetingSlotId: "s2", exhibitorSeatId: "ex-1", exhibitorOrganizationId: "partner-1", delegateSeatIds: ["d3", "d4"], matchScoreKeys: [] },
    ];
    const result = optimizeSchedule(spread, context());
    expect(result.after.value).toBe(result.before.value);
    expect(result.movesApplied.split + result.movesApplied.fill).toBe(0);
  });
});
