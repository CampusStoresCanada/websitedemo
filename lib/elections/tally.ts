/**
 * Counting an election.
 *
 * Plurality-at-large: each institution selects up to `seats` candidates, and the
 * top `seats` by vote count are elected. Pure, mirroring lib/board/vote-tally.ts.
 *
 * The one thing this module will not do is break a tie. By-Law No. 1 prescribes
 * no tie-break for ranking candidates, and the two provisions that could be read
 * to supply one point in different directions:
 *
 *   - Part V S3(e) has the members "elect the directors who had the most votes"
 *     AT the AGM, which reads as the ballot producing an ordering and the
 *     electing act happening on the floor -- so a tie goes to the meeting.
 *   - Part VII S8 defeats a motion on an equality of votes, which would leave
 *     the seat unfilled and hand it to the board under Part IV S3.
 *
 * Both are defensible; neither is settled. So a tie at the cutoff stops the
 * process and names the candidates, and a human records the resolution and the
 * authority for it. `config.tabulation.autoBreakTies` is typed as `false` so
 * that this stays a reviewable setting rather than an unstated assumption.
 */

export interface CountedBallot {
  /** Nomination ids selected. Empty for an abstention or a fully blank ballot. */
  selections: string[];
  abstain: boolean;
}

export interface CandidateResult {
  nominationId: string;
  votes: number;
  /** 1-based, dense: tied candidates share a rank. */
  rank: number;
  elected: boolean;
  /** Tied with at least one other candidate at the cutoff. */
  tiedAtCutoff: boolean;
}

export interface ElectionTally {
  seats: number;
  ballotsCounted: number;
  abstentions: number;
  /** Returned without abstaining and without selecting anyone. */
  blankBallots: number;
  totalSelections: number;
  results: CandidateResult[];
  /** Candidates that would fill the last seat(s) but cannot be separated. */
  tieAtCutoff: boolean;
  tiedCandidates: string[];
  /** Seats that can be filled without resolving anything. */
  seatsResolved: number;
  /** True when the tally is final and certifiable as-is. */
  certifiable: boolean;
}

export function tallyElection(
  ballots: CountedBallot[],
  candidateIds: string[],
  seats: number
): ElectionTally {
  const votes = new Map<string, number>();
  for (const id of candidateIds) votes.set(id, 0);

  let abstentions = 0;
  let blankBallots = 0;
  let totalSelections = 0;

  for (const ballot of ballots) {
    if (ballot.abstain) {
      abstentions++;
      continue;
    }
    // Defensive: the unique index prevents duplicate selections per ballot, but
    // a bad join could hand us one. A duplicate must never count twice.
    const unique = [...new Set(ballot.selections)].filter((id) => votes.has(id));
    if (unique.length === 0) {
      blankBallots++;
      continue;
    }
    for (const id of unique) {
      votes.set(id, votes.get(id)! + 1);
      totalSelections++;
    }
  }

  // Sort by votes desc. Ties are NOT broken here -- candidates on equal votes
  // keep whatever relative order they arrived in, and share a rank.
  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);

  const results: CandidateResult[] = [];
  let rank = 0;
  let lastVotes: number | null = null;
  sorted.forEach(([nominationId, v], index) => {
    if (v !== lastVotes) {
      rank = index + 1;
      lastVotes = v;
    }
    results.push({ nominationId, votes: v, rank, elected: false, tiedAtCutoff: false });
  });

  // The cutoff is the vote count of the candidate sitting in the last seat.
  const cutoffCandidate = results[seats - 1];

  if (!cutoffCandidate) {
    // Fewer candidates than seats — everyone is in, and the remaining seats are
    // vacancies for the board to fill. Not a tie, and not an error.
    for (const r of results) r.elected = true;
    return {
      seats,
      ballotsCounted: ballots.length,
      abstentions,
      blankBallots,
      totalSelections,
      results,
      tieAtCutoff: false,
      tiedCandidates: [],
      seatsResolved: results.length,
      certifiable: true,
    };
  }

  const cutoffVotes = cutoffCandidate.votes;
  const atCutoff = results.filter((r) => r.votes === cutoffVotes);
  const aboveCutoff = results.filter((r) => r.votes > cutoffVotes);

  // A tie only matters if more candidates share the cutoff count than there are
  // seats left for them. Four candidates tied for four remaining seats is fine.
  const seatsRemaining = seats - aboveCutoff.length;
  const tieAtCutoff = atCutoff.length > seatsRemaining;

  for (const r of aboveCutoff) r.elected = true;
  if (!tieAtCutoff) {
    for (const r of atCutoff) r.elected = true;
  } else {
    for (const r of atCutoff) r.tiedAtCutoff = true;
  }

  return {
    seats,
    ballotsCounted: ballots.length,
    abstentions,
    blankBallots,
    totalSelections,
    results,
    tieAtCutoff,
    tiedCandidates: tieAtCutoff ? atCutoff.map((r) => r.nominationId) : [],
    seatsResolved: aboveCutoff.length + (tieAtCutoff ? 0 : atCutoff.length),
    certifiable: !tieAtCutoff,
  };
}

/**
 * Does this election need a ballot at all?
 *
 * By-Law Part V S3(a)/(d): a ballot is circulated only where additional
 * nominations arrive; otherwise the nominees are acclaimed. Expressed here on
 * the count rather than the source, because that is the condition that actually
 * has to hold -- you cannot acclaim five people into four seats.
 */
export function resolveOutcome(
  validatedNomineeCount: number,
  seats: number
): { outcome: "acclaimed" | "balloted"; reason: string } {
  if (validatedNomineeCount > seats) {
    return {
      outcome: "balloted",
      reason: `${validatedNomineeCount} validated nominees for ${seats} seat${seats === 1 ? "" : "s"} — a ballot is required.`,
    };
  }
  if (validatedNomineeCount === seats) {
    return {
      outcome: "acclaimed",
      reason: `${validatedNomineeCount} validated nominees for ${seats} seat${seats === 1 ? "" : "s"} — acclaimed, no ballot needed.`,
    };
  }
  return {
    outcome: "acclaimed",
    reason: `Only ${validatedNomineeCount} validated nominee${validatedNomineeCount === 1 ? "" : "s"} for ${seats} seats — those nominated are acclaimed and ${seats - validatedNomineeCount} seat${seats - validatedNomineeCount === 1 ? "" : "s"} will be left vacant for the board to fill.`,
  };
}

export function formatTally(tally: ElectionTally): string {
  const parts = [
    `${tally.ballotsCounted} ballot${tally.ballotsCounted === 1 ? "" : "s"} counted`,
  ];
  if (tally.abstentions) parts.push(`${tally.abstentions} abstained`);
  if (tally.blankBallots) parts.push(`${tally.blankBallots} blank`);
  const line = `${parts.join(" · ")} — ${tally.seats} seat${tally.seats === 1 ? "" : "s"}`;
  if (!tally.tieAtCutoff) return line;
  return `${line}. TIE at the cutoff between ${tally.tiedCandidates.length} candidates — ${tally.seatsResolved} of ${tally.seats} seats resolved. Certification is blocked until a human records how the tie is resolved.`;
}
