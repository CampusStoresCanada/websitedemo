import { describe, expect, it } from "vitest";
import {
  PUBLICATION_FIELDS,
  computeOrgCompleteness,
  isFieldFilled,
  summarizeCompleteness,
  type OrgCompletenessSource,
} from "../completeness";

const blank: OrgCompletenessSource = {
  id: "org-1",
  name: "Blank Co",
  slug: "blank-co",
  logo_url: null,
  company_description: null,
  primary_category: null,
  highlight_product_name: null,
  highlight_product_description: null,
  catalogue_url: null,
  partner_links: null,
  hero_image_url: null,
  contactCount: 0,
};

const printable: OrgCompletenessSource = {
  ...blank,
  id: "org-2",
  name: "Printable Co",
  logo_url: "https://example.test/logo.png",
  company_description: "We make things.",
  primary_category: "Apparel",
  contactCount: 2,
};

describe("isFieldFilled", () => {
  it("treats whitespace-only text as empty", () => {
    expect(isFieldFilled("description", { ...blank, company_description: "   " })).toBe(false);
    expect(isFieldFilled("description", { ...blank, company_description: "x" })).toBe(true);
  });

  it("reads categories from the partner's own NACS selections", () => {
    // primary_category IS the selection of record — a comma-joined list of
    // taxonomy labels, not free text. The AI-computed nacs_department is
    // deliberately not consulted: a machine filled it in for all 78 partners.
    expect(isFieldFilled("categories", { ...blank, primary_category: "Apparel, Men's / Unisex" })).toBe(true);
    expect(isFieldFilled("categories", blank)).toBe(false);
  });

  it("counts a class alone as listable via its implied department", () => {
    expect(isFieldFilled("categories", { ...blank, primary_category: "Caps & Gowns" })).toBe(true);
  });

  it("does not count legacy off-taxonomy values as categories", () => {
    // Real live values predating this taxonomy — they need a human to re-map,
    // and must not read as "this partner picked a category".
    expect(isFieldFilled("categories", { ...blank, primary_category: "General Merchandise" })).toBe(false);
    expect(isFieldFilled("categories", { ...blank, primary_category: "Operations & Support" })).toBe(false);
  });

  it("accepts either a catalogue URL or non-empty partner_links", () => {
    expect(isFieldFilled("catalogue", blank)).toBe(false);
    expect(isFieldFilled("catalogue", { ...blank, catalogue_url: "https://example.test" })).toBe(true);
    expect(isFieldFilled("catalogue", { ...blank, partner_links: [{ url: "https://example.test" }] })).toBe(true);
    expect(isFieldFilled("catalogue", { ...blank, partner_links: [] })).toBe(false);
  });

  it("counts contacts by presence, not by field text", () => {
    expect(isFieldFilled("contacts", blank)).toBe(false);
    expect(isFieldFilled("contacts", { ...blank, contactCount: 1 })).toBe(true);
  });
});

describe("computeOrgCompleteness", () => {
  it("blocks print when any required field is missing", () => {
    const r = computeOrgCompleteness(blank);
    expect(r.isPrintReady).toBe(false);
    expect(r.requiredFilled).toBe(0);
    expect(r.overallPct).toBe(0);
  });

  it("is print-ready on required fields alone, without any enhanced field", () => {
    const r = computeOrgCompleteness(printable);
    expect(r.isPrintReady).toBe(true);
    expect(r.requiredFilled).toBe(r.requiredTotal);
    expect(r.enhancedFilled).toBe(0);
    // Print-ready is not the same as complete — the meter must still show a gap.
    expect(r.overallPct).toBeLessThan(100);
  });

  it("orders missing fields required-first, so nudges ask in the right order", () => {
    const r = computeOrgCompleteness({ ...blank, logo_url: "https://example.test/l.png" });
    const tiers = r.missing.map((k) => PUBLICATION_FIELDS.find((f) => f.key === k)!.tier);
    expect(tiers.indexOf("enhanced")).toBeGreaterThan(tiers.lastIndexOf("required"));
  });

  it("scores an org with no user account exactly like any other", () => {
    // The point of deriving from columns: onboarding state is never consulted.
    expect(computeOrgCompleteness(printable).isPrintReady).toBe(true);
  });
});

describe("summarizeCompleteness", () => {
  it("splits print-ready from blocked and ranks gaps worst-first", () => {
    const s = summarizeCompleteness([blank, printable].map(computeOrgCompleteness));
    expect(s.orgs).toBe(2);
    expect(s.printReady).toBe(1);
    expect(s.blocked).toBe(1);
    const missingCounts = s.byField.map((f) => f.missing);
    expect(missingCounts).toEqual([...missingCounts].sort((a, b) => b - a));
  });

  it("maps every field to the onboarding step that can close it", () => {
    // The gap report and the nudge list must be the same question.
    for (const f of PUBLICATION_FIELDS) expect(f.step).toBeTruthy();
  });
});
