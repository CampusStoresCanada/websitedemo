import { describe, expect, it } from "vitest";
import { explainMatch, resolveIntent, type SearchSubject } from "../intent-search";

const subject = (over: Partial<SearchSubject>): SearchSubject => ({
  name: "Acme", description: null, departments: [], classes: [],
  booths: [], people: [], ...over,
});

const HOODIE_CO = subject({
  name: "Hotline Apparel", departments: ["Apparel"], classes: ["Activewear"], booths: ["402"],
});
const PEN_CO = subject({
  name: "Merangue", departments: ["School Office & Lab Supplies"],
  classes: ["Office Supplies"], booths: ["502"],
  description: "Distributor of writing instruments",
  people: ["Tom Austin"],
});

describe("resolving what someone meant", () => {
  it("translates an everyday word into taxonomy terms", () => {
    const r = resolveIntent("hoodies");
    expect(r.inferred).toBe(true);
    expect(r.terms).toContain("activewear");
  });

  it("does not call it a guess when they typed a real taxonomy word", () => {
    const r = resolveIntent("apparel");
    expect(r.inferred).toBe(false);
    expect(r.terms).toContain("apparel");
  });

  it("matches whole words only", () => {
    // "pen" inside "pending" or "happen" must not drag in stationery vendors.
    expect(resolveIntent("pending").terms).toEqual([]);
    expect(resolveIntent("happen").terms).toEqual([]);
    expect(resolveIntent("pens").terms.length).toBeGreaterThan(0);
  });

  it("finds nothing for a word it has never heard", () => {
    expect(resolveIntent("kayaks").terms).toEqual([]);
  });
});

describe("why something matched", () => {
  it("answers hoodies with a guess, not silence", () => {
    expect(explainMatch(HOODIE_CO, "hoodies")).toBe("guess");
  });

  it("answers pens with a guess", () => {
    expect(explainMatch(PEN_CO, "pens")).toBe("guess");
  });

  it("calls a real category hit a category, not a guess", () => {
    // Not HOODIE_CO — "Hotline Apparel" matches on NAME, which is stronger.
    // The test caught that, which is the precedence working.
    const plain = subject({ name: "Barbarian Bruzer", departments: ["Apparel"] });
    expect(explainMatch(plain, "apparel")).toBe("category");
  });

  it("finds a company through a person who works there", () => {
    expect(explainMatch(PEN_CO, "Tom Austin")).toBe("person");
    expect(explainMatch(PEN_CO, "tom")).toBe("person");
  });

  it("prefers the strongest evidence available", () => {
    // The name is a fact; a category is a choice; a synonym is our inference.
    const both = subject({ name: "Apparel Group", departments: ["Apparel"] });
    expect(explainMatch(both, "apparel")).toBe("name");
  });

  it("uses the whole-token booth rule, not a prefix", () => {
    // The bug this replaced: typing "40" returning 40, 400, 402 and 408.
    expect(explainMatch(HOODIE_CO, "402")).toBe("booth");
    expect(explainMatch(HOODIE_CO, "40")).toBeNull();
    expect(explainMatch(HOODIE_CO, "booth 402")).toBe("booth");
  });

  it("falls back to the company's own words", () => {
    expect(explainMatch(PEN_CO, "writing instruments")).toBe("describes");
  });

  it("returns nothing rather than guessing wildly", () => {
    expect(explainMatch(HOODIE_CO, "kayaks")).toBeNull();
    expect(explainMatch(HOODIE_CO, "   ")).toBeNull();
  });
});

describe("a number is a booth, not a word", () => {
  const NUMERIC_PROSE = subject({
    name: "Ookami Promo",
    description: "Serving campus stores for over 40 years",
    booths: ["200", "202"],
  });

  it("does not let a description smuggle a partial booth number through", () => {
    // Found live: typing "40" returned this company twice, because the
    // whole-token booth rule passed it to the description fallback, which
    // matched "40 years". The rule was right and the fallback undid it.
    expect(explainMatch(NUMERIC_PROSE, "40")).toBeNull();
  });

  it("still finds the booths they actually hold", () => {
    expect(explainMatch(NUMERIC_PROSE, "200")).toBe("booth");
    expect(explainMatch(NUMERIC_PROSE, "202")).toBe("booth");
  });

  it("leaves word searches alone", () => {
    expect(explainMatch(NUMERIC_PROSE, "campus stores")).toBe("describes");
  });
});
