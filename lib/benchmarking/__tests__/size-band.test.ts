import { describe, it, expect } from "vitest";
import { sizeBandsFromTiers, resolveSizeBand } from "../size-band";

/**
 * These mirror the live billing.membership_tiers value (confirmed identical
 * across all four policy sets, 2026-08-26). If someone changes the dues tiers
 * these tests do NOT fail — the bands are derived, so they move with policy.
 * What they pin is the boundary ARITHMETIC, which must not move.
 */
const LIVE = [
  { max_fte: 2500, price: 420 },
  { max_fte: 5000, price: 525 },
  { max_fte: 10000, price: 735 },
  { max_fte: 20000, price: 895 },
  { max_fte: null, price: 1000 },
];

describe("bands derived from the dues tiers", () => {
  it("produces one band per tier, ascending, open-ended last", () => {
    const bands = sizeBandsFromTiers(LIVE);
    expect(bands).toHaveLength(5);
    expect(bands.map((b) => b.maxFte)).toEqual([2500, 5000, 10000, 20000, null]);
    expect(bands.map((b) => b.minFte)).toEqual([0, 2501, 5001, 10001, 20001]);
  });

  it("orders correctly even when policy lists the tiers out of order", () => {
    // The policy value is hand-edited JSON in /admin/policy. Nothing enforces
    // its order, and evaluateBucketPrice sorts for the same reason.
    const shuffled = [LIVE[3], LIVE[4], LIVE[0], LIVE[2], LIVE[1]];
    expect(sizeBandsFromTiers(shuffled).map((b) => b.maxFte)).toEqual([
      2500, 5000, 10000, 20000, null,
    ]);
  });

  it("never puts a price in a label", () => {
    // The bands come from the pricing table; what a peer pays does not belong
    // in a benchmarking report.
    const prices = LIVE.map((t) => String(t.price));
    for (const b of sizeBandsFromTiers(LIVE)) {
      expect(b.label).not.toContain("$");
      // "2,501" legitimately contains "501", so check for the price as a whole
      // token rather than as a substring.
      for (const p of prices) {
        expect(b.label.split(/[^0-9]+/)).not.toContain(p);
      }
    }
    expect(sizeBandsFromTiers(LIVE).map((b) => b.label)).toEqual([
      "Under 2,501 FTE",
      "2,501–5,000 FTE",
      "5,001–10,000 FTE",
      "10,001–20,000 FTE",
      "20,001+ FTE",
    ]);
  });

  it("prefers the board's own tier code when one is set", () => {
    const coded = [
      { max_fte: 2500, price: 420, code: "XS" },
      { max_fte: null, price: 1000, code: "XL" },
    ];
    expect(sizeBandsFromTiers(coded).map((b) => b.label)).toEqual(["XS", "XL"]);
  });
});

describe("placing a store", () => {
  const bands = sizeBandsFromTiers(LIVE);
  const bandOf = (fte: number | null) => {
    const b = resolveSizeBand(fte, bands);
    return b === null ? "none" : b.maxFte;
  };

  it("treats the upper bound as INSIDE the band, like the pricing engine", () => {
    // A store at exactly 10,000 FTE pays the 10,000 tier. If it compared in the
    // 20,000 band instead, it would sit in a band it does not pay in and
    // nothing would ever surface the mismatch.
    expect(bandOf(10_000)).toBe(10_000);
    expect(bandOf(10_001)).toBe(20_000);
    expect(bandOf(2_500)).toBe(2_500);
    expect(bandOf(2_501)).toBe(5_000);
  });

  it("places the real extremes of the membership", () => {
    expect(bandOf(398)).toBe(2_500); // St. Mary's, the smallest filer
    expect(bandOf(91_245)).toBe(null); // Toronto, the largest
  });

  it("refuses to place a store with no FTE", () => {
    // Unknown is not "smallest". Defaulting a store with no roll into the
    // bottom band would drag a median that four small stores rely on.
    expect(resolveSizeBand(null, bands)).toBeNull();
    expect(resolveSizeBand(undefined, bands)).toBeNull();
    expect(resolveSizeBand(Number.NaN, bands)).toBeNull();
  });

  it("places zero, which is a real reported value", () => {
    // OntarioTech reported $0 revenue for a year it had no store. A zero is a
    // fact, not a gap, and must not be confused with the missing case above.
    expect(bandOf(0)).toBe(2_500);
  });
});
