import { describe, expect, it } from "vitest";
import {
  applyRoundingRule,
  evaluateBucketPrice,
  evaluateLinearFormulaPrice,
  toCents,
} from "../pricing-core";

describe("membership pricing evaluators", () => {
  it("computes FTE bucket tier boundaries deterministically", () => {
    const tiers = [
      { max_fte: 2500, price: 420 },
      { max_fte: 5000, price: 525 },
      { max_fte: null, price: 1000 },
    ];

    const first = evaluateBucketPrice(2500, tiers, "FTE_BUCKETS");
    const second = evaluateBucketPrice(2501, tiers, "FTE_BUCKETS");
    const highest = evaluateBucketPrice(9000, tiers, "FTE_BUCKETS");

    expect(first.amountCents).toBe(42000);
    expect(second.amountCents).toBe(52500);
    expect(highest.amountCents).toBe(100000);
  });

  it("computes single-metric bucket tiers", () => {
    const tiers = [
      { max_value: 100, price: 300 },
      { max_value: 500, price: 500 },
      { max_value: null, price: 800 },
    ];

    const low = evaluateBucketPrice(42, tiers, "SINGLE_METRIC_BUCKETS");
    const mid = evaluateBucketPrice(500, tiers, "SINGLE_METRIC_BUCKETS");

    expect(low.amountCents).toBe(30000);
    expect(mid.amountCents).toBe(50000);
  });

  it("applies linear formula with clamp and rounding", () => {
    const amount = evaluateLinearFormulaPrice(
      12000,
      {
        base: 200,
        multiplier: 0.02,
        min_price: 200,
        max_price: 350,
        rounding: "nearest_dollar",
      },
      "nearest_dollar"
    );

    expect(amount).toBe(35000);
  });

  it("applies all rounding rules in cents", () => {
    expect(applyRoundingRule(toCents(100.49), "nearest_dollar")).toBe(10000);
    expect(applyRoundingRule(toCents(100.49), "floor")).toBe(10000);
    expect(applyRoundingRule(toCents(100.49), "ceil")).toBe(10100);
  });
});
