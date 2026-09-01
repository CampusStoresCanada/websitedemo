import { describe, expect, it } from "vitest";
import { containerChain, holderOf, type InclusionRef } from "../inclusion";

/**
 * The shape on CSC 2027: booth 202 includes suite 202, and Ookami Promo bought
 * the booth. Nobody ever recorded that they hold the suite — that is the fact
 * these functions derive instead of asking someone to type it.
 */
const BOOTH = "booth-202";
const SUITE = "suite-202";
const TABLE = "table-in-202";
const TRADE_SHOW = "trade-show";
const OOKAMI = "org-ookami";

const REFS: InclusionRef[] = [
  { from_entity_id: BOOTH, to_entity_id: SUITE, role: "includes" },
  { from_entity_id: BOOTH, to_entity_id: TABLE, role: "includes" },
  // Participation, not containment — the booth does not CONTAIN the trade show.
  { from_entity_id: BOOTH, to_entity_id: TRADE_SHOW, role: "involved_in" },
];

describe("containerChain", () => {
  it("finds the booth that contains a suite", () => {
    expect(containerChain(SUITE, REFS)).toEqual([BOOTH]);
  });

  it("walks more than one hop", () => {
    const nested: InclusionRef[] = [
      ...REFS,
      { from_entity_id: "hall", to_entity_id: BOOTH, role: "includes" },
    ];
    expect(containerChain(SUITE, nested)).toEqual([BOOTH, "hall"]);
  });

  it("does not treat involved_in as containment", () => {
    // Were this wrong, the trade show would be 'inside' every exhibitor's booth.
    expect(containerChain(TRADE_SHOW, REFS)).toEqual([]);
  });

  it("terminates on a cycle rather than hanging", () => {
    const cyclic: InclusionRef[] = [
      { from_entity_id: "a", to_entity_id: "b", role: "includes" },
      { from_entity_id: "b", to_entity_id: "a", role: "includes" },
    ];
    expect(containerChain("a", cyclic).sort()).toEqual(["b"]);
  });
});

describe("holderOf", () => {
  it("derives the suite holder from the booth sale", () => {
    // The whole point: this is never written down anywhere.
    const sales = new Map([[BOOTH, OOKAMI]]);
    expect(holderOf(SUITE, REFS, sales)).toBe(OOKAMI);
  });

  it("gives the same answer for anything else the booth contains", () => {
    const sales = new Map([[BOOTH, OOKAMI]]);
    expect(holderOf(TABLE, REFS, sales)).toBe(OOKAMI);
  });

  it("does NOT hand the trade show to whoever bought a booth", () => {
    const sales = new Map([[BOOTH, OOKAMI]]);
    expect(holderOf(TRADE_SHOW, REFS, sales)).toBeNull();
  });

  it("prefers a direct hold over an inherited one", () => {
    const sales = new Map([
      [BOOTH, OOKAMI],
      [SUITE, "org-someone-else"],
    ]);
    expect(holderOf(SUITE, REFS, sales)).toBe("org-someone-else");
  });

  it("returns null for an unsold booth instead of guessing", () => {
    expect(holderOf(SUITE, REFS, new Map())).toBeNull();
  });
});
