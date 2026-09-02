import type { ProrationRule } from "@/lib/stripe/types";
import { isWithinPreRenewalSkipWindow } from "@/lib/membership/renewal-activation";

/**
 * How many days into the membership cycle a given month-day falls.
 *
 * A proration ladder is inherently cycle-relative — "after_month_day 06-01,
 * 75% off" means "three quarters of the way through the year, charge a
 * quarter" — but this used to be evaluated with a raw calendar comparison
 * (month > ruleMonth || ...), which wraps the year at January 1 rather than
 * at the cycle start. With a 09-01 cycle that inverted the whole ladder for
 * a third of the year: September through December read as "month 9 > month
 * 6", so brand-new partners joining in the FIRST four months of their
 * membership year were charged the deepest late-join discount — 25% of the
 * rate. Only June-August escaped, and only because the pre-renewal skip
 * window happens to cover it.
 *
 * A leap-year reference is used so a rule or a signup dated 02-29 is a real
 * date; the wrap-around year is non-leap, so a 02-29 falling on the far side
 * of the cycle start lands on 03-01. That one-day slip only ever affects
 * February 29 itself and never changes which rule is in effect.
 */
function daysIntoCycle(month: number, day: number, startMonth: number, startDay: number): number {
  const REF_LEAP_YEAR = 2000;
  const cycleStart = Date.UTC(REF_LEAP_YEAR, startMonth - 1, startDay);
  let target = Date.UTC(REF_LEAP_YEAR, month - 1, day);
  if (target < cycleStart) target = Date.UTC(REF_LEAP_YEAR + 1, month - 1, day);
  return Math.round((target - cycleStart) / (24 * 60 * 60 * 1000));
}

/**
 * Highest applicable proration discount for a date, per billing.proration_rules
 * — measured by position WITHIN the membership cycle, not by calendar date.
 *
 * Read in UTC, like every other date in the cycle system
 * (nextCycleStartOnOrAfter, nextFiscalYearEnd). Reading local time here would
 * move the boundary by a day for anyone west of Greenwich.
 */
export function currentProrationDiscountPct(
  rules: ProrationRule[],
  cycleStartMonthDay: string,
  today: Date = new Date()
): number {
  if (!rules || rules.length === 0) return 0;

  const [startMonth, startDay] = cycleStartMonthDay.split("-").map(Number);
  const todayOffset = daysIntoCycle(
    today.getUTCMonth() + 1,
    today.getUTCDate(),
    startMonth,
    startDay
  );
  let applicable = 0;

  for (const rule of rules) {
    const [ruleMonth, ruleDay] = rule.after_month_day.split("-").map(Number);
    if (todayOffset >= daysIntoCycle(ruleMonth, ruleDay, startMonth, startDay)) {
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
  return currentProrationDiscountPct(rules, cycleStartMonthDay, today);
}

export function applyDiscountPct(amount: number, discountPct: number): number {
  return Math.round(amount * (1 - discountPct / 100));
}
