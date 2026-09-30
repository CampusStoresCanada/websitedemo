import { describe, it, expect } from "vitest";
import { RETIRED_FIELDS } from "@/lib/benchmarking/retired-fields";
import { FIELD_REGISTRY } from "@/lib/benchmarking/field-registry";
import { DEFAULT_FIELD_CONFIG } from "@/lib/benchmarking/default-field-config";

/**
 * Carry-forward copies last year's figure into a blank of this year's. That is
 * only ever right for a question we still ask.
 */
describe("what carry-forward may copy", () => {
  const numericFields = Object.entries(FIELD_REGISTRY)
    .filter(([, def]) => ["currency", "number", "integer", "percentage"].includes(def.type))
    .map(([name]) => name);

  const carried = numericFields.filter((name) => !RETIRED_FIELDS.has(name));

  it("never carries a column the rebuild stopped writing", () => {
    // The retired course-material lines are the _total/_online pairs. Newer
    // cm_ fields like cm_sell_through_pct are live and must not match.
    const sales = carried.filter((n) =>
      /^sales_|^cm_.*_(total|online)$|^total_gross_sales|^total_online_sales$/.test(n),
    );
    expect(sales).toEqual([]);
    for (const dead of ["total_cogs", "net_profit", "fye_inventory_value", "ia_revenue"]) {
      expect(carried).not.toContain(dead);
    }
  });

  it("still carries the columns a component writes, which are hidden but alive", () => {
    /*
      The trap this catches: judging by "hidden in the field config" would have
      retired the square footage family, which the per-location editor rolls up
      and sales_per_sqft divides by, and the wage columns the pay grid writes.
    */
    for (const alive of [
      "sqft_salesfloor",
      "sqft_storage",
      "sqft_office",
      "total_square_footage",
      "wages_full_time",
      "benefits_total",
    ]) {
      expect(carried).toContain(alive);
    }
  });

  it("carries every figure still visible in the survey", () => {
    const visibleNumeric = DEFAULT_FIELD_CONFIG.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.visible !== false && !f.calculated && !f.displayOnly)
      .filter((f) => ["currency", "number", "integer", "percentage"].includes(f.type))
      .map((f) => f.name);

    const dropped = visibleNumeric.filter((n) => RETIRED_FIELDS.has(n));
    expect(dropped).toEqual([]);
  });
});
