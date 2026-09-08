import { describe, expect, it } from "vitest";
import { indexTopChoices, TOP_CHOICE_LIMIT, type TopChoice } from "../top-choices";

function choice(declaringOrgId: string, chosenOrgId: string, pickedOrder: number | null = null): TopChoice {
  return { declaringOrgId, declaringContactId: null, chosenOrgId, pickedOrder, declaredByContactId: null, chosenFrom: "browse" };
}

/** A delegate's own list — declaringContactId set. */
function personChoice(
  declaringOrgId: string,
  declaringContactId: string,
  chosenOrgId: string,
  pickedOrder: number | null = null
): TopChoice {
  return { declaringOrgId, declaringContactId, chosenOrgId, pickedOrder, declaredByContactId: null, chosenFrom: "browse" };
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

  it("exposes no way to ask how much they wanted one", () => {
    /**
     * ⛔ `rankOf` is gone on purpose. It returned tick order — which box was
     * clicked first on an alphabetical list — dressed up as a preference
     * ordering. Steve's spec is "choose in no order your top five Orgs to
     * meet", so the only fact is membership, and an API that implies otherwise
     * is a trap for whoever writes a query in eight months.
     */
    const lookup = indexTopChoices([choice("store", "vendor", 1)]);
    expect("rankOf" in lookup).toBe(false);
    expect(lookup.chose("store", "vendor")).toBe(true);
    expect(lookup.chose("store", "someone-else")).toBe(false);
  });

  it("lists an org's own picks in a stable order, unordered ones last", () => {
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

  it("keeps two colleagues' lists apart", () => {
    /**
     * The delegate side. Three buyers from one store legitimately want three
     * different sets of meetings — the apparel buyer and the course-materials
     * buyer are not choosing on behalf of each other, and one saving their five
     * must never appear in the other's list.
     */
    const lookup = indexTopChoices([
      personChoice("store", "shawn", "vendor-a", 1),
      personChoice("store", "anish", "vendor-b", 1),
    ]);
    expect(lookup.chosenByContact("shawn").map((c) => c.chosenOrgId)).toEqual(["vendor-a"]);
    expect(lookup.chosenByContact("anish").map((c) => c.chosenOrgId)).toEqual(["vendor-b"]);
    // Neither is the ORG's own list, which nobody at the store has made.
    expect(lookup.chosenBy("store")).toEqual([]);
  });

  it("counts a person's pick as their org having chosen, for org-level weighing", () => {
    // A vendor asking "did that store want us?" should see yes when one of its
    // buyers said so, even though the store itself never made a list.
    const lookup = indexTopChoices([personChoice("store", "shawn", "vendor-a")]);
    expect(lookup.chose("store", "vendor-a")).toBe(true);
  });

  it("holds the limit at five", () => {
    // The interface, the storage constraint and the copy all say "top 5".
    expect(TOP_CHOICE_LIMIT).toBe(5);
  });
});
