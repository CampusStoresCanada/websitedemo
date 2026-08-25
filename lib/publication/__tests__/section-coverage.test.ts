import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeOrgCompleteness, type OrgCompletenessSource } from "../completeness";
import { composePublication, type Publication, type PublicationSection } from "../composition";
import { toInDesignXml } from "../indesign";
import { parsePublication } from "../store";

/**
 * Every section type must be handled everywhere, or it disappears in silence.
 *
 * This caught a real gap: adding `people` to the model type-checked clean while
 * the browser renderer's switch had no case for it, so the section would have
 * rendered nothing — no error, no warning, just a missing chunk of the book.
 * That is precisely the failure the rest of this system is built to prevent, so
 * it gets a test rather than a convention.
 */
const ALL_SECTIONS: PublicationSection[] = [
  { type: "listings", groupBy: "category", title: "Exhibitors" },
  { type: "people", title: "People" },
  { type: "category_index", title: "By Category" },
  { type: "booth_index", title: "By Booth" },
  { type: "map", title: "Floor Plan" },
  { type: "ads", title: "Advertising", ads: [
    { size: "full", imageUrl: "https://x.test/a.png", advertiser: "Acme" },
    { size: "quarter" },
  ] },
  { type: "static", title: "Welcome", body: "Hello." },
];

const entry = () => ({
  orgId: "o1", orgName: "Acme", orgSlug: "acme", logoUrl: null,
  description: "d", featuredProduct: null, featuredProductDetail: null,
  catalogueUrl: null, rawCategories: "Apparel", boothNumbers: ["101"],
  publicCode: "AAAA0001", orgType: "Vendor Partner",
  city: "Ottawa", province: "ON", website: "acme.test", orgPhone: "555",
  institutionType: null, fte: null,
  primaryContact: { name: "Dana", roleTitle: "Sales", email: "d@a.test", phone: "555" },
  contacts: [{ name: "Dana Fox", roleTitle: "Sales", email: "d@a.test", phone: "555" }],
  completeness: computeOrgCompleteness({
    id: "o1", name: "Acme", slug: "acme", logo_url: "l", company_description: "d",
    primary_category: "Apparel", highlight_product_name: null,
    highlight_product_description: null, catalogue_url: null, partner_links: null,
    hero_image_url: null, contactCount: 1,
  } as OrgCompletenessSource),
});

const publication = (sections: PublicationSection[]): Publication => ({
  id: "p", title: "Directory",
  source: { kind: "conference", conferenceId: "c" },
  selection: {}, sections,
});

describe("every section type is handled end to end", () => {
  it("composes each one into a section of the same type", () => {
    const doc = composePublication(publication(ALL_SECTIONS), [entry()],
      [{ id: "s1", name: "Hall", imageUrl: "bg.svg", level: 0 }],
      [{ entityId: "b", surfaceId: "s1", label: "101", x: 0.1, y: 0.1, w: 0.05, h: 0.05, rotation: 0, orgName: "Acme" }]);
    expect(doc.sections.map((s) => s.type)).toEqual(ALL_SECTIONS.map((s) => s.type));
  });

  it("emits content for each one in the InDesign XML", () => {
    for (const section of ALL_SECTIONS) {
      const doc = composePublication(publication([section]), [entry()],
        [{ id: "s1", name: "Hall", imageUrl: "bg.svg", level: 0 }],
        [{ entityId: "b", surfaceId: "s1", label: "101", x: 0.1, y: 0.1, w: 0.05, h: 0.05, rotation: 0, orgName: "Acme" }]);
      const xml = toInDesignXml(doc);
      // More than an empty <Section> wrapper — something actually inside it.
      const body = xml.slice(xml.indexOf("<Section"), xml.lastIndexOf("</Section>"));
      expect(body.split("\n").length, `${section.type} emitted nothing`).toBeGreaterThan(3);
    }
  });

  it("survives a round trip through saved storage", () => {
    const parsed = parsePublication({
      id: "p", name: "n", title: "Directory",
      source: { kind: "conference", conferenceId: "c" },
      selection: {},
      sections: JSON.parse(JSON.stringify(ALL_SECTIONS)),
    });
    expect(parsed?.rejected).toEqual([]);
    expect(parsed?.publication.sections.map((s) => s.type)).toEqual(ALL_SECTIONS.map((s) => s.type));
  });

  it("is rendered by the browser view — no silently-missing section", () => {
    // Source-level check rather than a DOM render: the component is a server
    // component and vitest has no DOM, but a missing `case` is exactly what
    // needs catching, and that is visible in the source.
    const source = readFileSync("components/publication/PublicationView.tsx", "utf8");
    for (const section of ALL_SECTIONS) {
      expect(source, `PublicationView has no case for "${section.type}"`)
        .toContain(`case "${section.type}":`);
    }
  });
});

describe("empty sections", () => {
  const source = readFileSync("components/publication/PublicationView.tsx", "utf8");

  it("are marked so print can drop them, while screen still explains itself", () => {
    // A printed page reading "People — Nobody listed" is a defect; the same
    // words on screen tell an admin the consent answers have not arrived.
    expect(source).toContain("pub-section--empty");
    expect(source).toContain(".pub-section--empty { display: none; }");
    expect(source).toContain("Nobody listed.");
  });

  it("classifies every section type, so a new one cannot slip through as never-empty", () => {
    const fn = source.slice(source.indexOf("function isEmptySection"), source.indexOf("function Section("));
    for (const t of ["listings", "people", "category_index", "booth_index", "map", "static"]) {
      expect(fn, `isEmptySection has no case for "${t}"`).toContain(`case "${t}":`);
    }
  });
});
