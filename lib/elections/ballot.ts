/**
 * Ballot validity. Pure, so the same answer is available to the ballot UI, the
 * save action, and the seal step without any of them re-deriving it.
 *
 * One ballot belongs to an INSTITUTION, not a person. Any of that institution's
 * admins may revise it until the close -- which is the practice member stores
 * have insisted on, and is why co-editing is a first-class case here rather
 * than a de-duplication problem. The cost is that two admins can overwrite each
 * other, so `describeLastEdit` exists to make the last writer visible in the UI
 * rather than leaving a silent clobber.
 */

import type { ElectionsConfig } from "./config";

export interface BallotDraft {
  selections: string[];
  abstain: boolean;
}

export interface BallotValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateBallot(
  draft: BallotDraft,
  candidateIds: readonly string[],
  seats: number,
  config: ElectionsConfig
): BallotValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const candidates = new Set(candidateIds);

  if (draft.abstain) {
    if (!config.ballot.allowAbstain) errors.push("Abstaining is not permitted in this election.");
    // Abstain is exclusive: an abstention that also carries selections is
    // ambiguous, and guessing which the voter meant is not ours to do.
    if (draft.selections.length > 0)
      errors.push("An abstention cannot also select candidates. Choose one or the other.");
    return { valid: errors.length === 0, errors, warnings };
  }

  const unique = new Set(draft.selections);
  if (unique.size !== draft.selections.length)
    errors.push("The same candidate is selected more than once.");

  for (const id of unique) {
    if (!candidates.has(id))
      errors.push("A selection is not on the ballot for this election.");
  }

  if (unique.size > seats)
    errors.push(
      `You may select at most ${seats} candidate${seats === 1 ? "" : "s"} — ${unique.size} are selected.`
    );

  if (unique.size === 0) {
    warnings.push(
      "This ballot selects no one and is not marked as an abstention. It will be returned blank and will not count toward any candidate."
    );
  } else if (unique.size < seats) {
    if (!config.ballot.allowUndervote) {
      errors.push(`You must select exactly ${seats} candidates.`);
    } else {
      warnings.push(
        `${unique.size} of ${seats} selections used. You may select up to ${seats}.`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Ordering for display. By-Law Part V S3(a) requires alphabetical. */
export function orderCandidates<T extends { displayName: string }>(
  candidates: T[],
  config: ElectionsConfig
): T[] {
  if (!config.ballot.alphabetical) return candidates;
  return [...candidates].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * "Last saved by Trish Linden-Teasdale on Nov 24 at 2:41 PM MST."
 *
 * Shown whenever an institution has more than one admin. Two people editing one
 * ballot is expected here, so the risk is a quiet overwrite, not a conflict.
 */
export function describeLastEdit(
  lastEditedByName: string | null,
  lastEditedAt: string | null,
  formatTimestamp: (iso: string) => string
): string | null {
  if (!lastEditedAt) return null;
  const when = formatTimestamp(lastEditedAt);
  return lastEditedByName
    ? `Last saved by ${lastEditedByName} on ${when}.`
    : `Last saved on ${when}.`;
}
