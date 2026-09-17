import { describe, expect, it } from "vitest";
import { computeOrgCompleteness, PUBLICATION_FIELDS, type OrgCompletenessSource } from "../completeness";
import { listingStyleForOrgType } from "../composition";

/**
 * Measured 2026-09-16 across the 80 active member stores: scoring judged every
 * org against the vendor listing, so 80 of 80 failed on `categories` and 79 on
 * `description`. A MemberListing emits neither — it carries name, location,
 * institution type, FTE, website, phone and staff. Every member store's org
 * page therefore told its owner to fix something that was never going to print.
 */
const base: OrgCompletenessSource = {
  id: "o1", name: "Algonquin College", slug: "algonquin-college", type: "Member",
  logo_url: "https://example.test/logo.png", company_description: null, primary_category: null,
  city: "Ottawa", province: "ON", website: "https://example.test", phone: "613-555-0100",
  email: null, public_contact_confirmed_at: null, fte: 20169, public_code: "AC",
  highlight_product_name: null, highlight_product_description: null,
  catalogue_url: null, partner_links: null, hero_image_url: null,
  contactCount: 3,
} as unknown as OrgCompletenessSource;

describe("a member store is scored on what a MemberListing prints", () => {
  it("does not ask a member store for the fields a MemberListing never emits", () => {
    const r = computeOrgCompleteness(base, "member");
    const asked = r.fields.map((f) => f.key);
    for (const vendorOnly of ["categories", "description", "catalogue", "featured_product", "hero"]) {
      expect(asked, `member listing does not print ${vendorOnly}`).not.toContain(vendorOnly);
    }
  });

  it("DOES ask for a logo, because assetsXml emits one for every style", () => {
    // Only the QR is style-gated (styleShowsQr). Assuming logo was vendor-only
    // would have hidden a real print gap from 14 of the 80 member stores.
    expect(computeOrgCompleteness(base, "member").fields.map((f) => f.key)).toContain("logo");
    expect(computeOrgCompleteness({ ...base, logo_url: null }, "member").missing).toContain("logo");
  });

  it("is print-ready with no description and no categories", () => {
    // The exact shape of all 80: none of them has categories set, 79 of 80 no
    // description. Neither is printed, so neither blocks.
    const r = computeOrgCompleteness(base, "member");
    expect(r.missing).toEqual([]);
    expect(r.isPrintReady).toBe(true);
  });

  it("still catches the things that DO print for a member", () => {
    const r = computeOrgCompleteness({ ...base, website: null, contactCount: 0 }, "member");
    expect(r.missing).toContain("website");
    expect(r.missing).toContain("contacts");
    expect(r.isPrintReady).toBe(false); // contacts is required in every style
  });

  it("leaves the vendor listing scored exactly as before", () => {
    const vendor = computeOrgCompleteness({ ...base, type: "Vendor Partner" }, "full");
    expect(vendor.missing).toContain("categories");
    expect(vendor.missing).toContain("description");
    // and never asks a vendor for the member-only fields
    expect(vendor.fields.map((f) => f.key)).not.toContain("org_phone");
  });

  it("routes org types to the listing block they actually print in", () => {
    expect(listingStyleForOrgType("Member")).toBe("member");
    expect(listingStyleForOrgType("Vendor Partner")).toBe("full");
    expect(listingStyleForOrgType(null)).toBe("full");
  });

  it("gives every member-only field a recorded reason for having no nudge", () => {
    // There is no member onboarding journey, so these cannot be scheduled.
    for (const f of PUBLICATION_FIELDS.filter((f) => !f.styles.includes("full"))) {
      expect(f.unnudgedBecause, `${f.key}`).toBeTruthy();
    }
  });
});
