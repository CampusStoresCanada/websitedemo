import type { ProrationRule } from "@/lib/stripe/types";
import { isWithinPreRenewalSkipWindow } from "@/lib/membership/renewal-activation";

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

/**
 * The discount actually in effect right now: `currentProrationDiscountPct`,
 * except within the pre-renewal skip-stub window it's always 0 — paying a
 * small prorated amount days before the anniversary just to renew again
 * immediately doesn't make sense, so both the public pricing display and
 * real invoicing show/charge the full year-ahead price instead.
 */
export function effectiveProrationDiscountPct(
  rules: ProrationRule[],
  cycleStartMonthDay: string,
  preRenewalSkipStubDays: number,
  today: Date = new Date()
): number {
  if (isWithinPreRenewalSkipWindow(today, cycleStartMonthDay, preRenewalSkipStubDays)) return 0;
  return currentProrationDiscountPct(rules, today);
}

export function applyDiscountPct(amount: number, discountPct: number): number {
  return Math.round(amount * (1 - discountPct / 100));
}
