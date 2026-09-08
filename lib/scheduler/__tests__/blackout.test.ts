import { describe, expect, it } from "vitest";
import { isBlackedOut } from "../blackout";
import { generateSchedule } from "../generate";
import { fixtureMatchScores } from "./score-fixtures";
import { validateScheduleConstraints } from "../constraints";
import type {
  DelegateProfile,
  ExhibitorProfile,
  MeetingSlotInput,
  SchedulingPolicy,
} from "../types";

const policy: SchedulingPolicy = {
  delegateCoveragePct: 1,
  meetingGroupMin: 1,
  meetingGroupMax: 2,
  orgCoveragePct: 0,
  tiebreakMode: "seeded",
  feasibilityRelaxation: true,
};

function delegate(over: Partial<DelegateProfile> = {}): DelegateProfile {
  return {
    registrationId: "d1",
    organizationId: "org-d1",
    userId: "u-d1",
    categoryResponsibilities: ["snacks"],
    buyingTimeline: ["holiday"],
    topPriorities: ["margin"],
    meetingIntent: ["quote"],
    purchasingAuthority: "can_sign",
    top5Preferences: [],
    blackoutList: [],
    ...over,
  };
}

function exhibitor(over: Partial<ExhibitorProfile> = {}): ExhibitorProfile {
  return {
    registrationId: "e1",
    organizationId: "org-e1",
    userId: "u-e1",
    blackoutList: [],
    primaryCategory: "snacks",
    secondaryCategories: ["snacks"],
    buyingCyclesTargeted: ["holiday"],
    meetingOutcomeIntent: ["margin"],
    salesReadiness: { quote: true },
    ...over,
  };
}

const slots: MeetingSlotInput[] = [
  { id: "s1", dayNumber: 1, slotNumber: 1, suiteId: "suite-1" },
  { id: "s2", dayNumber: 1, slotNumber: 2, suiteId: "suite-1" },
];

function scheduleWith(d: DelegateProfile, e: ExhibitorProfile) {
  return generateSchedule({
    delegates: [d],
    exhibitors: [e],
    meetingSlots: slots,
    matchScores: fixtureMatchScores([d], [e]),
    policy,
    // The exhibitor has to HOLD the suite to be in it. Previously any exhibitor
    // was dealt into any empty suite, so this fixture worked without saying so
    // — which is exactly the free-fill that gave a $4,000 booth an unsold
    // $6,000 suite on the first real run.
    suitePinnedExhibitorBySuiteId: { "suite-1": e.registrationId },
    seed: 1,
  });
}

function pairIsScheduled(result: ReturnType<typeof generateSchedule>): boolean {
  return result.assignments.some((a) => a.delegateSeatIds.includes("d1"));
}

describe("isBlackedOut", () => {
  it("is symmetrical — a partner can fire a customer", () => {
    const store = { organizationId: "org-d1", blackoutList: [] as string[] };
    const vendor = { organizationId: "org-e1", blackoutList: ["org-d1"] };
    expect(isBlackedOut(store, vendor)).toBe(true);
    expect(isBlackedOut(vendor, store)).toBe(true);
  });

  it("blocks when the store declares the vendor", () => {
    expect(
      isBlackedOut(
        { organizationId: "org-d1", blackoutList: ["org-e1"] },
        { organizationId: "org-e1", blackoutList: [] }
      )
    ).toBe(true);
  });

  it("allows a pairing neither side has declared", () => {
    expect(
      isBlackedOut(
        { organizationId: "org-d1", blackoutList: ["org-other"] },
        { organizationId: "org-e1", blackoutList: ["org-other"] }
      )
    ).toBe(false);
  });
});

describe("generateSchedule honours blackouts in both directions", () => {
  it("schedules a pair neither side has blacked out", () => {
    expect(pairIsScheduled(scheduleWith(delegate(), exhibitor()))).toBe(true);
  });

  it("does not schedule a delegate who blacked out the exhibitor", () => {
    const result = scheduleWith(delegate({ blackoutList: ["org-e1"] }), exhibitor());
    expect(pairIsScheduled(result)).toBe(false);
  });

  // The regression this module exists for. Before blackout.ts, ExhibitorProfile
  // had no blackoutList at all and computeMatchScore only ever checked
  // delegate -> exhibitor, so generation happily booked this meeting — and the
  // swap system, which did check both directions, then refused to move it.
  it("does not schedule an exhibitor who blacked out the delegate's org", () => {
    const result = scheduleWith(delegate(), exhibitor({ blackoutList: ["org-d1"] }));
    expect(pairIsScheduled(result)).toBe(false);
  });

  // Score is advisory ordering only. It may never authorise a meeting the
  // parties have refused, so a scorer that forgets to flag a blackout — or an
  // external matching engine that has no way to know about one — must not be
  // able to smuggle the pairing through.
  it("excludes a blacked-out pair even when the score record says otherwise", () => {
    const d = delegate({ blackoutList: ["org-e1"] });
    const e = exhibitor();
    const result = generateSchedule({
      delegates: [d],
      exhibitors: [e],
      meetingSlots: slots,
      matchScores: [
        {
          delegateSeatId: "d1",
          exhibitorSeatId: "e1",
          exhibitorOrganizationId: "org-e1",
          totalScore: 100,
          breakdown: {
            category_overlap: 100,
            buying_timeline_match: 0,
            priority_alignment: 0,
            top_5_preference: 0,
            meeting_intent_match: 0,
            purchasing_authority: 0,
            blackout_penalty: 0,
          },
          reasons: [],
          isBlackout: false,
          isTop5: false,
        },
      ],
      policy,
      seed: 1,
    });
    expect(pairIsScheduled(result)).toBe(false);
  });
});

describe("validateScheduleConstraints reports both directions", () => {
  it("flags an exhibitor-declared blackout and names who declared it", () => {
    const report = validateScheduleConstraints({
      meetingSlots: slots,
      assignments: [
        {
          meetingSlotId: "s1",
          exhibitorSeatId: "e1",
          exhibitorOrganizationId: "org-e1",
          delegateSeatIds: ["d1"],
          matchScoreKeys: [],
        },
      ],
      delegates: [delegate()],
      exhibitors: [exhibitor({ blackoutList: ["org-d1"] })],
      delegateTargetMeetings: 1,
      exhibitorTargetMeetings: 1,
      policy,
    });
    const blackout = report.violations.filter((v) => v.code === "BLACKOUT");
    expect(blackout).toHaveLength(1);
    expect(blackout[0].severity).toBe("hard");
    expect(blackout[0].details?.declaredBy).toBe("exhibitor");
  });
});

describe("a delegate who refuses everyone is not a scheduling failure", () => {
  /**
   * Steve: "if we have someone blacklist all the partners and then come to the
   * conference... what are they doing?"
   *
   * ⛔ The point is that the METRIC must tell the two apart. Before this, a
   * delegate who refused every exhibitor and a delegate the solver simply never
   * picked up appeared identically in DELEGATE_TARGET — so the headline number
   * was dragged down by people we did nothing wrong by, and the real misses were
   * hidden among them.
   */
  it("reports self-exclusion as info, not as a missed target", () => {
    const d = delegate({ blackoutList: ["org-e1"] });
    const e = exhibitor();
    const report = validateScheduleConstraints({
      meetingSlots: slots,
      assignments: [],
      delegates: [d],
      exhibitors: [e],
      delegateTargetMeetings: 1,
      exhibitorTargetMeetings: 1,
      policy,
    });

    const selfExcluded = report.violations.filter((v) => v.code === "DELEGATE_SELF_EXCLUDED");
    expect(selfExcluded).toHaveLength(1);
    expect(selfExcluded[0].severity).toBe("info");
    // ⛔ And NOT counted as below target — they had nobody they were willing to meet.
    expect(report.violations.filter((v) => v.code === "DELEGATE_TARGET")).toHaveLength(0);
  });

  it("still flags a delegate we simply failed to schedule", () => {
    // Nothing refused, nothing booked: that is our miss and must stay visible.
    const report = validateScheduleConstraints({
      meetingSlots: slots,
      assignments: [],
      delegates: [delegate()],
      exhibitors: [exhibitor()],
      delegateTargetMeetings: 1,
      exhibitorTargetMeetings: 1,
      policy,
    });
    expect(report.violations.filter((v) => v.code === "DELEGATE_TARGET")).toHaveLength(1);
    expect(report.violations.filter((v) => v.code === "DELEGATE_SELF_EXCLUDED")).toHaveLength(0);
  });

  it("never demands more meetings than there are exhibitors to meet", () => {
    /**
     * ⛔ The other half: the target is capped by what was REACHABLE. Asking for
     * 24 meetings when 31 suites exist but only 23 distinct times do is how
     * DELEGATE_TARGET came to fire on 100% of delegates on every run — a
     * permanently-red warning, which is the same as no warning.
     */
    const report = validateScheduleConstraints({
      meetingSlots: slots,
      assignments: [
        {
          meetingSlotId: "s1",
          exhibitorSeatId: "e1",
          exhibitorOrganizationId: "org-e1",
          delegateSeatIds: ["d1"],
          matchScoreKeys: [],
        },
      ],
      delegates: [delegate()],
      exhibitors: [exhibitor()],
      delegateTargetMeetings: 10, // only ONE exhibitor exists
      exhibitorTargetMeetings: 1,
      policy,
    });
    expect(report.violations.filter((v) => v.code === "DELEGATE_TARGET")).toHaveLength(0);
  });
});

describe("per-person coverage catches what org coverage cannot", () => {
  /**
   * ⛔ THE DISCRIMINATING CASE. Two buyers from ONE store; one is scheduled and
   * one is not. Org coverage reads 100% — the store is represented — while a
   * real person flew to Toronto, sat through the meeting block and met nobody.
   * That is invisible at org grain by construction, which is why this exists.
   */
  const sameOrgPair = [
    delegate({ registrationId: "d1", organizationId: "org-shared", userId: "u1" }),
    delegate({ registrationId: "d2", organizationId: "org-shared", userId: "u2" }),
  ];

  function reportFor(delegateSeatIds: string[]) {
    return validateScheduleConstraints({
      meetingSlots: slots,
      assignments: [
        {
          meetingSlotId: "s1",
          exhibitorSeatId: "e1",
          exhibitorOrganizationId: "org-e1",
          delegateSeatIds,
          matchScoreKeys: [],
        },
      ],
      delegates: sameOrgPair,
      exhibitors: [exhibitor()],
      delegateTargetMeetings: 1,
      exhibitorTargetMeetings: 1,
      policy,
    });
  }

  it("fires when one of two colleagues gets nothing, while org coverage passes", () => {
    const report = reportFor(["d1"]);

    expect(report.orgCoveragePctAchieved).toBe(100); // the STORE is covered
    expect(report.personCoveragePctAchieved).toBe(50); // half the PEOPLE are not
    expect(report.violations.filter((v) => v.code === "ORG_COVERAGE")).toHaveLength(0);

    const personCoverage = report.violations.filter((v) => v.code === "PERSON_COVERAGE");
    expect(personCoverage).toHaveLength(1);
    expect(personCoverage[0].details?.delegateSeatIds).toEqual(["d2"]);
  });

  it("is silent once everybody has at least one meeting", () => {
    const report = reportFor(["d1", "d2"]);
    expect(report.personCoveragePctAchieved).toBe(100);
    expect(report.violations.filter((v) => v.code === "PERSON_COVERAGE")).toHaveLength(0);
  });

  it("does not blame us for someone who refused every exhibitor", () => {
    /**
     * ⛔ Self-excluded delegates leave the DENOMINATOR. Counting them would make
     * the number impossible for us to move and therefore ignorable — the same
     * way DELEGATE_TARGET became noise when it demanded 24 of a possible 23.
     */
    const report = validateScheduleConstraints({
      meetingSlots: slots,
      assignments: [
        {
          meetingSlotId: "s1",
          exhibitorSeatId: "e1",
          exhibitorOrganizationId: "org-e1",
          delegateSeatIds: ["d1"],
          matchScoreKeys: [],
        },
      ],
      delegates: [
        delegate({ registrationId: "d1", organizationId: "org-a", userId: "u1" }),
        delegate({
          registrationId: "refuser",
          organizationId: "org-b",
          userId: "u2",
          blackoutList: ["org-e1"],
        }),
      ],
      exhibitors: [exhibitor()],
      delegateTargetMeetings: 1,
      exhibitorTargetMeetings: 1,
      policy,
    });

    expect(report.personCoveragePctAchieved).toBe(100);
    expect(report.violations.filter((v) => v.code === "PERSON_COVERAGE")).toHaveLength(0);
    expect(report.violations.filter((v) => v.code === "DELEGATE_SELF_EXCLUDED")).toHaveLength(1);
  });
});

describe("org coverage compares like with like", () => {
  /**
   * ⛔ REGRESSION PIN. `pct()` returns 0..100 and the policy is stored 0..1, so
   * this check read `50 < 0.7` and passed silently at every coverage above
   * zero. Stubbing the whole check out left all 71 scheduler tests green — it
   * had no coverage at all, which is exactly how a unit mismatch survives.
   */
  const strict = { ...policy, orgCoveragePct: 0.7 };
  const threeOrgs = [
    delegate({ registrationId: "d1", organizationId: "org-a", userId: "u1" }),
    delegate({ registrationId: "d2", organizationId: "org-b", userId: "u2" }),
    delegate({ registrationId: "d3", organizationId: "org-c", userId: "u3" }),
  ];

  function coverageReport(delegateSeatIds: string[]) {
    return validateScheduleConstraints({
      meetingSlots: slots,
      assignments: [
        {
          meetingSlotId: "s1",
          exhibitorSeatId: "e1",
          exhibitorOrganizationId: "org-e1",
          delegateSeatIds,
          matchScoreKeys: [],
        },
      ],
      delegates: threeOrgs,
      exhibitors: [exhibitor()],
      delegateTargetMeetings: 1,
      exhibitorTargetMeetings: 1,
      policy: strict,
    });
  }

  it("fires when one org of three is covered and policy wants 70%", () => {
    const report = coverageReport(["d1"]);
    expect(report.orgCoveragePctAchieved).toBeCloseTo(33.33, 1);
    expect(report.violations.filter((v) => v.code === "ORG_COVERAGE")).toHaveLength(1);
  });

  it("is silent at full coverage", () => {
    const report = coverageReport(["d1", "d2", "d3"]);
    expect(report.orgCoveragePctAchieved).toBe(100);
    expect(report.violations.filter((v) => v.code === "ORG_COVERAGE")).toHaveLength(0);
  });
});
