import type { DelegateProfile, ExhibitorProfile, ScoreBreakdown } from "./types";

function shared(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map((value) => value.toLowerCase()));
  return left.filter((value) => rightSet.has(value.toLowerCase()));
}

export function generateMatchReasons(
  breakdown: ScoreBreakdown,
  delegate: DelegateProfile,
  exhibitor: ExhibitorProfile
): string[] {
  const reasons: string[] = [];

  const sharedCategories = shared(delegate.categoryResponsibilities, exhibitor.secondaryCategories);
  if (breakdown.category_overlap > 0 && sharedCategories.length > 0) {
    reasons.push(`Shared categories: ${sharedCategories.join(", ")}`);
  }

  const sharedTimeline = shared(delegate.buyingTimeline, exhibitor.buyingCyclesTargeted);
  if (breakdown.buying_timeline_match > 0 && sharedTimeline.length > 0) {
    reasons.push(`Both targeting: ${sharedTimeline.join(", ")}`);
  }

  if (breakdown.top_5_preference > 0) {
    reasons.push("This exhibitor is in your top five preferences");
  }

  const alignedPriorities = shared(delegate.topPriorities, exhibitor.meetingOutcomeIntent);
  if (breakdown.priority_alignment > 0 && alignedPriorities.length > 0) {
    reasons.push(`Aligned priorities: ${alignedPriorities.join(", ")}`);
  }

  if (breakdown.meeting_intent_match > 0) {
    reasons.push("Meeting intent and exhibitor readiness are compatible");
  }

  if (breakdown.purchasing_authority >= 4) {
    reasons.push("Purchasing authority suggests high meeting value");
  }

  if (breakdown.blackout_penalty === Number.NEGATIVE_INFINITY) {
    reasons.push("Blocked by blackout preference");
  }

  return reasons;
}
