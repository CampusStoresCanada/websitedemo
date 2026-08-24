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

import type { ComposedEntry, ComposedPublication, ComposedSection } from "./composition";

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

function listingXml(entry: ComposedEntry, indent: string): string {
  const inner = `${indent}  `;
  let out = `${indent}<Listing${attr("code", entry.publicCode)}>\n`;
  out += tag("OrgName", entry.orgName, inner);
  if (entry.boothNumbers.length > 0) out += tag("BoothNumber", entry.boothNumbers.join(", "), inner);
  out += tag("Description", entry.description, inner);
  out += tag("FeaturedProduct", entry.featuredProduct, inner);
  out += tag("FeaturedDetail", entry.featuredProductDetail, inner);
  if (entry.classes.length > 0) out += tag("Classes", entry.classes.join(" · "), inner);
  if (entry.primaryContact) {
    out += `${inner}<Contact>\n`;
    out += tag("ContactName", entry.primaryContact.name, `${inner}  `);
    out += tag("ContactRole", entry.primaryContact.roleTitle, `${inner}  `);
    out += tag("ContactPhone", entry.primaryContact.phone, `${inner}  `);
    out += tag("ContactEmail", entry.primaryContact.email, `${inner}  `);
    out += `${inner}</Contact>\n`;
  }
  out += tag("Catalogue", entry.catalogueUrl, inner);
  // Images are referenced, not embedded. InDesign relinks by path, and a
  // designer needs control over placement and cropping regardless.
  if (entry.logoUrl) out += `${inner}<Logo${attr("href", entry.logoUrl)}/>\n`;
  if (entry.publicCode) {
    out += `${inner}<QRCode${attr("code", entry.publicCode)}${attr("href", `qr/${entry.publicCode}.svg`)}/>\n`;
  }
  out += `${indent}</Listing>\n`;
  return out;
}

function sectionXml(section: ComposedSection, indent: string): string {
  const inner = `${indent}  `;
  let out = `${indent}<Section${attr("type", section.type)}>\n`;
  out += tag("SectionTitle", section.title, inner);

  switch (section.type) {
    case "listings":
      for (const group of section.groups) {
        out += `${inner}<Group>\n`;
        out += tag("CategoryHeading", group.heading, `${inner}  `);
        for (const entry of group.entries) out += listingXml(entry, `${inner}  `);
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
