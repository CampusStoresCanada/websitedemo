import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeOrgCompleteness, type OrgCompletenessSource } from "../completeness";
import {
  composePublication,
  type DirectoryEntry,
  type ListingStyle,
  type Publication,
} from "../composition";
import { toInDesignXml } from "../indesign";

/**
 * The three listing shapes must actually differ.
 *
 * A style that silently falls through to "full" type-checks perfectly and looks
 * fine in review — you only find out when 52 member listings print a booth
 * number and a conference special they never had. So each style is asserted on
 * what it emits AND on what it must not.
 */
const entry = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  orgId: "o1", orgName: "Acme College", orgSlug: "acme",
  logoUrl: "https://x.test/l.png", description: "We sell things.",
  featuredProduct: "Show Special", featuredProductDetail: "20% off",
  catalogueUrl: "https://x.test/cat.pdf", rawCategories: "Apparel, Headwear",
  boothNumbers: ["101"], publicCode: "AAAA0001", orgType: "Member",
  city: "Hamilton", province: "ON", website: "https://acme.test", orgPhone: "905-555-0100",
  publicEmail: null, publicPhone: null, institutionType: "University", fte: 24500,
  primaryContact: { name: "Dana Fox", roleTitle: "Manager", email: "d@a.test", phone: "555" },
  contacts: [
    { name: "Dana Fox", roleTitle: "Manager", email: "d@a.test", phone: "555" },
    { name: "Sam Reed", roleTitle: "Buyer", email: "s@a.test", phone: "556" },
  ],
  completeness: computeOrgCompleteness({
    id: "o1", name: "Acme College", slug: "acme", logo_url: "l",
    company_description: "d", primary_category: "Apparel",
    highlight_product_name: null, highlight_product_description: null,
    catalogue_url: null, partner_links: null, hero_image_url: null, contactCount: 2,
  } as OrgCompletenessSource),
  ...over,
});

const xmlFor = (style: ListingStyle, over: Partial<DirectoryEntry> = {}) => {
  const publication: Publication = {
    id: "p", title: "Network Directory",
    source: { kind: "organizations", orgType: "Member" },
    selection: {},
    sections: [{ type: "listings", groupBy: "name", title: "Members", style }],
  };
  return toInDesignXml(composePublication(publication, [entry(over)]));
};

describe("InDesign XML — full", () => {
  it("carries the selling fields an exhibitor needs", () => {
    const xml = xmlFor("full");
    for (const t of ["OrgName", "BoothNumber", "Description", "FeaturedProduct", "Catalogue"]) {
      expect(xml, t).toContain(`<${t}>`);
    }
  });
});

describe("InDesign XML — compact", () => {
  it("keeps identity and categories so a partner stays findable", () => {
    const xml = xmlFor("compact");
    expect(xml).toContain("<CompactListing");
    expect(xml).toContain("<OrgName>Acme College</OrgName>");
    expect(xml).toContain("<Classes>");
    expect(xml).toContain("<ContactName>Dana Fox</ContactName>");
  });

  it("drops the conference-specific selling", () => {
    // A partner who isn't exhibiting has no booth and no show special. Emitting
    // last year's would be worse than emitting nothing.
    const xml = xmlFor("compact");
    expect(xml).not.toContain("<BoothNumber>");
    expect(xml).not.toContain("<FeaturedProduct>");
    expect(xml).not.toContain("<FeaturedDetail>");
  });
});

describe("InDesign XML — member", () => {
  it("describes the store: where, how big, who works there", () => {
    const xml = xmlFor("member");
    expect(xml).toContain("<MemberListing");
    expect(xml).toContain("<MemberName>Acme College</MemberName>");
    expect(xml).toContain("<Location>Hamilton, ON</Location>");
    expect(xml).toContain("<InstitutionType>University</InstitutionType>");
    expect(xml).toContain("<FTE>24500</FTE>");
    expect(xml).toContain("<StaffName>Sam Reed</StaffName>");
    expect(xml).toContain("<StaffRole>Buyer</StaffRole>");
  });

  it("omits everything a store does not sell", () => {
    const xml = xmlFor("member");
    for (const t of ["Description", "FeaturedProduct", "Catalogue", "Classes", "BoothNumber"]) {
      expect(xml, `member listing must not emit ${t}`).not.toContain(`<${t}>`);
    }
  });

  it("omits FTE entirely when unknown rather than printing zero", () => {
    // `fte` is null for the 0 members missing one today, but the field is
    // free-form upstream — a hollow tag would style as a blank line, and "0"
    // would be a factual claim about the store's size.
    const xml = xmlFor("member", { fte: null, institutionType: null });
    expect(xml).not.toContain("<FTE>");
    expect(xml).not.toContain("<InstitutionType>");
    expect(xml).toContain("<MemberName>");
  });

  it("still emits its own tag set when the org has no staff listed", () => {
    const xml = xmlFor("member", { contacts: [] });
    expect(xml).toContain("<MemberListing");
    expect(xml).not.toContain("<Staff>");
  });
});

describe("the three shapes are genuinely distinct", () => {
  it("produces different XML per style from identical data", () => {
    const [full, compact, member] = (["full", "compact", "member"] as const).map((s) => xmlFor(s));
    expect(full).not.toBe(compact);
    expect(compact).not.toBe(member);
    expect(full).not.toBe(member);
  });

  it("stays well-formed in every shape", () => {
    for (const style of ["full", "compact", "member"] as const) {
      const xml = xmlFor(style);
      const stack: string[] = [];
      const tagRe = /<(\/?)([A-Za-z][\w.-]*)([^>]*?)(\/?)>/g;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(xml)) !== null) {
        const [, closing, name, , selfClosing] = m;
        if (selfClosing) continue;
        if (closing) expect(stack.pop(), `${style}: </${name}> closes the wrong element`).toBe(name);
        else stack.push(name);
      }
      expect(stack, `${style}: unclosed elements`).toEqual([]);
    }
  });

  it("is branched on by the browser renderer too, not just the XML", () => {
    // Source-level, for the same reason as section-coverage: a server component
    // with no DOM under vitest. A style the renderer never checks for would
    // fall through to the full card and print booth numbers on member stores.
    const source = readFileSync("components/publication/PublicationView.tsx", "utf8");
    expect(source).toContain('style === "member"');
    expect(source).toContain('style === "compact"');
  });
});

describe("QR codes belong to the selling listings only", () => {
  it("emits a code for exhibitors and partners", () => {
    expect(xmlFor("full")).toContain("<QRCode");
    expect(xmlFor("compact")).toContain("<QRCode");
  });

  it("emits none for a member store", () => {
    // The code resolves to a live page for reaching a seller and eventually
    // ordering. A member store is not selling to the person holding the book,
    // so a code there is paper and print spent on nothing.
    expect(xmlFor("member")).not.toContain("<QRCode");
  });

  it("still emits the logo for a member store", () => {
    // Only the QR is style-dependent — dropping the logo too would be a
    // different decision nobody made.
    expect(xmlFor("member")).toContain("<Logo");
  });

  it("is enforced in the browser renderer as well", () => {
    const source = readFileSync("components/publication/PublicationView.tsx", "utf8");
    expect(source).toContain("styleShowsQr(style)");
  });
});
