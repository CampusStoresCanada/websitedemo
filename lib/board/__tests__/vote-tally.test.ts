import { describe, it, expect } from "vitest";
import {
  tallyVote,
  resolveStatus,
  isSettledEarly,
  formatTally,
  formatOutcome,
  type Ballot,
  type VoteChoice,
} from "@/lib/board/vote-tally";

const BOARD = { boardSize: 9, threshold: 5 };

/** n ballots of a given choice, from distinct directors. */
function ballots(spec: Partial<Record<VoteChoice, number>>): Ballot[] {
  const out: Ballot[] = [];
  let i = 0;
  for (const [choice, count] of Object.entries(spec)) {
    for (let n = 0; n < (count ?? 0); n++) {
      out.push({ directorProfileId: `director-${i++}`, choice: choice as VoteChoice });
    }
  }
  return out;
}

const tally = (spec: Partial<Record<VoteChoice, number>>) =>
  tallyVote({ ballots: ballots(spec), ...BOARD });

describe("tallyVote", () => {
  it("counts an empty vote as nine directors yet to vote", () => {
    const t = tally({});
    expect(t).toMatchObject({ yes: 0, no: 0, abstain: 0, cast: 0, notVoted: 9 });
    expect(t.thresholdReached).toBe(false);
    expect(t.thresholdUnreachable).toBe(false);
  });

  it("reaches the threshold at exactly 5 Yes", () => {
    expect(tally({ yes: 4 }).thresholdReached).toBe(false);
    expect(tally({ yes: 5 }).thresholdReached).toBe(true);
  });

  it("counts one ballot per director even if handed duplicates", () => {
    const dupes: Ballot[] = [
      { directorProfileId: "d1", choice: "no" },
      { directorProfileId: "d1", choice: "yes" }, // a changed vote, joined twice
    ];
    const t = tallyVote({ ballots: dupes, ...BOARD });
    expect(t.cast).toBe(1);
    expect(t.yes).toBe(1);
    expect(t.no).toBe(0);
  });

  it("treats abstentions as not-Yes — they make approval harder", () => {
    // 4 Yes, 5 abstain: everyone has voted, threshold can never be met.
    const t = tally({ yes: 4, abstain: 5 });
    expect(t.notVoted).toBe(0);
    expect(t.thresholdReached).toBe(false);
    expect(t.thresholdUnreachable).toBe(true);
  });

  it("knows when the threshold has become unreachable", () => {
    // 5 No leaves only 4 possible Yes.
    expect(tally({ no: 5 }).thresholdUnreachable).toBe(true);
    // 4 No still leaves 5 possible Yes — not settled.
    expect(tally({ no: 4 }).thresholdUnreachable).toBe(false);
  });

  it("counts abstentions toward the unreachable calculation", () => {
    // 3 No + 2 abstain = 5 non-Yes, leaving 4 who could still say Yes.
    expect(tally({ no: 3, abstain: 2 }).thresholdUnreachable).toBe(true);
  });
});

describe("resolveStatus", () => {
  it("stays open before the deadline, even once settled", () => {
    expect(resolveStatus(tally({ yes: 5 }), false)).toBe("open");
    expect(resolveStatus(tally({ no: 9 }), false)).toBe("open");
  });

  it("carries at the deadline with 5 Yes", () => {
    expect(resolveStatus(tally({ yes: 5, no: 4 }), true)).toBe("carried");
  });

  it("rejects only when 5 or more actively vote No", () => {
    expect(resolveStatus(tally({ yes: 2, no: 5 }), true)).toBe("rejected");
  });

  it("LAPSES rather than rejecting when the board simply didn't turn out", () => {
    // 4 Yes, 1 No, 4 never voted. Approval failed, but nobody rejected them.
    const status = resolveStatus(tally({ yes: 4, no: 1 }), true);
    expect(status).toBe("lapsed");
    expect(status).not.toBe("rejected");
  });

  it("lapses on total silence", () => {
    expect(resolveStatus(tally({}), true)).toBe("lapsed");
  });

  it("lapses when abstentions block approval without anyone objecting", () => {
    // 4 Yes, 5 abstain — including any recusals. Not a rejection.
    expect(resolveStatus(tally({ yes: 4, abstain: 5 }), true)).toBe("lapsed");
  });
});

describe("isSettledEarly", () => {
  it("is settled once 5 Yes are in", () => {
    expect(isSettledEarly(tally({ yes: 5 }))).toBe(true);
  });

  it("is settled once Yes can no longer reach 5", () => {
    expect(isSettledEarly(tally({ no: 5 }))).toBe(true);
  });

  it("is unsettled while the outcome could still go either way", () => {
    expect(isSettledEarly(tally({ yes: 4, no: 4 }))).toBe(false);
  });
});

describe("formatting", () => {
  it("summarises a partial tally", () => {
    expect(formatTally(tally({ yes: 3, no: 1, abstain: 1 }))).toBe(
      "3 Yes · 1 No · 1 abstained · 4 not yet voted — 5 of 9 needed"
    );
  });

  it("omits empty categories", () => {
    expect(formatTally(tally({ yes: 5, no: 4 }))).toBe("5 Yes · 4 No — 5 of 9 needed");
  });

  it("explains a lapse as a carry-over, not a decline", () => {
    const t = tally({ yes: 4, no: 1 });
    const out = formatOutcome(t, "lapsed");
    expect(out).toContain("No decision");
    expect(out).toContain("next board meeting");
    expect(out).not.toContain("Not approved");
  });

  it("states approval plainly", () => {
    expect(formatOutcome(tally({ yes: 6 }), "carried")).toContain("Approved");
  });
});

describe("the snapshotted rule is honoured, not the current one", () => {
  it("tallies a historical 7-member board under its own threshold", () => {
    const t = tallyVote({ ballots: ballots({ yes: 4 }), boardSize: 7, threshold: 4 });
    expect(t.thresholdReached).toBe(true);
    expect(resolveStatus(t, true)).toBe("carried");
    // The same 4 Yes would NOT carry under today's 5-of-9 rule.
    expect(tally({ yes: 4 }).thresholdReached).toBe(false);
  });
});
