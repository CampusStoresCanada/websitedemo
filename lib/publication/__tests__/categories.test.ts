import { describe, expect, it } from "vitest";
import { NACS_DEPARTMENTS, hasListableCategories, parseOrgCategories } from "../categories";

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
    // These predate the taxonomy and need a human to re-map — surfacing them is
    // the point, since a print index has nowhere to file them.
    const r = parseOrgCategories("General Merchandise, Operations & Support");
    expect(r.departments).toEqual([]);
    expect(r.unrecognized).toEqual(["General Merchandise", "Operations & Support"]);
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
