/**
 * Structured XML export for Adobe InDesign.
 *
 * The browser renderer is the online directory and the always-works baseline.
 * The printed book is typeset in InDesign, because doing that properly — real
 * typography, facing pages, a designer's eye — is not a thing to reimplement in
 * CSS. This is the bridge: the same composed publication, emitted as tagged XML
 * that InDesign imports into its Structure pane.
 *
 * ── Why tag names look like style names ────────────────────────────────────
 * Every tag is named as the paragraph or character style it should become
 * (`OrgName`, `BoothNumber`, `CategoryHeading`). InDesign's "Map Tags to
 * Styles" matches by name, so a designer sets the mapping up once and every
 * later export drops straight in. Tags named after data (`field_3`) would mean
 * re-mapping by hand every year.
 *
 * ── Re-import, not re-typeset ──────────────────────────────────────────────
 * Output is deterministic: the same composition emits the same bytes in the
 * same order. That is what makes "the content changed, re-import it" a real
 * workflow rather than a fresh layout job each year.
 */

import { styleShowsQr } from "./composition";
import type { ComposedEntry, ComposedPublication, ComposedSection, ListingStyle } from "./composition";

/**
 * XML 1.0 forbids most control characters outright. One pasted in from Word
 * inside a company description invalidates the entire document, so they are
 * stripped before anything else runs.
 */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/**
 * XML 1.0 escaping.
 *
 * Not optional decoration: 28 of the live category values contain an ampersand
 * ("Gifts & Promotional Products"), as do company names like "Cutter & Buck".
 * Unescaped, most of the file fails to parse and InDesign rejects the import
 * with an error pointing at a line number rather than a cause.
 */
export function escapeXml(value: string): string {
  return value
    .replace(CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const tag = (name: string, value: string | null | undefined, indent: string): string =>
  value && value.trim() ? `${indent}<${name}>${escapeXml(value.trim())}</${name}>\n` : "";

const attr = (name: string, value: string | null | undefined): string =>
  value && value.trim() ? ` ${name}="${escapeXml(value.trim())}"` : "";

/**
 * One listing, shaped to its style.
 *
 * The shapes emit *different tag sets*, not the same tags with empty values —
 * that is the whole point on this side. A designer maps `MemberName` to a
 * different paragraph style than `OrgName`, and a member listing that emitted
 * a hollow `<FeaturedProduct/>` would style as a blank paragraph in the layout
 * and have to be cleaned out of 52 listings by hand.
 */
function listingXml(entry: ComposedEntry, indent: string, style: ListingStyle): string {
  const inner = `${indent}  `;
  const contactXml = (): string => {
    if (!entry.primaryContact) return "";
    let c = `${inner}<Contact>\n`;
    c += tag("ContactName", entry.primaryContact.name, `${inner}  `);
    c += tag("ContactRole", entry.primaryContact.roleTitle, `${inner}  `);
    c += tag("ContactPhone", entry.primaryContact.phone, `${inner}  `);
    c += tag("ContactEmail", entry.primaryContact.email, `${inner}  `);
    c += `${inner}</Contact>\n`;
    return c;
  };
  // Images are referenced, not embedded. InDesign relinks by path, and a
  // designer needs control over placement and cropping regardless.
  const assetsXml = (): string => {
    let a = "";
    if (entry.logoUrl) a += `${inner}<Logo${attr("href", entry.logoUrl)}/>\n`;
    if (entry.publicCode && styleShowsQr(style)) {
      a += `${inner}<QRCode${attr("code", entry.publicCode)}${attr("href", `qr/${entry.publicCode}.svg`)}/>\n`;
    }
    return a;
  };
  const location = [entry.city, entry.province].filter(Boolean).join(", ");

  if (style === "member") {
    let out = `${indent}<MemberListing${attr("code", entry.publicCode)}>\n`;
    out += tag("MemberName", entry.orgName, inner);
    out += tag("Location", location, inner);
    out += tag("InstitutionType", entry.institutionType, inner);
    // A number, not a string: emitted only when present, so "0 FTE" never
    // prints for a store whose headcount simply isn't recorded.
    if (typeof entry.fte === "number") out += tag("FTE", String(entry.fte), inner);
    out += tag("Website", entry.website, inner);
    out += tag("OrgPhone", entry.orgPhone, inner);
    // Every listable person, not just the primary — a store's staff IS its
    // listing. Reach details are carried by the People section.
    for (const person of entry.contacts) {
      out += `${inner}<Staff>\n`;
      out += tag("StaffName", person.name, `${inner}  `);
      out += tag("StaffRole", person.roleTitle, `${inner}  `);
      out += `${inner}</Staff>\n`;
    }
    out += assetsXml();
    out += `${indent}</MemberListing>\n`;
    return out;
  }

  const compact = style === "compact";
  let out = `${indent}<${compact ? "CompactListing" : "Listing"}${attr("code", entry.publicCode)}>\n`;
  out += tag("OrgName", entry.orgName, inner);
  if (!compact && entry.boothNumbers.length > 0) {
    out += tag("BoothNumber", entry.boothNumbers.join(", "), inner);
  }
  out += tag("Description", entry.description, inner);
  out += tag("Location", location, inner);
  out += tag("Website", entry.website, inner);
  out += tag("OrgPhone", entry.orgPhone, inner);
  // "Featured" means a conference special; a partner who isn't exhibiting has
  // none, so the compact shape omits it rather than printing last year's.
  if (!compact) {
    out += tag("FeaturedProduct", entry.featuredProduct, inner);
    out += tag("FeaturedDetail", entry.featuredProductDetail, inner);
  }
  if (entry.classes.length > 0) out += tag("Classes", entry.classes.join(" · "), inner);
  out += contactXml();
  out += tag("Catalogue", entry.catalogueUrl, inner);
  out += assetsXml();
  out += `${indent}</${compact ? "CompactListing" : "Listing"}>\n`;
  return out;
}

function sectionXml(section: ComposedSection, indent: string): string {
  const inner = `${indent}  `;
  const style = section.type === "listings" ? attr("style", section.style) : "";
  let out = `${indent}<Section${attr("type", section.type)}${style}>\n`;
  out += tag("SectionTitle", section.title, inner);

  switch (section.type) {
    case "listings":
      for (const group of section.groups) {
        out += `${inner}<Group>\n`;
        out += tag("CategoryHeading", group.heading, `${inner}  `);
        for (const entry of group.entries) out += listingXml(entry, `${inner}  `, section.style);
        out += `${inner}</Group>\n`;
      }
      break;

    case "category_index":
      for (const dept of section.departments) {
        out += `${inner}<IndexGroup>\n`;
        out += tag("IndexHeading", dept.department, `${inner}  `);
        for (const entry of dept.entries) {
          out += `${inner}  <IndexEntry>\n`;
          out += tag("IndexName", entry.orgName, `${inner}    `);
          if (entry.boothNumbers.length > 0) {
            out += tag("IndexBooth", entry.boothNumbers.join(", "), `${inner}    `);
          }
          out += `${inner}  </IndexEntry>\n`;
        }
        out += `${inner}</IndexGroup>\n`;
      }
      break;

    case "booth_index":
      for (const row of section.booths) {
        out += `${inner}<BoothRow>\n`;
        out += tag("BoothNumber", row.booth, `${inner}  `);
        out += tag("IndexName", row.entry.orgName, `${inner}  `);
        out += `${inner}</BoothRow>\n`;
      }
      break;

    case "map":
      for (const { surface, placements } of section.surfaces) {
        out += `${inner}<FloorPlan${attr("name", surface.name)}${attr("href", surface.imageUrl)}>\n`;
        for (const p of placements) {
          // Fractional coordinates travel intact: the designer scales the
          // background to any size and the booths still land correctly.
          out += `${inner}  <Booth${attr("label", p.label)}${attr("org", p.orgName)}` +
            ` x="${p.x}" y="${p.y}" w="${p.w}" h="${p.h}" rotation="${p.rotation}"/>\n`;
        }
        out += `${inner}</FloorPlan>\n`;
      }
      break;

    case "people":
      for (const person of section.people) {
        out += `${inner}<Person>\n`;
        out += tag("PersonName", person.name, `${inner}  `);
        out += tag("PersonRole", person.roleTitle, `${inner}  `);
        out += tag("PersonPhone", person.phone, `${inner}  `);
        out += tag("PersonEmail", person.email, `${inner}  `);
        out += tag("PersonOrg", person.orgName, `${inner}  `);
        // A code, not a page number: InDesign paginates, so it builds the
        // "see p. 14" cross-reference from this identity.
        if (person.orgCode) out += `${inner}  <OrgRef${attr("code", person.orgCode)}/>\n`;
        out += `${inner}</Person>\n`;
      }
      break;

    case "ads":
      for (const ad of section.ads) {
        // Emitted even when unsold, carrying `sold="false"`. The designer needs
        // the reserved space in the flow to lay the book out; an omitted slot
        // silently changes the page count.
        out += `${inner}<Advertisement${attr("size", ad.size)}${attr("advertiser", ad.advertiser)}` +
          `${ad.imageUrl ? attr("href", ad.imageUrl) : ""} sold="${ad.imageUrl ? "true" : "false"}"/>\n`;
      }
      break;

    case "static":
      out += tag("BodyText", section.body, inner);
      break;
  }

  out += `${indent}</Section>\n`;
  return out;
}

/** The whole publication as InDesign-importable XML. */
export function toInDesignXml(doc: ComposedPublication): string {
  let out = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  out += `<Directory${attr("title", doc.title)} listings="${doc.entries.length}">\n`;
  for (const section of doc.sections) out += sectionXml(section, "  ");
  out += `</Directory>\n`;
  return out;
}

/** Download filename, dated so successive exports do not overwrite. */
export function inDesignFilename(doc: ComposedPublication, isoDate: string): string {
  const slug = doc.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug}-${isoDate.slice(0, 10)}.xml`;
}
