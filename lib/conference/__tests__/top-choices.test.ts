import { describe, expect, it } from "vitest";
import { indexTopChoices, TOP_CHOICE_LIMIT, type TopChoice } from "../top-choices";

function choice(declaringOrgId: string, chosenOrgId: string, rank: number | null = null): TopChoice {
  return { declaringOrgId, chosenOrgId, rank, declaredByContactId: null };
}

describe("indexTopChoices", () => {
  it("reports a one-way choice as chosen but NOT mutual", () => {
    const lookup = indexTopChoices([choice("store", "vendor")]);
    expect(lookup.chose("store", "vendor")).toBe(true);
    expect(lookup.chose("vendor", "store")).toBe(false);
    expect(lookup.mutual("store", "vendor")).toBe(false);
  });

  it("reports a two-way choice as mutual from either side", () => {
    /**
     * The reason both directions live in one table. A store wanting to meet a
     * vendor is a signal; both wanting to meet each other is a much stronger
     * one, and it is invisible unless you can see both halves at once.
     */
    const lookup = indexTopChoices([choice("store", "vendor"), choice("vendor", "store")]);
    expect(lookup.mutual("store", "vendor")).toBe(true);
    expect(lookup.mutual("vendor", "store")).toBe(true);
  });

  it("keeps rank per direction — they need not agree", () => {
    // A store's first pick may rank that store third on the vendor's own list.
    const lookup = indexTopChoices([choice("store", "vendor", 1), choice("vendor", "store", 3)]);
    expect(lookup.rankOf("store", "vendor")).toBe(1);
    expect(lookup.rankOf("vendor", "store")).toBe(3);
  });

  it("returns null rank for an unranked choice, and for one never made", () => {
    // Unranked is a real state: being in the five is the signal, ordering is a
    // bonus. Both read as null, and a caller must not treat null as "last".
    const lookup = indexTopChoices([choice("store", "vendor")]);
    expect(lookup.rankOf("store", "vendor")).toBeNull();
    expect(lookup.rankOf("store", "someone-else")).toBeNull();
    expect(lookup.chose("store", "someone-else")).toBe(false);
  });

  it("lists an org's own picks in rank order, unranked last", () => {
    const lookup = indexTopChoices([
      choice("store", "third", 3),
      choice("store", "unranked"),
      choice("store", "first", 1),
    ]);
    expect(lookup.chosenBy("store").map((c) => c.chosenOrgId)).toEqual([
      "first",
      "third",
      "unranked",
    ]);
  });

  it("returns an empty list for an org that chose nobody", () => {
    expect(indexTopChoices([]).chosenBy("store")).toEqual([]);
  });

  it("holds the limit at five", () => {
    // The interface, the storage constraint and the copy all say "top 5".
    expect(TOP_CHOICE_LIMIT).toBe(5);
  });
});
