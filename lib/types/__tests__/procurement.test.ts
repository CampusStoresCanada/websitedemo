import { describe, it, expect } from "vitest";
import {
  normalizeKeyDates,
  buyingCycleNotes,
  hasBuyingCycleContent,
  hasProcurementInfo,
  VENDOR_CATEGORIES,
  type BuyingCycle,
  type KeyDate,
} from "@/lib/types/procurement";
import { CERTIFICATION_NAMES } from "@/lib/certifications";

const VALID: KeyDate[] = [
  { title: "Fall Textbook Adoption deadline", date: "2026-06-15", recurring: true },
  { title: "Winter Textbook Adoption deadline", date: "2026-10-15" },
];

// The shape that took the McMaster profile page down: the onboarding wizard
// wrote free text into a field every reader treated as KeyDate[].
const LEGACY_STRING = "Textbook orders: 10 weeks lead time. Apparel samples due January.";

describe("normalizeKeyDates", () => {
  it("passes through a well-formed list", () => {
    expect(normalizeKeyDates(VALID)).toEqual(VALID);
  });

  it("returns an empty list for a legacy free-text string", () => {
    expect(normalizeKeyDates(LEGACY_STRING)).toEqual([]);
  });

  it("returns an empty list for undefined and null", () => {
    expect(normalizeKeyDates(undefined)).toEqual([]);
    expect(normalizeKeyDates(null as unknown as BuyingCycle["key_dates"])).toEqual([]);
  });

  it("drops malformed entries instead of surfacing them to a render", () => {
    const mixed = [
      VALID[0],
      { title: "no date" },
      { date: "2026-01-01" },
      null,
      "just a string",
    ] as unknown as BuyingCycle["key_dates"];
    expect(normalizeKeyDates(mixed)).toEqual([VALID[0]]);
  });

  it("never returns a non-array, so .map is always safe", () => {
    for (const input of [LEGACY_STRING, "", 42, {}, true, undefined]) {
      expect(Array.isArray(normalizeKeyDates(input as BuyingCycle["key_dates"]))).toBe(true);
    }
  });
});

describe("buyingCycleNotes", () => {
  it("reads a legacy string key_dates as the note it always was", () => {
    expect(buyingCycleNotes({ key_dates: LEGACY_STRING })).toBe(LEGACY_STRING);
  });

  it("prefers key_dates_notes when both are present", () => {
    expect(
      buyingCycleNotes({ key_dates: LEGACY_STRING, key_dates_notes: "the current note" })
    ).toBe("the current note");
  });

  it("returns an empty string when there is no note", () => {
    expect(buyingCycleNotes(undefined)).toBe("");
    expect(buyingCycleNotes(null)).toBe("");
    expect(buyingCycleNotes({ key_dates: VALID })).toBe("");
    expect(buyingCycleNotes({ key_dates_notes: "   " })).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(buyingCycleNotes({ key_dates_notes: "  spaced  " })).toBe("spaced");
  });
});

describe("hasBuyingCycleContent", () => {
  it("is true for a fiscal year alone", () => {
    expect(hasBuyingCycleContent({ fiscal_year_start: "May" })).toBe(true);
  });

  it("is true for structured dates alone", () => {
    expect(hasBuyingCycleContent({ key_dates: VALID })).toBe(true);
  });

  it("is true for a legacy free-text cycle — the section still renders", () => {
    expect(hasBuyingCycleContent({ key_dates: LEGACY_STRING })).toBe(true);
  });

  it("is true for an RFP window alone", () => {
    expect(hasBuyingCycleContent({ rfp_window: "February - April" })).toBe(true);
  });

  it("is false when nothing is set", () => {
    expect(hasBuyingCycleContent(undefined)).toBe(false);
    expect(hasBuyingCycleContent({})).toBe(false);
    expect(hasBuyingCycleContent({ key_dates: [] })).toBe(false);
    expect(hasBuyingCycleContent({ key_dates: "" })).toBe(false);
  });
});

describe("hasProcurementInfo", () => {
  it("counts fields the wizard now writes", () => {
    expect(hasProcurementInfo({ requirements_notes: "$2M liability insurance" })).toBe(true);
    expect(hasProcurementInfo({ store_services: ["Post Office"] })).toBe(true);
    expect(hasProcurementInfo({ buying_cycle: { rfp_window: "Jan - Mar" } })).toBe(true);
  });

  it("is false for empty and for a buying cycle with nothing in it", () => {
    expect(hasProcurementInfo(null)).toBe(false);
    expect(hasProcurementInfo({})).toBe(false);
    // Previously `info.buying_cycle` alone was truthy, so an empty object
    // rendered a "Procurement Information" section with nothing under it.
    expect(hasProcurementInfo({ buying_cycle: {} })).toBe(false);
    expect(hasProcurementInfo({ requirements_notes: "   " })).toBe(false);
  });
});

describe("onboarding and the profile editor share one vocabulary", () => {
  // The drift this migration closed: the wizard wrote product_categories and
  // requirements.* using a taxonomy nothing else recognised.
  it("every category the wizard offers is a category the editor reads", () => {
    const editorCategories = new Set<string>(VENDOR_CATEGORIES);
    for (const cat of VENDOR_CATEGORIES) {
      expect(editorCategories.has(cat)).toBe(true);
    }
    expect(VENDOR_CATEGORIES).not.toContain("Textbooks");
    expect(VENDOR_CATEGORIES).not.toContain("Technology");
    expect(VENDOR_CATEGORIES).not.toContain("Gifts & Collectibles");
  });

  it("every certification the wizard offers renders with a known badge", () => {
    expect(CERTIFICATION_NAMES.length).toBeGreaterThan(0);
    for (const name of CERTIFICATION_NAMES) {
      expect(typeof name).toBe("string");
      expect(name.trim()).not.toBe("");
    }
    // Values that used to arrive as free text and have no badge asset.
    expect(CERTIFICATION_NAMES).not.toContain("Rainforest Alliance");
    expect(CERTIFICATION_NAMES).not.toContain("FSC Certified");
  });
});
