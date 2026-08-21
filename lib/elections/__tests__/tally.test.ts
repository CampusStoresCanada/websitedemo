import { describe, it, expect } from "vitest";
import { tallyElection, resolveOutcome, formatTally } from "../tally";

const ballot = (selections: string[], abstain = false) => ({ selections, abstain });

describe("plurality-at-large", () => {
  it("elects the top N", () => {
    // a=3 b=3 c=3 d=2 e=1 — the cutoff separates cleanly.
    const t = tallyElection(
      [
        ballot(["a", "b", "c", "d"]),
        ballot(["a", "b", "c", "d"]),
        ballot(["a", "b", "c", "e"]),
      ],
      ["a", "b", "c", "d", "e"],
      4
    );
    expect(t.results.filter((r) => r.elected).map((r) => r.nominationId).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(t.certifiable).toBe(true);
  });

  it("counts abstentions without letting them affect ranking", () => {
    const t = tallyElection(
      [ballot(["a"]), ballot([], true), ballot([], true)],
      ["a", "b"],
      1
    );
    expect(t.abstentions).toBe(2);
    expect(t.ballotsCounted).toBe(3);
    expect(t.results.find((r) => r.nominationId === "a")!.votes).toBe(1);
  });

  it("treats a returned-but-empty ballot as blank, not an abstention", () => {
    const t = tallyElection([ballot([])], ["a"], 1);
    expect(t.blankBallots).toBe(1);
    expect(t.abstentions).toBe(0);
  });

  it("allows undervoting", () => {
    const t = tallyElection([ballot(["a"])], ["a", "b", "c"], 3);
    expect(t.totalSelections).toBe(1);
    expect(t.certifiable).toBe(true);
  });

  it("never counts a duplicated selection twice", () => {
    const t = tallyElection([ballot(["a", "a", "a"])], ["a", "b"], 2);
    expect(t.results.find((r) => r.nominationId === "a")!.votes).toBe(1);
  });

  it("ignores selections that are not on the ballot", () => {
    const t = tallyElection([ballot(["a", "ghost"])], ["a"], 1);
    expect(t.totalSelections).toBe(1);
  });
});

describe("ties", () => {
  it("refuses to certify a tie at the cutoff", () => {
    // 4 seats; a,b,c clear, then d and e tie for the last one.
    const t = tallyElection(
      [
        ballot(["a", "b", "c", "d"]),
        ballot(["a", "b", "c", "e"]),
        ballot(["a", "b", "c", "d"]),
        ballot(["a", "b", "c", "e"]),
      ],
      ["a", "b", "c", "d", "e"],
      4
    );
    expect(t.tieAtCutoff).toBe(true);
    expect(t.tiedCandidates.sort()).toEqual(["d", "e"]);
    expect(t.seatsResolved).toBe(3);
    expect(t.certifiable).toBe(false);
    // Nobody is quietly seated on the strength of arrival order.
    expect(t.results.find((r) => r.nominationId === "d")!.elected).toBe(false);
    expect(t.results.find((r) => r.nominationId === "e")!.elected).toBe(false);
    expect(formatTally(t)).toMatch(/TIE at the cutoff/);
  });

  it("is a tie when three candidates share the cutoff but only two seats remain", () => {
    // a=3 b=3, then c=d=e=2 for the last two seats. Three into two does not go.
    const t = tallyElection(
      [
        ballot(["a", "b", "c", "d"]),
        ballot(["a", "b", "c", "e"]),
        ballot(["a", "b", "d", "e"]),
      ],
      ["a", "b", "c", "d", "e"],
      4
    );
    expect(t.tieAtCutoff).toBe(true);
    expect(t.tiedCandidates.sort()).toEqual(["c", "d", "e"]);
    expect(t.seatsResolved).toBe(2);
    expect(t.certifiable).toBe(false);
  });

  it("is not a tie when the tied candidates all fit in the remaining seats", () => {
    // 2 seats, a and b tie for both. Nothing to resolve.
    const t = tallyElection([ballot(["a", "b"]), ballot(["a", "b"])], ["a", "b"], 2);
    expect(t.tieAtCutoff).toBe(false);
    expect(t.certifiable).toBe(true);
    expect(t.results.every((r) => r.elected)).toBe(true);
  });

  it("gives tied candidates the same rank", () => {
    const t = tallyElection([ballot(["a"]), ballot(["b"])], ["a", "b", "c"], 3);
    const ranks = Object.fromEntries(t.results.map((r) => [r.nominationId, r.rank]));
    expect(ranks.a).toBe(ranks.b);
  });

  it("handles fewer candidates than seats without calling it a tie", () => {
    const t = tallyElection([ballot(["a", "b"])], ["a", "b"], 4);
    expect(t.tieAtCutoff).toBe(false);
    expect(t.certifiable).toBe(true);
    expect(t.seatsResolved).toBe(2);
  });
});

describe("ballot or acclamation", () => {
  it("calls a ballot when nominees exceed seats", () => {
    expect(resolveOutcome(6, 4).outcome).toBe("balloted");
  });

  it("acclaims an exact slate", () => {
    const r = resolveOutcome(4, 4);
    expect(r.outcome).toBe("acclaimed");
    expect(r.reason).toMatch(/no ballot needed/);
  });

  it("acclaims a short slate and names the vacancies", () => {
    const r = resolveOutcome(3, 5);
    expect(r.outcome).toBe("acclaimed");
    expect(r.reason).toMatch(/2 seats will be left vacant/);
  });
});
