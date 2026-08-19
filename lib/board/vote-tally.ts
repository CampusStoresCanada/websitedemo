/**
 * Counting board votes.
 *
 * The rule is a majority of the *whole board*, not of votes cast: 5 Yes out of
 * a fixed 9 directors carries. Both numbers are snapshotted on the vote row, so
 * this never reads them from live config — a decision taken last year must
 * still tally under last year's rule.
 *
 * Consequences of a fixed denominator, worth being explicit about:
 *   - An abstention is arithmetically identical to a No. Recusals are recorded
 *     as abstentions, so a recused director makes approval harder, not neutral.
 *   - Not voting is also identical to a No, which is why a vote that simply
 *     runs out of time LAPSES rather than being rejected.
 */

export type VoteChoice = "yes" | "no" | "abstain";
export type VoteStatus = "open" | "carried" | "rejected" | "lapsed" | "withdrawn";

export interface Ballot {
  directorProfileId: string;
  choice: VoteChoice;
}

export interface TallyInput {
  ballots: Ballot[];
  boardSize: number;
  threshold: number;
}

export interface Tally {
  yes: number;
  no: number;
  abstain: number;
  /** Directors who have not cast any ballot. */
  notVoted: number;
  cast: number;
  boardSize: number;
  threshold: number;
  /** Threshold reached — carries whenever the vote is closed. */
  thresholdReached: boolean;
  /**
   * Even if every remaining director voted Yes, the threshold could not be
   * met. The outcome is settled early, though the vote stays open for
   * discussion.
   */
  thresholdUnreachable: boolean;
}

export function tallyVote({ ballots, boardSize, threshold }: TallyInput): Tally {
  // Defensive: one ballot per director is enforced by a unique constraint, but
  // a caller could hand us a bad join. Last ballot per director wins.
  const byDirector = new Map<string, VoteChoice>();
  for (const b of ballots) byDirector.set(b.directorProfileId, b.choice);

  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const choice of byDirector.values()) {
    if (choice === "yes") yes++;
    else if (choice === "no") no++;
    else abstain++;
  }

  const cast = byDirector.size;
  const notVoted = Math.max(0, boardSize - cast);
  // Only directors who haven't voted can still add to the Yes column.
  const bestPossibleYes = yes + notVoted;

  return {
    yes,
    no,
    abstain,
    notVoted,
    cast,
    boardSize,
    threshold,
    thresholdReached: yes >= threshold,
    thresholdUnreachable: bestPossibleYes < threshold,
  };
}

/**
 * The status a vote should hold, given its tally and whether the deadline has
 * passed.
 *
 * A vote is NEVER closed early. Once the threshold is reached (or becomes
 * unreachable) the outcome is settled, but the post stays open until the
 * deadline so late discussion still has somewhere to land — on the 2026-08-13
 * precedent post, material due diligence arrived six days after the poll
 * closed. Use `isSettledEarly` to have Butler announce the standing without
 * ending the conversation.
 */
export function resolveStatus(tally: Tally, deadlinePassed: boolean): VoteStatus {
  if (!deadlinePassed) return "open";
  if (tally.thresholdReached) return "carried";
  // Distinguishing rejection from lapse is the point: an applicant must not be
  // turned away because directors were travelling. Only an active majority
  // making approval impossible counts as a rejection.
  if (tally.no >= tally.threshold) return "rejected";
  return "lapsed";
}

/** True once the outcome cannot change, regardless of who else votes. */
export function isSettledEarly(tally: Tally): boolean {
  return tally.thresholdReached || tally.thresholdUnreachable;
}

/** "4 Yes · 1 No · 1 abstained · 3 not yet voted — 5 of 9 needed" */
export function formatTally(tally: Tally): string {
  const parts = [`${tally.yes} Yes`, `${tally.no} No`];
  if (tally.abstain) parts.push(`${tally.abstain} abstained`);
  if (tally.notVoted) parts.push(`${tally.notVoted} not yet voted`);
  return `${parts.join(" · ")} — ${tally.threshold} of ${tally.boardSize} needed`;
}

/** One-line outcome for Butler's closing comment and the board minutes. */
export function formatOutcome(tally: Tally, status: VoteStatus): string {
  switch (status) {
    case "carried":
      return `Approved — ${formatTally(tally)}.`;
    case "rejected":
      return `Not approved — ${formatTally(tally)}.`;
    case "lapsed":
      return `No decision — ${formatTally(tally)}. Voting closed without reaching ${tally.threshold} in favour, so this carries over to the next board meeting rather than being declined.`;
    case "withdrawn":
      return "Withdrawn before the vote closed.";
    default:
      return `Open — ${formatTally(tally)}.`;
  }
}
