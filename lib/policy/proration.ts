import type { ProrationRule } from "@/lib/stripe/types";

/** Highest applicable proration discount for a date, per billing.proration_rules. */
export function currentProrationDiscountPct(
  rules: ProrationRule[],
  today: Date = new Date()
): number {
  if (!rules || rules.length === 0) return 0;

  const month = today.getMonth() + 1;
  const day = today.getDate();
  let applicable = 0;

  for (const rule of rules) {
    const [ruleMonth, ruleDay] = rule.after_month_day.split("-").map(Number);
    if (month > ruleMonth || (month === ruleMonth && day >= ruleDay)) {
      applicable = Math.max(applicable, rule.discount_pct);
    }
  }

  return applicable;
}

export function applyDiscountPct(amount: number, discountPct: number): number {
  return Math.round(amount * (1 - discountPct / 100));
}
