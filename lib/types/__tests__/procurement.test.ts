import { describe, it, expect } from "vitest";
import {
  normalizeKeyDates,
  buyingCycleNotes,
  hasBuyingCycleContent,
  type BuyingCycle,
  type KeyDate,
} from "@/lib/types/procurement";

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

  it("is false when nothing is set", () => {
    expect(hasBuyingCycleContent(undefined)).toBe(false);
    expect(hasBuyingCycleContent({})).toBe(false);
    expect(hasBuyingCycleContent({ key_dates: [] })).toBe(false);
    expect(hasBuyingCycleContent({ key_dates: "" })).toBe(false);
  });
});
