import { describe, it, expect } from "vitest";
import {
  computeMetrics,
  yoyDeltas,
  isYearClosedToWrites,
  type ComputedMetrics,
} from "../metrics";

/**
 * The anchor tests are two REAL 2025 stores whose raw data has not been
 * revised since the Excel backfill. Where the inputs still match, these
 * formulas must reproduce the published figures exactly — that agreement is
 * the only evidence the formulas are the ones CSC actually used, since the
 * backfill script is not in this repo.
 *
 * The stores whose figures the backfill got wrong (Capilano's ten-million
 * slip, Algonquin's stale FTE, the halved footages) are deliberately NOT
 * anchors. Reproducing a stale number is not a passing test.
 */

const camosun = {
  total_gross_sales_instore: 2_730_192,
  total_online_sales: 408_663,
  total_cogs: 2_103_267,
  net_profit: -329_747,
  expense_hr: 833_267,
  enrollment_fte: 9_470,
  total_square_footage: 18_500,
  sales_course_materials: 2_206_022,
};

const nscc = {
  total_gross_sales_instore: 4_159_226,
  total_online_sales: 397_356,
  total_cogs: 3_048_141,
  net_profit: 1_111_085,
  expense_hr: 765_882,
  enrollment_fte: 11_052,
  total_square_footage: 11_699,
  sales_course_materials: 3_538_593,
};

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

describe("agrees with the 2025 published figures", () => {
  it("reproduces Camosun exactly", () => {
    const m = computeMetrics(camosun, { orgFte: 9_470 });
    expect(m.total_retail_revenue).toBe(3_138_855);
    expect(m.gross_margin).toBe(1_035_588);
    expect(r2(m.gross_margin_pct)).toBe(32.99);
    expect(r2(m.net_margin_pct)).toBe(-10.51);
    expect(r2(m.hr_pct)).toBe(26.55);
    expect(r2(m.online_pct)).toBe(13.02);
    expect(r2(m.sales_per_fte)).toBe(331.45);
    expect(r2(m.cm_sales_per_fte)).toBe(232.95);
  });

  it("reproduces Nova Scotia Community College exactly", () => {
    const m = computeMetrics(nscc, { orgFte: 11_052 });
    expect(m.total_retail_revenue).toBe(4_556_582);
    expect(m.gross_margin).toBe(1_508_441);
    expect(r2(m.gross_margin_pct)).toBe(33.1);
    expect(r2(m.net_margin_pct)).toBe(24.38);
    expect(r2(m.hr_pct)).toBe(16.81);
    expect(r2(m.online_pct)).toBe(8.72);
    expect(r2(m.sales_per_fte)).toBe(412.29);
    expect(r2(m.cm_sales_per_fte)).toBe(320.18);
  });

  it("stores percentages as percentages, not fractions", () => {
    // A fraction in a column named _pct reads fine forever and renders 3299%.
    const m = computeMetrics(camosun, { orgFte: 9_470 });
    expect(m.gross_margin_pct!).toBeGreaterThan(1);
    expect(m.gross_margin_pct!).toBeLessThan(100);
  });
});

describe("one FTE everywhere", () => {
  it("uses the priced org figure over the store's own answer", () => {
    // Kwantlen filed 2,792 against a corrected 12,000.
    const m = computeMetrics({ ...camosun, enrollment_fte: 2_792 }, { orgFte: 12_000 });
    expect(r2(m.sales_per_fte)).toBe(r2(3_138_855 / 12_000));
  });
});

describe("refusing rather than inventing", () => {
  it("withholds every ratio when there is no revenue at all", () => {
    const m = computeMetrics({});
    expect(m.total_revenue).toBeNull();
    expect(m.gross_margin_pct).toBeNull();
    expect(m.sales_per_fte).toBeNull();
  });

  it("treats a blank online figure as zero, not as unknown revenue", () => {
    // A store reporting in-store sales and leaving online blank has $0 online.
    const m = computeMetrics({ total_gross_sales_instore: 1_000_000 });
    expect(m.total_retail_revenue).toBe(1_000_000);
    expect(m.online_pct).toBeNull();
  });

  it("never divides by zero", () => {
    const m = computeMetrics({
      total_gross_sales_instore: 500_000,
      enrollment_fte: 0,
      total_square_footage: 0,
      total_transaction_count: 0,
    });
    expect(m.sales_per_fte).toBeNull();
    expect(m.sales_per_sqft).toBeNull();
    expect(m.avg_transaction_value).toBeNull();
  });

  it("gives no adoption rate to a store that does not track adoptions", () => {
    // It would report 0 by-deadline, and 0% reads as catastrophe, not absence.
    const base = { total_course_sections: 900, adoptions_by_deadline: 0 };
    expect(computeMetrics({ ...base, tracks_adoptions: false }).adoption_completion_rate).toBeNull();
    expect(computeMetrics({ ...base, tracks_adoptions: true }).adoption_completion_rate).toBe(0);
  });

  it("holds GMROI and turns until two year-ends exist", () => {
    const row = { ...camosun, fye_inventory_value: 800_000 };
    expect(computeMetrics(row, { orgFte: 9_470 }).gmroi).toBeNull();
    expect(computeMetrics(row, { orgFte: 9_470 }).inventory_turns).toBeNull();

    const withPrior = computeMetrics(row, { orgFte: 9_470, priorFyeInventory: 600_000 });
    // Average of the two year-ends, not the latest one.
    expect(r2(withPrior.gmroi)).toBe(r2(1_035_588 / 700_000));
    expect(r2(withPrior.inventory_turns)).toBe(r2(2_103_267 / 700_000));
  });
});

describe("year over year", () => {
  const prior = computeMetrics(camosun, { orgFte: 9_470 });

  it("moves percentages by POINTS and money by percent", () => {
    const current: ComputedMetrics = { ...prior, gross_margin_pct: 35.99, total_revenue: 3_452_741 };
    const d = yoyDeltas(current, prior);
    // 32.99 -> 35.99 is +3 points, not +9.1%.
    expect(r2(d.yoy_gross_margin_pct_delta)).toBe(3);
    expect(r2(d.yoy_total_revenue_delta)).toBe(10);
  });

  it("is null in year one, where there is nothing to move from", () => {
    const d = yoyDeltas(prior, null);
    expect(Object.values(d).every((v) => v === null)).toBe(true);
  });

  it("refuses a percent change from zero rather than reporting infinity", () => {
    const from = { ...prior, total_revenue: 0 };
    expect(yoyDeltas(prior, from).yoy_total_revenue_delta).toBeNull();
  });
});

describe("a published year is closed to writes", () => {
  it("closes a completed cycle", () => {
    // FY2025 is 'complete'. Its figures went out in a package; recomputing
    // them from today's corrected source would change 33 of 39 stores.
    expect(isYearClosedToWrites("complete")).toBe(true);
  });

  it("leaves every earlier stage writable", () => {
    // Including 'closed' and 'processing' — collection has stopped but the
    // package has not gone out, which is exactly when a correction should
    // still reach the numbers.
    for (const s of ["draft", "beta", "open", "closed", "processing"]) {
      expect(isYearClosedToWrites(s)).toBe(false);
    }
  });

  it("does not close a year that has no survey row at all", () => {
    // Absence of a record is not evidence of publication.
    expect(isYearClosedToWrites(null)).toBe(false);
    expect(isYearClosedToWrites(undefined)).toBe(false);
  });
});
