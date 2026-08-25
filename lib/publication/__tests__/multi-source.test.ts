import { describe, expect, it } from "vitest";
import { computeOrgCompleteness, type OrgCompletenessSource } from "../completeness";
import {
  composePublication,
  sourceKey,
  type DirectoryEntry,
  type Publication,
} from "../composition";
import { parsePublication } from "../store";

/**
 * The network book is four sections over three populations, which is the whole
 * reason sections carry their own source. Every failure guarded here produces a
 * plausible-looking book that is wrong — the worst kind, because it is only
 * discovered on paper.
 */
const entry = (orgId: string, orgName: string, over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  orgId, orgName, orgSlug: orgName.toLowerCase(),
  logoUrl: null, description: null, featuredProduct: null, featuredProductDetail: null,
  catalogueUrl: null, rawCategories: "Apparel, Headwear", boothNumbers: [],
  publicCode: `CODE${orgId}`, orgType: "Vendor Partner",
  city: null, province: null, website: null, orgPhone: null,
  institutionType: null, fte: null,
  primaryContact: null,
  contacts: [{ name: `${orgName} Person`, roleTitle: "Rep", email: "p@x.test", phone: "555" }],
  completeness: computeOrgCompleteness({
    id: orgId, name: orgName, slug: orgName, logo_url: "l", company_description: "d",
    primary_category: "Apparel", highlight_product_name: null,
    highlight_product_description: null, catalogue_url: null, partner_links: null,
    hero_image_url: null, contactCount: 1,
  } as OrgCompletenessSource),
  ...over,
});

const CONF = { kind: "conference", conferenceId: "c1" } as const;
const PARTNERS = { kind: "organizations", orgType: "Vendor Partner" } as const;
const MEMBERS = { kind: "organizations", orgType: "Member" } as const;

// Sock Rocket exhibits AND is a partner — the overlap the book has to handle.
const sockRocket = entry("o1", "Sock Rocket", { boothNumbers: ["101"] });
const quietPartner = entry("o2", "Quiet Partner");
const memberStore = entry("o3", "Acme College", { orgType: "Member", institutionType: "College", fte: 8000 });

const bySource = new Map<string, DirectoryEntry[]>([
  [sourceKey(CONF), [sockRocket]],
  [sourceKey(PARTNERS), [sockRocket, quietPartner]],
  [sourceKey(MEMBERS), [memberStore]],
]);

const book = (over: Partial<Publication> = {}): Publication => ({
  id: "p", title: "Network Directory",
  source: CONF,
  selection: { dedupeAcrossSections: true },
  sections: [
    { type: "listings", title: "Exhibitors", groupBy: "name", style: "full", source: CONF },
    { type: "listings", title: "Partners", groupBy: "name", style: "compact", source: PARTNERS },
    { type: "listings", title: "Members", groupBy: "name", style: "member", source: MEMBERS },
    { type: "people", title: "People" },
  ],
  ...over,
});

const namesIn = (doc: ReturnType<typeof composePublication>, title: string) => {
  const section = doc.sections.find((s) => s.title === title);
  if (section?.type !== "listings") throw new Error(`no listings section "${title}"`);
  return section.groups.flatMap((g) => g.entries.map((e) => e.orgName)).sort();
};

describe("sourceKey", () => {
  it("distinguishes the populations a book draws on", () => {
    expect(sourceKey(CONF)).not.toBe(sourceKey(PARTNERS));
    expect(sourceKey(PARTNERS)).not.toBe(sourceKey(MEMBERS));
  });

  it("treats includeInactive as a different population, not the same one", () => {
    // Otherwise a lapsed-member report and a directory would share a cache
    // entry and one of them would silently get the other's rows.
    expect(sourceKey({ kind: "organizations", orgType: "Member" }))
      .not.toBe(sourceKey({ kind: "organizations", orgType: "Member", includeInactive: true }));
  });
});

describe("each section lists its own population", () => {
  it("routes entries to the section that asked for them", () => {
    const doc = composePublication(book({ selection: {} }), bySource);
    expect(namesIn(doc, "Exhibitors")).toEqual(["Sock Rocket"]);
    expect(namesIn(doc, "Partners")).toEqual(["Quiet Partner", "Sock Rocket"]);
    expect(namesIn(doc, "Members")).toEqual(["Acme College"]);
  });

  it("falls back to the publication's source when a section names none", () => {
    const doc = composePublication(
      book({ sections: [{ type: "listings", title: "Exhibitors", groupBy: "name" }] }),
      bySource
    );
    expect(namesIn(doc, "Exhibitors")).toEqual(["Sock Rocket"]);
  });

  it("still accepts a plain array for a single-population directory", () => {
    // The conference directory and the one-org listing proof pass an array;
    // breaking that would break the exhibitor's own proof page.
    const doc = composePublication(
      { ...book(), sections: [{ type: "listings", title: "All", groupBy: "name" }] },
      [sockRocket, quietPartner]
    );
    expect(namesIn(doc, "All")).toEqual(["Quiet Partner", "Sock Rocket"]);
  });
});

describe("dedupeAcrossSections", () => {
  it("gives an exhibiting partner to the first section only", () => {
    // Without this, Sock Rocket prints twice — once in full, once compact,
    // pages apart — and the Partners section stops meaning "who isn't here".
    const doc = composePublication(book(), bySource);
    expect(namesIn(doc, "Exhibitors")).toEqual(["Sock Rocket"]);
    expect(namesIn(doc, "Partners")).toEqual(["Quiet Partner"]);
  });

  it("lists them in every section they qualify for when switched off", () => {
    const doc = composePublication(book({ selection: {} }), bySource);
    expect(namesIn(doc, "Partners")).toContain("Sock Rocket");
  });

  it("never drops an organisation entirely", () => {
    const doc = composePublication(book(), bySource);
    const listed = doc.sections.flatMap((s) =>
      s.type === "listings" ? s.groups.flatMap((g) => g.entries.map((e) => e.orgName)) : []
    );
    expect(listed.sort()).toEqual(["Acme College", "Quiet Partner", "Sock Rocket"]);
  });
});

describe("cross-referencing spans every population", () => {
  it("indexes everyone, including entries a later section was denied", () => {
    // The indexes are the way IN to the book. If they deduped too, a company
    // claimed by the Exhibitors section would be findable in one direction and
    // invisible in another.
    const doc = composePublication(
      book({ sections: [...book().sections, { type: "category_index", title: "By Category" }] }),
      bySource
    );
    const index = doc.sections.find((s) => s.type === "category_index");
    if (index?.type !== "category_index") throw new Error("no category index");
    const indexed = index.departments.flatMap((d) => d.entries.map((e) => e.orgName));
    expect([...new Set(indexed)].sort()).toEqual(["Acme College", "Quiet Partner", "Sock Rocket"]);
  });

  it("puts people from all three populations in one index", () => {
    const doc = composePublication(book(), bySource);
    const people = doc.sections.find((s) => s.type === "people");
    if (people?.type !== "people") throw new Error("no people section");
    expect(people.people.map((p) => p.orgName).sort())
      .toEqual(["Acme College", "Quiet Partner", "Sock Rocket"]);
  });

  it("counts an organisation in two populations once", () => {
    const doc = composePublication(book(), bySource);
    expect(doc.entries.filter((e) => e.orgName === "Sock Rocket")).toHaveLength(1);
  });
});

describe("notes stay honest across sources", () => {
  it("counts each population once, not once per section that reads it", () => {
    // People and the indexes re-read the same populations; without memoisation
    // the candidate count inflates and the exclusion counts become fiction.
    const doc = composePublication(book(), bySource);
    expect(doc.notes.totalCandidates).toBe(4); // 1 conference + 2 partners + 1 member
  });

  it("reports exclusions once when a filter drops the same org from two sources", () => {
    const doc = composePublication(
      book({ selection: { departments: ["Books"] } }),
      bySource
    );
    // Every fixture org is Apparel, so all four candidate rows are excluded —
    // once each, not once per section that looked at them.
    expect(doc.notes.excludedByDepartment).toBe(4);
    expect(doc.entries).toHaveLength(0);
  });
});

describe("stored section sources", () => {
  const row = (sections: unknown) => ({
    id: "p", name: "n", title: "T",
    source: { kind: "conference", conferenceId: "c1" },
    selection: { dedupeAcrossSections: true },
    sections,
  });

  it("round-trips a per-section source", () => {
    const parsed = parsePublication(row([
      { type: "listings", title: "Members", groupBy: "name", style: "member",
        source: { kind: "organizations", orgType: "Member" } },
    ]));
    expect(parsed?.rejected).toEqual([]);
    const section = parsed?.publication.sections[0];
    expect(section?.type === "listings" && section.source).toEqual({
      kind: "organizations", orgType: "Member", includeInactive: undefined,
    });
    expect(parsed?.publication.selection.dedupeAcrossSections).toBe(true);
  });

  it("rejects a section whose source is invalid rather than falling back", () => {
    // Falling back would print a whole section of the wrong population under a
    // heading claiming otherwise — unrecoverable once it is on paper.
    const parsed = parsePublication(row([
      { type: "listings", title: "Members", groupBy: "name", source: { kind: "nonsense" } },
    ]));
    expect(parsed?.publication.sections).toHaveLength(0);
    expect(parsed?.rejected.join(" ")).toContain("invalid source");
  });

  it("leaves a section with no source alone", () => {
    const parsed = parsePublication(row([{ type: "people", title: "People" }]));
    expect(parsed?.rejected).toEqual([]);
    const section = parsed?.publication.sections[0];
    expect(section?.type === "people" && section.source).toBeUndefined();
  });
});

describe("the uncategorized warning describes what actually prints", () => {
  const uncategorized = entry("o4", "No Categories", { rawCategories: null });

  const sourced = new Map<string, DirectoryEntry[]>([
    [sourceKey(PARTNERS), [uncategorized]],
    [sourceKey(MEMBERS), [memberStore]],
  ]);

  it("flags a partner who never picked a category", () => {
    // Grouped by category, so this one really does print under a heading
    // reading "Uncategorized" — which is the thing worth chasing before press.
    const doc = composePublication(
      book({ source: PARTNERS, sections: [
        { type: "listings", title: "Partners", groupBy: "category", style: "compact", source: PARTNERS },
      ] }),
      sourced
    );
    expect(doc.notes.uncategorized).toEqual(["No Categories"]);
  });

  it("does not flag a member store, which has nothing to categorise", () => {
    // A store doesn't sell, its section lists by name, and it never appears
    // under that heading. Counting it buried the real gaps under 52 false ones.
    const doc = composePublication(
      book({ source: MEMBERS, sections: [
        { type: "listings", title: "Members", groupBy: "name", style: "member", source: MEMBERS },
      ] }),
      sourced
    );
    expect(doc.notes.uncategorized).toEqual([]);
  });
});
