import { describe, expect, it } from "vitest";
import { computeAllMatchScores } from "../scoring";
import { generateSchedule } from "../generate";
import type {
  DelegateProfile,
  ExhibitorProfile,
  MeetingSlotInput,
  SchedulingPolicy,
} from "../types";

function fixtureDelegates(): DelegateProfile[] {
  return [
    {
      registrationId: "d1",
      organizationId: "org-d1",
      userId: "u-d1",
      categoryResponsibilities: ["snacks"],
      buyingTimeline: ["holiday"],
      topPriorities: ["margin"],
      meetingIntent: ["quote"],
      purchasingAuthority: "can_sign",
      top5Preferences: ["org-e1"],
      blackoutList: [],
    },
    {
      registrationId: "d2",
      organizationId: "org-d2",
      userId: "u-d2",
      categoryResponsibilities: ["beverages"],
      buyingTimeline: ["spring"],
      topPriorities: ["innovation"],
      meetingIntent: ["negotiate"],
      purchasingAuthority: "can_commit",
      top5Preferences: ["org-e2"],
      blackoutList: ["org-e1"],
    },
    {
      registrationId: "d3",
      organizationId: "org-d3",
      userId: "u-d3",
      categoryResponsibilities: ["snacks"],
      buyingTimeline: ["holiday"],
      topPriorities: ["margin"],
      meetingIntent: ["quote"],
      purchasingAuthority: "can_recommend",
      top5Preferences: [],
      blackoutList: [],
    },
  ];
}

function fixtureExhibitors(): ExhibitorProfile[] {
  return [
    {
      registrationId: "e1",
      organizationId: "org-e1",
      userId: "u-e1",
      blackoutList: [],
      primaryCategory: "snacks",
      secondaryCategories: ["snacks"],
      buyingCyclesTargeted: ["holiday"],
      meetingOutcomeIntent: ["margin"],
      salesReadiness: { quote: true },
    },
    {
      registrationId: "e2",
      organizationId: "org-e2",
      userId: "u-e2",
      blackoutList: [],
      primaryCategory: "beverages",
      secondaryCategories: ["beverages"],
      buyingCyclesTargeted: ["spring"],
      meetingOutcomeIntent: ["innovation"],
      salesReadiness: { negotiate: true },
    },
  ];
}

function fixtureSlots(): MeetingSlotInput[] {
  return [
    { id: "s1", dayNumber: 1, slotNumber: 1, suiteId: "suite-1" },
    { id: "s2", dayNumber: 1, slotNumber: 1, suiteId: "suite-2" },
    { id: "s3", dayNumber: 1, slotNumber: 2, suiteId: "suite-1" },
    { id: "s4", dayNumber: 1, slotNumber: 2, suiteId: "suite-2" },
  ];
}

const policy: SchedulingPolicy = {
  delegateCoveragePct: 0.5,
  meetingGroupMin: 1,
  meetingGroupMax: 2,
  orgCoveragePct: 70,
  tiebreakMode: "seeded",
  feasibilityRelaxation: false,
};

describe("generateSchedule", () => {
  it("is deterministic for same seed and same inputs", () => {
    const delegates = fixtureDelegates();
    const exhibitors = fixtureExhibitors();
    const scores = computeAllMatchScores(delegates, exhibitors);
    const slots = fixtureSlots();

    const first = generateSchedule({
      delegates,
      exhibitors,
      meetingSlots: slots,
      matchScores: scores,
      policy,
      seed: 123,
    });

    const second = generateSchedule({
      delegates,
      exhibitors,
      meetingSlots: slots,
      matchScores: scores,
      policy,
      seed: 123,
    });

    expect(first.assignments).toEqual(second.assignments);
    expect(first.status).toEqual(second.status);
  });

  it("never places blacked out pairs", () => {
    const delegates = fixtureDelegates();
    const exhibitors = fixtureExhibitors();
    const scores = computeAllMatchScores(delegates, exhibitors);

    const result = generateSchedule({
      delegates,
      exhibitors,
      meetingSlots: fixtureSlots(),
      matchScores: scores,
      policy,
      seed: 123,
    });

    const d2Assignments = result.assignments.filter((assignment) =>
      assignment.delegateSeatIds.includes("d2")
    );
    const hasBlackout = d2Assignments.some((assignment) => assignment.exhibitorOrganizationId === "org-e1");
    expect(hasBlackout).toBe(false);
  });

  it("NEVER puts an exhibitor in a suite they do not hold", () => {
    /**
     * The regression that started this: Boxercraft bought booth 305 ($4,000, no
     * suite) and the solver sat them in unsold suite 107 ($6,000). A suite is
     * part of a booth — `booth --includes--> suite` — so holding the booth is
     * the ONLY way to get one. A solver does not give away inventory.
     */
    const delegates = fixtureDelegates();
    const exhibitors = fixtureExhibitors();

    const result = generateSchedule({
      delegates,
      exhibitors,
      meetingSlots: [{ id: "s1", dayNumber: 1, slotNumber: 1, suiteId: "suite-nobody-holds" }],
      matchScores: computeAllMatchScores(delegates, exhibitors),
      policy,
      // Nobody is pinned: nobody holds this suite.
      suitePinnedExhibitorBySuiteId: {},
      seed: 7,
    });

    expect(result.assignments).toEqual([]);
    expect(
      result.diagnostics.violations.some((v) => v.code === "EXHIBITOR_WITHOUT_SUITE")
    ).toBe(true);
  });

  it("reports soft warnings when targets are not fully met", () => {
    const delegates = fixtureDelegates();
    const exhibitors = fixtureExhibitors();
    const scores = computeAllMatchScores(delegates, exhibitors);

    // Only 1 slot + 1 suite → most delegates/exhibitors won't meet targets.
    // These are soft violations → completed_with_warnings (not infeasible).
    const result = generateSchedule({
      delegates,
      exhibitors,
      meetingSlots: [{ id: "s1", dayNumber: 1, slotNumber: 1, suiteId: "suite-1" }],
      matchScores: scores,
      policy: {
        ...policy,
        delegateCoveragePct: 1,
        meetingGroupMax: 1,
      },
      // One suite, held by one exhibitor. The others hold none, so they are not
      // scheduled — and are reported as EXHIBITOR_WITHOUT_SUITE rather than
      // being dealt into rooms they did not buy.
      suitePinnedExhibitorBySuiteId: { "suite-1": exhibitors[0].registrationId },
      seed: 12,
    });

    expect(result.status).toBe("completed_with_warnings");
    expect(result.diagnostics.violations.length).toBeGreaterThan(0);
    expect(result.diagnostics.violations.every((v) => v.severity === "soft")).toBe(true);
    // Assignments are still produced despite soft violations
    expect(result.assignments.length).toBeGreaterThan(0);
  });
});
