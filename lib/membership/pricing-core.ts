import type { BillingConfig } from "../policy/types";

export type PricingMode =
  | "FTE_BUCKETS"
  | "SINGLE_METRIC_BUCKETS"
  | "LINEAR_FORMULA";

interface PricingTier {
  max_fte?: number | null;
  max_value?: number | null;
  price: number;
}

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function applyRoundingRule(
  amountCents: number,
  rule: "nearest_dollar" | "floor" | "ceil"
): number {
  if (rule === "floor") return Math.floor(amountCents / 100) * 100;
  if (rule === "ceil") return Math.ceil(amountCents / 100) * 100;
  return Math.round(amountCents / 100) * 100;
}

export function evaluateBucketPrice(
  metricValue: number,
  tiers: PricingTier[],
  mode: PricingMode
): { amountCents: number; tierLabel: string } {
  const normalized = [...tiers].sort((a, b) => {
    const aMax = mode === "FTE_BUCKETS" ? a.max_fte : a.max_value;
    const bMax = mode === "FTE_BUCKETS" ? b.max_fte : b.max_value;
    if (aMax === null || aMax === undefined) return 1;
    if (bMax === null || bMax === undefined) return -1;
    return aMax - bMax;
  });

  for (let i = 0; i < normalized.length; i += 1) {
    const tier = normalized[i];
    const maxValue = mode === "FTE_BUCKETS" ? tier.max_fte : tier.max_value;
    if (maxValue === null || maxValue === undefined || metricValue <= maxValue) {
      return {
        amountCents: toCents(tier.price),
        tierLabel:
          maxValue === null || maxValue === undefined
            ? `Tier ${i + 1} (open-ended)`
            : `Tier ${i + 1} (<= ${maxValue})`,
      };
    }
  }

  const fallback = normalized[normalized.length - 1];
  return {
    amountCents: toCents(fallback?.price ?? 0),
    tierLabel: `Tier ${normalized.length}`,
  };
}

export function evaluateLinearFormulaPrice(
  metricValue: number,
  formula: NonNullable<BillingConfig["formula_config"]>,
  roundingRule: "nearest_dollar" | "floor" | "ceil"
): number {
  const rawAmountDollars = formula.base + metricValue * formula.multiplier;
  const clampedDollars = Math.max(formula.min_price, Math.min(formula.max_price, rawAmountDollars));
  return applyRoundingRule(toCents(clampedDollars), formula.rounding ?? roundingRule);
}
