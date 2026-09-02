import { isBlackedOut } from "./blackout";
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

const AXIS_LABELS: Record<string, string> = {
  // The engine's nine axes.
  category: "category overlap",
  certification: "certification fit",
  province: "province fit",
  timing: "buying-cycle timing",
  requirements: "stated requirements",
  services: "store services",
  cohort: "cohort similarity",
  semantic: "description similarity",
  behavioural: "past behaviour",
};

function formatLabel(key: string): string {
  return AXIS_LABELS[key] ?? key;
}

export function buildWhyLowerReasons(
  original: ScoreBreakdown,
  alternative: ScoreBreakdown
): string[] {
  const whyLower: string[] = [];

  for (const key of Object.keys(original)) {
    const originalScore = original[key];
    const alternativeScore = alternative[key];
    /**
     * ⛔ null is not zero — it means the axis never had anything to say about
     * one of these pairs. Reporting "province is lower (0 vs 0.4)" for an axis
     * we never observed states a judgement we never made. Two pairs can only be
     * compared on an axis where BOTH were actually scored.
     */
    if (originalScore === null || originalScore === undefined) continue;
    if (alternativeScore === null || alternativeScore === undefined) continue;
    if (alternativeScore < originalScore) {
      whyLower.push(
        `${formatLabel(key)} is lower (${alternativeScore} vs ${originalScore})`
      );
    }
  }

  return whyLower;
}

/**
 * @deprecated Prefer `isBlackedOut` from ./blackout directly. Kept as a thin
 * adapter so the swap call site and its tests keep their positional shape —
 * the rule itself now lives in exactly one place.
 */
export function isTwoWayBlackout(
  delegateOrgId: string,
  delegateBlackoutList: string[],
  exhibitorOrgId: string,
  exhibitorBlackoutList: string[]
): boolean {
  return isBlackedOut(
    { organizationId: delegateOrgId, blackoutList: delegateBlackoutList },
    { organizationId: exhibitorOrgId, blackoutList: exhibitorBlackoutList }
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
