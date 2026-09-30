import { deriveStatement, strandedBySplit } from "@/lib/benchmarking/financial-lines";
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

describe("a 2026 submission, whose figures are no longer columns", () => {
  /*
    The failure this guards against: from FY2026 sales, margin and inventory
    live on benchmarking_category_lines, and the flat columns computeMetrics
    used to read are retired and never written. Without the statement, a store
    files a complete survey and every headline metric comes back null.
  */
  const line = (over: Record<string, number | null> = {}) => ({
    id: "l1",
    subcategory: null,
    retailSales: null,
    onlineSales: null,
    grossMarginPct: null,
    inventoryOpen: null,
    inventoryClose: null,
    unitsSold: null,
    unitsAvailable: null,
    ...over,
  });

  const category = (id: string, department: string, over: Record<string, number | null>) => ({
    id,
    department,
    splitBySubcategory: false,
    buyerContactIds: [],
    locations: [],
    lines: [line(over)],
  });

  const statement = {
    gmCategories: [
      category("gm", "Apparel", {
        retailSales: 400_000,
        onlineSales: 100_000,
        grossMarginPct: 40,
        inventoryOpen: 120_000,
        inventoryClose: 80_000,
      }),
    ],
    cmCategories: [
      category("cm", "Print — New", {
        retailSales: 300_000,
        onlineSales: 200_000,
        grossMarginPct: 20,
        inventoryOpen: 80_000,
        inventoryClose: 120_000,
      }),
    ],
    otherIncome: [
      { amount: 50_000, countsAsIncome: true, directCost: null, directCostInExpenses: true },
      // Excluded by the store, so it must not reach revenue.
      { amount: 9_000, countsAsIncome: false, directCost: null, directCostInExpenses: true },
    ],
    otherExpenses: [{ amount: 15_000 }],
    formData: { central_funding: 0, expense_hr: 250_000 },
  };

  const row = {
    // Every legacy column empty, exactly as a 2026 row will be.
    total_gross_sales_instore: null,
    total_online_sales: null,
    total_cogs: null,
    net_profit: null,
    fye_inventory_value: null,
    sales_course_materials: null,
    expense_hr: 250_000,
    enrollment_fte: 10_000,
    sqft_salesfloor: 5_000,
    total_transaction_count: 50_000,
  };

  it("computes the headline figures instead of nulls", () => {
    const m = computeMetrics(row, { statement, orgFte: 10_000 });

    // 400k + 100k + 300k + 200k + 50k counted income. The 9k is excluded.
    expect(m.total_revenue).toBe(1_050_000);
    // 500k at 40% + 500k at 20% = 300k.
    expect(m.gross_margin).toBe(300_000);
    expect(m.gross_margin_pct).toBeCloseTo(28.57, 1);
    expect(m.sales_per_fte).toBeCloseTo(105, 1);
    expect(m.sales_per_sqft).toBe(210);
    expect(m.avg_transaction_value).toBe(21);
    expect(m.online_pct).toBeCloseTo(30, 1);
  });

  it("uses operating income as the bottom line it can actually see", () => {
    // 300k margin less 250k salaries and 15k of named-yourself expenses.
    const m = computeMetrics(row, { statement, orgFte: 10_000 });
    expect(m.net_margin_pct).toBeCloseTo((35_000 / 1_050_000) * 100, 2);
  });

  it("returns nulls when there is no statement, which is the bug it fixes", () => {
    const m = computeMetrics(row, { orgFte: 10_000 });
    expect(m.total_revenue).toBeNull();
    expect(m.gross_margin).toBeNull();
    expect(m.sales_per_fte).toBeNull();
  });

  it("still reads the flat columns for a year filed before the rebuild", () => {
    const legacy = computeMetrics(
      { ...row, total_gross_sales_instore: 900_000, total_online_sales: 100_000, total_cogs: 700_000 },
      { orgFte: 10_000 },
    );
    expect(legacy.total_revenue).toBe(1_000_000);
    expect(legacy.gross_margin).toBe(300_000);
  });
});

describe("a category that has been split", () => {
  const split = {
    id: "gm",
    department: "Apparel",
    splitBySubcategory: true,
    buyerContactIds: [],
    locations: [],
    lines: [
      // The department's own row, left behind by the split with its figure on it.
      {
        id: "whole",
        subcategory: null,
        retailSales: 420_000,
        onlineSales: 38_000,
        grossMarginPct: 41.5,
        inventoryOpen: null,
        inventoryClose: null,
        unitsSold: null,
        unitsAvailable: null,
      },
      {
        id: "sub",
        subcategory: "Men's / Unisex",
        retailSales: 100_000,
        onlineSales: null,
        grossMarginPct: 40,
        inventoryOpen: null,
        inventoryClose: null,
        unitsSold: null,
        unitsAvailable: null,
      },
    ],
  };

  const parts = {
    gmCategories: [split],
    cmCategories: [],
    otherIncome: [],
    otherExpenses: [],
    formData: {},
  };

  it("counts the subcategories and not the department row", () => {
    // 520,000 would be the double count; 458,000 would be the stale one.
    expect(deriveStatement(parts).totalRevenue).toBe(100_000);
  });

  it("reports what the split stranded rather than silently dropping it", () => {
    expect(strandedBySplit([split])).toEqual([{ department: "Apparel", amount: 458_000 }]);
  });

  it("says nothing about a category that was never split", () => {
    expect(strandedBySplit([{ ...split, splitBySubcategory: false }])).toEqual([]);
  });
});
