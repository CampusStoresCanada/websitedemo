import { describe, it, expect } from "vitest";
import { buildTrend } from "@/lib/benchmarking/trend";

const revenue = (r: { fiscal_year?: number | null; v?: number | null }) => r.v ?? null;

describe("a trend line", () => {
  const released = [2025, 2024, 2023];

  it("leaves out an unreleased year, even the store's own", () => {
    const rows = [
      { fiscal_year: 2026, v: 999 },
      { fiscal_year: 2025, v: 200 },
      { fiscal_year: 2024, v: 100 },
    ];
    expect(buildTrend(rows, released, revenue)).toEqual([
      { fiscalYear: 2024, value: 100 },
      { fiscalYear: 2025, value: 200 },
    ]);
  });

  it("is nothing at all when only one year has been released", () => {
    // A single dot on an axis reads as a finding and is not one.
    const rows = [
      { fiscal_year: 2026, v: 999 },
      { fiscal_year: 2025, v: 200 },
    ];
    expect(buildTrend(rows, released, revenue)).toBeNull();
  });

  it("is nothing when the released years hold no figure", () => {
    const rows = [
      { fiscal_year: 2025, v: null },
      { fiscal_year: 2024, v: null },
    ];
    expect(buildTrend(rows, released, revenue)).toBeNull();
  });

  it("runs oldest to newest whatever order it was given", () => {
    const rows = [
      { fiscal_year: 2023, v: 50 },
      { fiscal_year: 2025, v: 200 },
      { fiscal_year: 2024, v: 100 },
    ];
    expect(buildTrend(rows, released, revenue)!.map((p) => p.fiscalYear)).toEqual([
      2023, 2024, 2025,
    ]);
  });
});
