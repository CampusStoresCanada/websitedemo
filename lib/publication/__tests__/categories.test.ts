import { describe, expect, it } from "vitest";
import {
  NACS_DEPARTMENTS,
  hasListableCategories,
  parseOrgCategories,
  primaryDepartment,
  splitStoredSelection,
} from "../categories";

describe("parseOrgCategories", () => {
  it("splits a comma-joined selection into departments and classes", () => {
    const r = parseOrgCategories("Apparel, Men's / Unisex, Women's");
    expect(r.departments).toEqual(["Apparel"]);
    expect(r.classes).toEqual(["Men's / Unisex", "Women's"]);
    expect(r.unrecognized).toEqual([]);
  });

  it("infers the department from a class, so a listing never vanishes", () => {
    // An org that picked only "Caps & Gowns" still belongs under the heading a
    // reader would look for it in.
    const r = parseOrgCategories("Caps & Gowns");
    expect(r.departments).toEqual(["Graduation & Regalia"]);
    expect(r.classes).toEqual(["Caps & Gowns"]);
  });

  it("normalises punctuation-only drift found in live data", () => {
    // "Men's/Unisex" and "Infant/Toddler" are real stored values — a missing
    // space must not read as a partner failing to pick anything.
    const r = parseOrgCategories("Apparel, Men's/Unisex, Infant/Toddler");
    expect(r.classes).toEqual(["Men's / Unisex", "Infant & Toddler"]);
    expect(r.unrecognized).toEqual([]);
  });

  it("reports genuinely legacy values instead of silently dropping them", () => {
    /**
     * These predate the taxonomy and need a human to re-map — surfacing them is
     * the point, since a print index has nowhere to file them.
     *
     * ⚠️ "Operations & Support" used to be the second example here and is now
     * ALIASED to "Store Operations", so it no longer belongs. The ones left are
     * the ones nobody can map without asking: "General Merchandise" spans most
     * of the taxonomy and "Other" says nothing at all. Aliasing those would be
     * guessing at what a real company sells, not renaming a known thing.
     */
    const r = parseOrgCategories("General Merchandise, Other");
    expect(r.departments).toEqual([]);
    expect(r.unrecognized).toEqual(["General Merchandise", "Other"]);
  });

  it("maps renamed legacy terms onto the current taxonomy", () => {
    /**
     * Six partners had NO valid department at all before these aliases — absent
     * from every category index: print directory, member map, conference
     * directory. Paying partners, unfindable by category, silently.
     */
    const r = parseOrgCategories("Apparel & Spirit Wear, Gifts & Collectibles, Print & Copy Services");
    expect(r.departments).toEqual([
      "Apparel",
      "Gifts & Promotional Products",
      "Store Services",
    ]);
    expect(r.unrecognized).toEqual([]);
  });

  it("keeps a mixed row's good terms while flagging the bad one", () => {
    const r = parseOrgCategories("Apparel, General Merchandise");
    expect(r.departments).toEqual(["Apparel"]);
    expect(r.unrecognized).toEqual(["General Merchandise"]);
  });

  it("emits taxonomy order, not selection order, so the index is stable", () => {
    const a = parseOrgCategories("Technology & Electronics, Apparel");
    const b = parseOrgCategories("Apparel, Technology & Electronics");
    expect(a.departments).toEqual(b.departments);
    expect(a.departments).toEqual(["Apparel", "Technology & Electronics"]);
  });

  it("de-duplicates a department named both directly and via a class", () => {
    const r = parseOrgCategories("Apparel, Headwear, Apparel");
    expect(r.departments).toEqual(["Apparel"]);
  });

  it("handles null, empty, and whitespace", () => {
    for (const v of [null, undefined, "", "   ", " , , "]) {
      expect(parseOrgCategories(v).departments).toEqual([]);
    }
  });
});

describe("hasListableCategories", () => {
  it("requires a real department, not just any text", () => {
    expect(hasListableCategories("Apparel")).toBe(true);
    expect(hasListableCategories("Headwear")).toBe(true); // implies Apparel
    expect(hasListableCategories("General Merchandise")).toBe(false);
    expect(hasListableCategories(null)).toBe(false);
  });

  it("accepts every department in the taxonomy", () => {
    for (const d of NACS_DEPARTMENTS) expect(hasListableCategories(d)).toBe(true);
  });
});

describe("compound legacy terms", () => {
  /**
   * ⛔ A compound label names TWO things and they now live in two departments.
   * Mapping it to one is a guess about what a company sells — the same objection
   * that stops "General Merchandise" being aliased at all. Crestar (Pilot pens)
   * was filed under Accessories alone, so a buyer filtering School Office & Lab
   * Supplies could not find them.
   */
  it("resolves both halves, not whichever came first", () => {
    const r = parseOrgCategories("Stationery & School Supplies");
    expect(r.departments).toEqual(["Accessories", "School Office & Lab Supplies"]);
    expect(r.classes).toEqual(["Stationery", "Office Supplies"]);
    expect(r.unrecognized).toEqual([]);
  });

  it("maps a compound to ONE department when both halves are the same thing", () => {
    /**
     * ⚠️ "Apparel & Spirit Wear" is clothing twice over — spirit wear is hoodies
     * and tees. It was briefly mapped to ["Apparel", "Spirit Items"], but
     * "Spirit Items" is a class of Gifts & Promotional Products meaning pennants
     * and mugs, so that filed a clothing vendor as a giftware supplier.
     *
     * A dual mapping is right only when the label genuinely names two
     * departments, as "Stationery & School Supplies" does.
     */
    const r = parseOrgCategories("Apparel & Spirit Wear");
    expect(r.departments).toEqual(["Apparel"]);
    expect(r.classes).toEqual([]);
  });

  it("still handles a plain one-to-one rename", () => {
    expect(parseOrgCategories("Print & Copy Services").departments).toEqual(["Store Services"]);
  });
});

describe("primaryDepartment", () => {
  /**
   * ⛔ SELECTION ORDER IS THE STORED INTENT. `CategoryEditor` treats position as
   * the primary and offers a "Make primary" control that reorders, so the first
   * term is what the partner chose. `parseOrgCategories().departments[0]` is
   * TAXONOMY order — right for a stable printed index, wrong for "what does this
   * company say it mainly sells". Nine of 79 live partners disagreed between the
   * two, and for some the system named a department they never picked first.
   */
  it("honours what the partner chose first, not taxonomy order", () => {
    // Accessories precedes Technology & Electronics in the taxonomy, so
    // departments[0] would answer Accessories here. The partner said otherwise.
    const raw = "Technology & Electronics, Accessories";
    expect(parseOrgCategories(raw).departments[0]).toBe("Accessories");
    expect(primaryDepartment(raw)).toBe("Technology & Electronics");
  });

  it("resolves a CLASS chosen first to its department", () => {
    // "Course Materials" is a class of Books — Ambassador and VitalSource both
    // lead with it, and a class is not a primary category.
    expect(primaryDepartment("Course Materials, Textbooks")).toBe("Books");
  });

  it("resolves a legacy label chosen first through its alias", () => {
    expect(primaryDepartment("Apparel & Spirit Wear, Gifts & Collectibles")).toBe("Apparel");
  });

  it("skips leading junk rather than giving up", () => {
    // A dead term first must not mean "no primary" — keep walking their list.
    expect(primaryDepartment("General Merchandise, Apparel")).toBe("Apparel");
  });

  it("is null when nothing resolves", () => {
    expect(primaryDepartment("General Merchandise, Other")).toBeNull();
    expect(primaryDepartment(null)).toBeNull();
  });
});

describe("splitStoredSelection", () => {
  /**
   * ⛔ THE PICKER'S TWO HALVES MUST AGREE. Legacy terms rendered as ordinary
   * primary/secondary badges while the checkbox list only knows current
   * vocabulary — so the top showed things the bottom could not, and the only way
   * to drop one was a × nobody would find. It is also why unrecognised terms
   * rode along on every save and produced double-vocabulary rows.
   */
  it("resolves a legacy term onto real controls", () => {
    // Agency 1008's actual stored value.
    const { selected, legacy } = splitStoredSelection(
      "Accessories, Gifts & Collectibles, Stationery & School Supplies, Gifts"
    );
    expect(legacy).toEqual([]);
    expect(selected).toContain("Accessories");
    expect(selected).toContain("Gifts & Promotional Products");
    expect(selected).toContain("School Office & Lab Supplies");
    // Every term now corresponds to something the editor can render.
    expect(selected.every((t) => t.length > 0)).toBe(true);
  });

  it("keeps what cannot be placed VISIBLE rather than disguised as a choice", () => {
    const { selected, legacy } = splitStoredSelection("Apparel, General Merchandise, Other");
    expect(selected).toEqual(["Apparel"]);
    expect(legacy).toEqual(["General Merchandise", "Other"]);
  });

  it("never expands a recognised class into its department", () => {
    /**
     * ⚠️ Position is the primary/secondary distinction, so adding "Apparel" in
     * front of a partner who chose only "Men's / Unisex" would silently change
     * what they said their primary was.
     */
    expect(splitStoredSelection("Men's / Unisex").selected).toEqual(["Men's / Unisex"]);
  });

  it("preserves selection order and de-duplicates", () => {
    const { selected } = splitStoredSelection("Technology & Electronics, Apparel, Apparel");
    expect(selected).toEqual(["Technology & Electronics", "Apparel"]);
  });

  it("is empty for an empty value", () => {
    expect(splitStoredSelection(null)).toEqual({ selected: [], legacy: [] });
  });
});
