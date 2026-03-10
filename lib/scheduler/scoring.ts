import { generateMatchReasons } from "./reasons";
import type {
  DelegateProfile,
  ExhibitorProfile,
  MatchScoreRecord,
  ScoreBreakdown,
} from "./types";

function normalize(values: string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(normalize(right));
  return normalize(left).filter((value) => rightSet.has(value));
}

function scoreCategoryOverlap(delegate: DelegateProfile, exhibitor: ExhibitorProfile): number {
  const shared = intersection(delegate.categoryResponsibilities, exhibitor.secondaryCategories);
  if (shared.length === 0) return 0;
  return Math.min(30, shared.length * 10);
}

function scoreTimelineMatch(delegate: DelegateProfile, exhibitor: ExhibitorProfile): number {
  const shared = intersection(delegate.buyingTimeline, exhibitor.buyingCyclesTargeted);
  if (shared.length === 0) return 0;
  return Math.min(20, shared.length * 10);
}

function scorePriorityAlignment(delegate: DelegateProfile, exhibitor: ExhibitorProfile): number {
  const shared = intersection(delegate.topPriorities, exhibitor.meetingOutcomeIntent);
  if (shared.length === 0) return 0;
  return Math.min(20, shared.length * 7);
}

function scoreIntentMatch(delegate: DelegateProfile, exhibitor: ExhibitorProfile): number {
  const readinessKeys = exhibitor.salesReadiness
    ? Object.entries(exhibitor.salesReadiness)
        .filter(([, value]) => value === true)
        .map(([key]) => key.toLowerCase())
    : [];

  const overlap = delegate.meetingIntent
    .map((value) => value.toLowerCase())
    .filter((value) => readinessKeys.includes(value));

  if (overlap.length > 0) return Math.min(10, overlap.length * 5);
  if (readinessKeys.length > 0 && delegate.meetingIntent.length > 0) return 3;
  return 0;
}

function scorePurchasingAuthority(purchasingAuthority: string | null): number {
  const normalized = (purchasingAuthority ?? "").toLowerCase();
  if (normalized.includes("sign")) return 5;
  if (normalized.includes("commit")) return 4;
  if (normalized.includes("recommend")) return 3;
  if (normalized.includes("research")) return 1;
  return 0;
}

export function computeMatchScore(
  delegate: DelegateProfile,
  exhibitor: ExhibitorProfile
): {
  totalScore: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  isBlackout: boolean;
  isTop5: boolean;
} {
  const isBlackout = delegate.blackoutList.includes(exhibitor.organizationId);
  const isTop5 = delegate.top5Preferences.includes(exhibitor.organizationId);

  const breakdown: ScoreBreakdown = {
    category_overlap: scoreCategoryOverlap(delegate, exhibitor),
    buying_timeline_match: scoreTimelineMatch(delegate, exhibitor),
    priority_alignment: scorePriorityAlignment(delegate, exhibitor),
    top_5_preference: isTop5 ? 15 : 0,
    meeting_intent_match: scoreIntentMatch(delegate, exhibitor),
    purchasing_authority: scorePurchasingAuthority(delegate.purchasingAuthority),
    blackout_penalty: isBlackout ? Number.NEGATIVE_INFINITY : 0,
  };

  const reasons = generateMatchReasons(breakdown, delegate, exhibitor);

  if (isBlackout) {
    return {
      totalScore: Number.NEGATIVE_INFINITY,
      breakdown,
      reasons,
      isBlackout,
      isTop5,
    };
  }

  const totalScore =
    breakdown.category_overlap +
    breakdown.buying_timeline_match +
    breakdown.priority_alignment +
    breakdown.top_5_preference +
    breakdown.meeting_intent_match +
    breakdown.purchasing_authority;

  return {
    totalScore,
    breakdown,
    reasons,
    isBlackout,
    isTop5,
  };
}

export function computeAllMatchScores(
  delegates: DelegateProfile[],
  exhibitors: ExhibitorProfile[]
): MatchScoreRecord[] {
  const scores: MatchScoreRecord[] = [];

  for (const delegate of delegates) {
    for (const exhibitor of exhibitors) {
      const result = computeMatchScore(delegate, exhibitor);
      scores.push({
        delegateRegistrationId: delegate.registrationId,
        exhibitorRegistrationId: exhibitor.registrationId,
        exhibitorOrganizationId: exhibitor.organizationId,
        totalScore: result.totalScore,
        breakdown: result.breakdown,
        reasons: result.reasons,
        isBlackout: result.isBlackout,
        isTop5: result.isTop5,
      });
    }
  }

  return scores;
}
