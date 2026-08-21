import { describe, expect, it } from "vitest";
import { computeOrgCompleteness, type OrgCompletenessSource } from "../completeness";
import {
  composePublication,
  compareBoothNumbers,
  conferenceDirectory,
  type DirectoryEntry,
  type Publication,
} from "../composition";

const completeness = (over: Partial<OrgCompletenessSource> = {}) =>
  computeOrgCompleteness({
    id: "o", name: "O", slug: "o", logo_url: "l", company_description: "d",
    primary_category: "Apparel", nacs_department: null, highlight_product_name: null,
    highlight_product_description: null, catalogue_url: null, partner_links: null,
    hero_image_url: null, contactCount: 1, ...over,
  } as OrgCompletenessSource);

const entry = (name: string, cats: string | null, booths: string[] = [], printReady = true): DirectoryEntry => ({
  orgId: name, orgName: name, orgSlug: name.toLowerCase(),
  logoUrl: null, description: null, featuredProduct: null, featuredProductDetail: null,
  catalogueUrl: null, rawCategories: cats, boothNumbers: booths,
  completeness: completeness(printReady ? {} : { logo_url: null }),
});

const pub = (over: Partial<Publication> = {}): Publication => ({
  id: "p", title: "Directory",
  source: { kind: "conference", conferenceId: "c" },
  selection: {},
  sections: [{ type: "listings", groupBy: "category" }],
  ...over,
});

describe("composePublication — selection", () => {
  it("keeps everything by default, thin listings included", () => {
    // A thin listing beats a missing one; completeness is chased in the gap
    // report, not silently at render time.
    const r = composePublication(pub(), [entry("A", "Apparel"), entry("B", "Books", [], false)]);
    expect(r.entries).toHaveLength(2);
    expect(r.notes.excludedAsNotPrintReady).toBe(0);
  });

  it("drops non-print-ready entries only when asked, and counts them", () => {
    const r = composePublication(
      pub({ selection: { printReadyOnly: true } }),
      [entry("A", "Apparel"), entry("B", "Books", [], false)]
    );
    expect(r.entries.map((e) => e.orgName)).toEqual(["A"]);
    expect(r.notes.excludedAsNotPrintReady).toBe(1);
  });

  it("filters by department and counts the exclusions", () => {
    const r = composePublication(
      pub({ selection: { departments: ["Apparel"] } }),
      [entry("A", "Apparel"), entry("B", "Books")]
    );
    expect(r.entries.map((e) => e.orgName)).toEqual(["A"]);
    expect(r.notes.excludedByDepartment).toBe(1);
  });

  it("matches a department reached only by an implied class", () => {
    // "Caps & Gowns" implies Graduation & Regalia — selecting the department
    // must still find it.
    const r = composePublication(
      pub({ selection: { departments: ["Graduation & Regalia"] } }),
      [entry("A", "Caps & Gowns")]
    );
    expect(r.entries).toHaveLength(1);
  });
});

describe("composePublication — never drop silently", () => {
  it("reports uncategorized entries and still prints them", () => {
    const r = composePublication(pub(), [entry("Sock Rocket", "General Merchandise")]);
    expect(r.notes.uncategorized).toEqual(["Sock Rocket"]);
    const listings = r.sections[0];
    expect(listings.type === "listings" && listings.groups.at(-1)?.heading).toBe("Uncategorized");
    expect(r.entries).toHaveLength(1);
  });

  it("surfaces off-taxonomy values for a human to re-map", () => {
    const r = composePublication(pub(), [entry("A", "Apparel, General Merchandise")]);
    expect(r.notes.unrecognizedCategories).toEqual(["General Merchandise"]);
  });

  it("counts every candidate it was given", () => {
    const r = composePublication(pub({ selection: { departments: ["Books"] } }), [
      entry("A", "Apparel"), entry("B", "Books"), entry("C", "Apparel"),
    ]);
    expect(r.notes.totalCandidates).toBe(3);
    expect(r.entries.length + r.notes.excludedByDepartment).toBe(3);
  });
});

describe("composePublication — sections", () => {
  it("lists an entry under every department it serves", () => {
    // A reader scanning "Apparel" should find everyone selling apparel, not
    // only those whose first category happened to be it.
    const r = composePublication(pub(), [entry("Multi", "Apparel, Books")]);
    const s = r.sections[0];
    if (s.type !== "listings") throw new Error("wrong section");
    expect(s.groups.map((g) => g.heading)).toEqual(["Apparel", "Books"]);
  });

  it("builds a booth index in numeric order, one row per booth", () => {
    const r = composePublication(
      pub({ sections: [{ type: "booth_index" }] }),
      [entry("Ookami", "Apparel", ["200", "202"]), entry("Small", "Books", ["7"])]
    );
    const s = r.sections[0];
    if (s.type !== "booth_index") throw new Error("wrong section");
    expect(s.booths.map((b) => b.booth)).toEqual(["7", "200", "202"]);
    expect(s.booths.filter((b) => b.entry.orgName === "Ookami")).toHaveLength(2);
  });

  it("omits empty departments from the category index", () => {
    const r = composePublication(pub({ sections: [{ type: "category_index" }] }), [entry("A", "Apparel")]);
    const s = r.sections[0];
    if (s.type !== "category_index") throw new Error("wrong section");
    expect(s.departments.map((d) => d.department)).toEqual(["Apparel"]);
  });

  it("orders map surfaces by level and can pick just one", () => {
    const surfaces = [
      { id: "b", name: "Upper", imageUrl: null, level: 2 },
      { id: "a", name: "Hall", imageUrl: null, level: 0 },
    ];
    const all = composePublication(pub({ sections: [{ type: "map" }] }), [], surfaces).sections[0];
    if (all.type !== "map") throw new Error("wrong section");
    expect(all.surfaces.map((s) => s.surface.name)).toEqual(["Hall", "Upper"]);

    const one = composePublication(pub({ sections: [{ type: "map", surfaceId: "b" }] }), [], surfaces).sections[0];
    if (one.type !== "map") throw new Error("wrong section");
    expect(one.surfaces.map((s) => s.surface.name)).toEqual(["Upper"]);
  });

  it("preserves section order as authored", () => {
    const r = composePublication(pub({
      sections: [{ type: "static", title: "Welcome", body: "hi" }, { type: "booth_index" }, { type: "category_index" }],
    }), [entry("A", "Apparel", ["1"])]);
    expect(r.sections.map((s) => s.type)).toEqual(["static", "booth_index", "category_index"]);
  });
});

describe("conferenceDirectory", () => {
  it("is a definition, not a pipeline — sections are data you can reorder", () => {
    const d = conferenceDirectory("conf-1", "CSC 2027");
    expect(d.sections.map((s) => s.type)).toEqual(["map", "category_index", "listings", "booth_index"]);
    const reordered: Publication = { ...d, sections: [...d.sections].reverse() };
    const r = composePublication(reordered, []);
    expect(r.sections.map((s) => s.type)).toEqual(["booth_index", "listings", "category_index", "map"]);
  });
});

describe("compareBoothNumbers", () => {
  it("sorts numerically, not lexically", () => {
    expect(["101", "7", "20"].sort(compareBoothNumbers)).toEqual(["7", "20", "101"]);
  });
});

describe("composePublication — map placements", () => {
  const surfaces = [
    { id: "hall", name: "Hall", imageUrl: "u", level: 0 },
    { id: "upper", name: "Upper", imageUrl: null, level: 1 },
  ];
  const placed = (label: string, surfaceId: string) => ({
    entityId: label, surfaceId, label, x: 0.1, y: 0.1, w: 0.05, h: 0.05, rotation: 0, orgName: null,
  });

  it("gives each surface only its own placements", () => {
    // One map page is one coordinate space — a booth from another floor drawn
    // here would land somewhere arbitrary on this plan.
    const r = composePublication(pub({ sections: [{ type: "map" }] }), [], surfaces,
      [placed("1", "hall"), placed("2", "upper")]);
    const s = r.sections[0];
    if (s.type !== "map") throw new Error("wrong section");
    expect(s.surfaces[0].placements.map((p) => p.label)).toEqual(["1"]);
    expect(s.surfaces[1].placements.map((p) => p.label)).toEqual(["2"]);
  });

  it("orders placements by booth number, numerically", () => {
    const r = composePublication(pub({ sections: [{ type: "map" }] }), [], [surfaces[0]],
      [placed("101", "hall"), placed("7", "hall"), placed("20", "hall")]);
    const s = r.sections[0];
    if (s.type !== "map") throw new Error("wrong section");
    expect(s.surfaces[0].placements.map((p) => p.label)).toEqual(["7", "20", "101"]);
  });
});
