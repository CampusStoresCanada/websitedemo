import { describe, expect, it } from "vitest";
import { isBlackedOut } from "../blackout";
import { generateSchedule } from "../generate";
import { computeAllMatchScores } from "../scoring";
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
    matchScores: computeAllMatchScores([d], [e]),
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
