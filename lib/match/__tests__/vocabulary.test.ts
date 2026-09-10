import { describe, it, expect } from "vitest";
import {
  tokenize,
  orgVocabulary,
  corpusDocumentFrequency,
  MIN_DOCS,
  MAX_KEYWORDS,
} from "../vocabulary";

const df = (m: Record<string, number>) => new Map(Object.entries(m));

describe("tokenize", () => {
  it("keeps words, drops short tokens and stopwords", () => {
    expect(tokenize("We have great hoodies and fleece")).toEqual(["hoodies", "fleece"]);
  });

  it("⛔ drops digits entirely", () => {
    // Order numbers, dollar figures, dates and phone fragments are the parts of a
    // sentence most likely to identify a transaction or a person, and the least
    // likely to help anyone find a supplier.
    expect(tokenize("invoice 44821 for $1,299.00 on 2026-09-09 hoodies")).toEqual(["invoice", "hoodies"]);
  });

  it("drops CSC's own vocabulary, which every partner sits inside", () => {
    expect(tokenize("Campus Stores Canada conference member bookstore")).toEqual([]);
  });

  it("drops forum furniture", () => {
    expect(tokenize("Thanks everyone, great meeting, attached update")).toEqual([]);
  });
});

describe("orgVocabulary — the privacy guard", () => {
  it(`⛔ discards a term appearing in only one document (MIN_DOCS=${MIN_DOCS})`, () => {
    // The guard that matters. A one-person partner's vocabulary is one human's
    // voice, and a one-off phrase from a single post must be unpublishable —
    // otherwise searching an exact phrase confirms a private post exists.
    const out = orgVocabulary(
      [{ text: "dalhousie negotiation collapsed unexpectedly" }],
      df({}),
      50
    );
    expect(out).toEqual([]);
  });

  it("keeps a term that recurs across documents", () => {
    const out = orgVocabulary(
      [{ text: "hoodies hoodies" }, { text: "more hoodies today" }],
      df({ hoodies: 3 }),
      50
    );
    expect(out).toContain("hoodies");
  });

  it("⛔ applies the doc-count guard BEFORE scoring, so nothing can outrank it", () => {
    // "confidential" appears 50 times but in ONE document, so it must lose to a
    // term appearing twice across TWO — frequency cannot buy its way past the guard.
    const out = orgVocabulary(
      [
        { text: Array(50).fill("confidential").join(" ") + " hoodies" },
        { text: "hoodies fleece" },
      ],
      df({ confidential: 1, hoodies: 2, fleece: 2 }),
      50
    );
    expect(out).not.toContain("confidential");
    expect(out).toContain("hoodies");
  });

  it("returns single tokens only — never a phrase", () => {
    const out = orgVocabulary(
      [{ text: "custom embroidered hoodies" }, { text: "custom embroidered hoodies again" }],
      df({ custom: 4, embroidered: 2, hoodies: 2 }),
      50
    );
    for (const term of out) expect(term).not.toContain(" ");
  });
});

describe("orgVocabulary — ranking", () => {
  it("down-weights a term every org uses", () => {
    // "apparel" is used by 48 of 50 orgs, "grommet" by 2. Both appear twice here,
    // so only the industry-wide baseline separates them.
    const out = orgVocabulary(
      [{ text: "apparel grommet" }, { text: "apparel grommet" }],
      df({ apparel: 48, grommet: 2 }),
      50
    );
    expect(out.indexOf("grommet")).toBeLessThan(out.indexOf("apparel"));
  });

  it(`caps at ${MAX_KEYWORDS} terms`, () => {
    // ⚠️ No digits in these fixtures. `tokenize` strips them, so "worda1" and
    // "worda2" would collapse to one token — which is the documented behaviour and
    // caught an earlier version of this very test generating 80 names that became
    // 26 tokens.
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    const many = letters.flatMap((a) => letters.slice(0, 4).map((b) => `word${a}${b}`));
    const text = many.join(" ");
    const out = orgVocabulary([{ text }, { text }], df({}), 50);
    expect(many.length).toBeGreaterThan(MAX_KEYWORDS);
    expect(new Set(many).size).toBe(many.length); // fixtures really are distinct
    expect(out.length).toBe(MAX_KEYWORDS);
  });

  it("is stable across runs — ties broken alphabetically", () => {
    const docs = [{ text: "alpha bravo" }, { text: "alpha bravo" }];
    const a = orgVocabulary(docs, df({ alpha: 2, bravo: 2 }), 50);
    const b = orgVocabulary(docs, df({ alpha: 2, bravo: 2 }), 50);
    expect(a).toEqual(b);
    expect(a).toEqual(["alpha", "bravo"]);
  });

  it("handles an org with no docs", () => {
    expect(orgVocabulary([], df({}), 50)).toEqual([]);
  });
});

describe("corpusDocumentFrequency", () => {
  it("⚠️ counts ORGS, not documents", () => {
    // One prolific partner must not define the industry baseline. Org A says
    // "hoodies" in three posts; that is still ONE org using the word.
    const byOrg = new Map([
      ["a", [{ text: "hoodies" }, { text: "hoodies" }, { text: "hoodies" }]],
      ["b", [{ text: "fleece" }]],
    ]);
    const out = corpusDocumentFrequency(byOrg);
    expect(out.get("hoodies")).toBe(1);
    expect(out.get("fleece")).toBe(1);
  });

  it("counts a term shared by two orgs as 2", () => {
    const byOrg = new Map([
      ["a", [{ text: "hoodies" }]],
      ["b", [{ text: "hoodies" }]],
    ]);
    expect(corpusDocumentFrequency(byOrg).get("hoodies")).toBe(2);
  });
});
