import type { DelegateProfile, ExhibitorProfile, ScoreBreakdown } from "./types";

function shared(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map((value) => value.toLowerCase()));
  return left.filter((value) => rightSet.has(value.toLowerCase()));
}

/**
 * ⚠️ v2 reasons, kept null-safe rather than retired.
 *
 * These read the seven v2 axis names and the v2 profile fields
 * (categoryResponsibilities, buyingTimeline, topPriorities,
 * meetingOutcomeIntent), most of which no longer have a home. The match engine
 * now emits its own `reasons[]` with evidence and a source org per reason,
 * which is strictly better — this should be retired in favour of that, but
 * scoring.ts/reasons.ts are the matching session's files and that call is
 * theirs to make, not mine.
 *
 * An ABSENT axis correctly yields no reason: `?? 0` here is not the forbidden
 * null-to-zero collapse, because the output is "say this or do not". No
 * evidence means nothing to say.
 */
export function generateMatchReasons(
  breakdown: ScoreBreakdown,
  delegate: DelegateProfile,
  exhibitor: ExhibitorProfile
): string[] {
  const reasons: string[] = [];

  const sharedCategories = shared(delegate.categoryResponsibilities, exhibitor.secondaryCategories);
  if ((breakdown.category_overlap ?? 0) > 0 && sharedCategories.length > 0) {
    reasons.push(`Shared categories: ${sharedCategories.join(", ")}`);
  }

  const sharedTimeline = shared(delegate.buyingTimeline, exhibitor.buyingCyclesTargeted);
  if ((breakdown.buying_timeline_match ?? 0) > 0 && sharedTimeline.length > 0) {
    reasons.push(`Both targeting: ${sharedTimeline.join(", ")}`);
  }

  if ((breakdown.top_5_preference ?? 0) > 0) {
    reasons.push("This exhibitor is in your top five preferences");
  }

  const alignedPriorities = shared(delegate.topPriorities, exhibitor.meetingOutcomeIntent);
  if ((breakdown.priority_alignment ?? 0) > 0 && alignedPriorities.length > 0) {
    reasons.push(`Aligned priorities: ${alignedPriorities.join(", ")}`);
  }

  if ((breakdown.meeting_intent_match ?? 0) > 0) {
    reasons.push("Meeting intent and exhibitor readiness are compatible");
  }

  if ((breakdown.purchasing_authority ?? 0) >= 4) {
    reasons.push("Purchasing authority suggests high meeting value");
  }

  if ((breakdown.blackout_penalty ?? 0) === Number.NEGATIVE_INFINITY) {
    reasons.push("Blocked by blackout preference");
  }

  return reasons;
}
