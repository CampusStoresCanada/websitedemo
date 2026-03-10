import { describe, expect, it } from "vitest";
import { computeMatchScore } from "../scoring";
import type { DelegateProfile, ExhibitorProfile } from "../types";

const delegate: DelegateProfile = {
  registrationId: "d1",
  organizationId: "org-d1",
  userId: "u-d1",
  categoryResponsibilities: ["snacks", "beverages"],
  buyingTimeline: ["holiday", "spring"],
  topPriorities: ["margin", "sustainability"],
  meetingIntent: ["quote", "negotiate"],
  purchasingAuthority: "can_sign",
  top5Preferences: ["org-e1"],
  blackoutList: ["org-e9"],
};

const exhibitor: ExhibitorProfile = {
  registrationId: "e1",
  organizationId: "org-e1",
  userId: "u-e1",
  primaryCategory: "snacks",
  secondaryCategories: ["snacks", "coffee"],
  buyingCyclesTargeted: ["holiday"],
  meetingOutcomeIntent: ["margin"],
  salesReadiness: { quote: true, negotiate: true },
};

describe("computeMatchScore", () => {
  it("applies component weights and total", () => {
    const result = computeMatchScore(delegate, exhibitor);
    expect(result.isBlackout).toBe(false);
    expect(result.isTop5).toBe(true);
    expect(result.breakdown.top_5_preference).toBe(15);
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("marks blackout pairs as non-schedulable", () => {
    const blackoutResult = computeMatchScore(delegate, {
      ...exhibitor,
      registrationId: "e9",
      organizationId: "org-e9",
    });

    expect(blackoutResult.isBlackout).toBe(true);
    expect(blackoutResult.totalScore).toBe(Number.NEGATIVE_INFINITY);
  });
});
