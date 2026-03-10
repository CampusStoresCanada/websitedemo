import type { ScoreBreakdown, SwapAlternative, SwapCountMode } from "./types";

interface CapCountRow {
  status: string;
}

const CONSUMES_REQUESTED = new Set([
  "requested",
  "options_generated",
  "approved_committed",
  "denied_invalid",
  "canceled",
]);

const CONSUMES_COMMITTED = new Set(["approved_committed"]);

function formatLabel(key: keyof ScoreBreakdown): string {
  switch (key) {
    case "category_overlap":
      return "category overlap";
    case "buying_timeline_match":
      return "timeline overlap";
    case "priority_alignment":
      return "priority alignment";
    case "top_5_preference":
      return "top 5 preference";
    case "meeting_intent_match":
      return "meeting intent fit";
    case "purchasing_authority":
      return "purchasing authority fit";
    case "blackout_penalty":
      return "blackout compatibility";
    default:
      return key;
  }
}

export function buildWhyLowerReasons(
  original: ScoreBreakdown,
  alternative: ScoreBreakdown
): string[] {
  const whyLower: string[] = [];
  const keys = Object.keys(original) as Array<keyof ScoreBreakdown>;

  for (const key of keys) {
    if (key === "blackout_penalty") continue;
    const originalScore = Number(original[key] ?? 0);
    const alternativeScore = Number(alternative[key] ?? 0);
    if (alternativeScore < originalScore) {
      whyLower.push(
        `${formatLabel(key)} is lower (${alternativeScore} vs ${originalScore})`
      );
    }
  }

  return whyLower;
}

export function isTwoWayBlackout(
  delegateOrgId: string,
  delegateBlackoutList: string[],
  exhibitorOrgId: string,
  exhibitorBlackoutList: string[]
): boolean {
  return (
    delegateBlackoutList.includes(exhibitorOrgId) ||
    exhibitorBlackoutList.includes(delegateOrgId)
  );
}

export function rankSwapAlternatives(alternatives: SwapAlternative[]): SwapAlternative[] {
  return [...alternatives].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.scoreDeltaFromOriginal !== left.scoreDeltaFromOriginal) {
      return right.scoreDeltaFromOriginal - left.scoreDeltaFromOriginal;
    }
    return left.scheduleId.localeCompare(right.scheduleId);
  });
}

export function countConsumedSwaps(rows: CapCountRow[], mode: SwapCountMode): number {
  const allowed = mode === "committed" ? CONSUMES_COMMITTED : CONSUMES_REQUESTED;
  return rows.reduce((count, row) => (allowed.has(row.status) ? count + 1 : count), 0);
}

export function hasLinkedSlotConflict(
  slotId: string,
  delegateOccupiedSlotIds: Set<string>,
  linkedOccupiedSlotIds: Set<string>
): boolean {
  return delegateOccupiedSlotIds.has(slotId) || linkedOccupiedSlotIds.has(slotId);
}
