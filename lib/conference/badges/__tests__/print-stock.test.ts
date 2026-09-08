import { describe, expect, it } from "vitest";
import {
  computeSpareCounts,
  normalizeBadgePrintStock,
  DEFAULT_BADGE_PRINT_STOCK,
} from "../print-stock";

/**
 * Reprint spares are counted from two different bases on purpose.
 *
 * ⛔ Exhibitors: a percentage of what the FLOOR could hold, not of what sold.
 * Booth staff turn over between move-in and the trade show and the desk cannot
 * ring a store to confirm a name. 📏 60 booths × 4 = 240 possible; 20% = 48.
 *
 * ⛔ Members: a percentage of the roster on print day, with a FLOOR. 📏 That
 * roster is 13 today, so 20% is 3 — nowhere near enough to run a desk for four
 * days. The floor is what makes the number usable while the roster is filling.
 */
const stock = (over = {}) => ({ ...DEFAULT_BADGE_PRINT_STOCK, enabled: true, ...over });

describe("computeSpareCounts", () => {
  it("sizes exhibitor spares to the floor, not to sales", () => {
    const r = computeSpareCounts({ stock: stock(), possibleExhibitorSeats: 240, soldExhibitorSeats: 152, memberRoster: 13 });
    expect(r.exhibitor).toBe(48);
  });

  // ⛔ The case that makes the floor exist.
  it("uses the minimum when a percentage of the roster is too small", () => {
    const r = computeSpareCounts({ stock: stock(), possibleExhibitorSeats: 240, soldExhibitorSeats: 152, memberRoster: 13 });
    expect(r.member).toBe(50);
    expect(r.basis.minimumApplied).toBe(true);
  });

  it("uses the percentage once the roster is big enough to beat the floor", () => {
    const r = computeSpareCounts({ stock: stock(), possibleExhibitorSeats: 240, soldExhibitorSeats: 152, memberRoster: 400 });
    expect(r.member).toBe(80);
    expect(r.basis.minimumApplied).toBe(false);
  });

  it("rounds up — half a spare badge is a whole badge", () => {
    const r = computeSpareCounts({ stock: stock({ memberSpareMinimum: 0 }), possibleExhibitorSeats: 11, soldExhibitorSeats: 0, memberRoster: 11 });
    expect(r.exhibitor).toBe(3);
    expect(r.member).toBe(3);
  });

  // ⛔ Silently adding a hundred cards to somebody's print bill is not a default.
  it("prints no spares at all until a conference turns them on", () => {
    const r = computeSpareCounts({
      stock: { ...DEFAULT_BADGE_PRINT_STOCK, enabled: false },
      possibleExhibitorSeats: 240,
      soldExhibitorSeats: 152,
      memberRoster: 400,
    });
    expect(r.total).toBe(0);
  });

  it("reports the basis so an operator can check the arithmetic", () => {
    const r = computeSpareCounts({ stock: stock(), possibleExhibitorSeats: 240, soldExhibitorSeats: 152, memberRoster: 13 });
    expect(r.basis).toEqual({
      possibleExhibitorSeats: 240,
      soldExhibitorSeats: 152,
      exhibitorBasis: 240,
      memberRoster: 13,
      minimumApplied: true,
    });
    expect(r.total).toBe(98);
  });

  /**
   * ⛔ The Grateful Dead case. Booth allocation is not a ceiling — staff
   * registrations sell separately — so an exhibitor ordering far past their
   * allocation must pull the spare pool up with them. Sizing on capacity alone
   * would hold back 20% of a number that stopped being true when they ordered.
   */
  it("follows SALES once they overtake what the floor allocates", () => {
    const r = computeSpareCounts({
      stock: stock(),
      possibleExhibitorSeats: 240,
      soldExhibitorSeats: 287,
      memberRoster: 13,
    });
    expect(r.basis.exhibitorBasis).toBe(287);
    expect(r.exhibitor).toBe(58);
  });

  it("keeps capacity while sales are still below it", () => {
    const r = computeSpareCounts({
      stock: stock(),
      possibleExhibitorSeats: 240,
      soldExhibitorSeats: 152,
      memberRoster: 13,
    });
    expect(r.basis.exhibitorBasis).toBe(240);
    expect(r.exhibitor).toBe(48);
  });
});

describe("normalizeBadgePrintStock", () => {
  it("falls back to the defaults for anything unreadable", () => {
    expect(normalizeBadgePrintStock(null)).toEqual(DEFAULT_BADGE_PRINT_STOCK);
    expect(normalizeBadgePrintStock("nonsense")).toEqual(DEFAULT_BADGE_PRINT_STOCK);
  });

  // ⚠️ Above 100% is a typo, not a request for five times the stock.
  it("rejects an out-of-range percentage rather than honouring it", () => {
    expect(normalizeBadgePrintStock({ exhibitorSparePercent: 500 }).exhibitorSparePercent).toBe(20);
    expect(normalizeBadgePrintStock({ memberSparePercent: -5 }).memberSparePercent).toBe(20);
  });

  it("keeps a deliberate zero", () => {
    expect(normalizeBadgePrintStock({ exhibitorSparePercent: 0 }).exhibitorSparePercent).toBe(0);
  });

  it("stays disabled unless explicitly enabled", () => {
    expect(normalizeBadgePrintStock({ exhibitorSparePercent: 20 }).enabled).toBe(false);
    expect(normalizeBadgePrintStock({ enabled: true }).enabled).toBe(true);
  });
});
