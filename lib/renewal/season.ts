import { getRenewalConfig } from "@/lib/policy/engine";

export interface RenewalSeason {
  /** The renewal_events/invoices "renewal year" label for this cycle — the
   *  cycle-start year PLUS ONE (a Sept 2026 → Aug 2027 cycle is "2027",
   *  matching the conference-year naming convention). Must match
   *  `renewalYear` in lib/renewal/jobs.ts:252 exactly, since that's the
   *  value actually written to renewal_events by the live cron. */
  renewalYear: number;
  /** The day before the first reminder is scheduled to go out. */
  seasonStart: Date;
  /** The shared fiscal-year boundary (renewal.cycle_start_month_day). */
  cycleStart: Date;
  /** The last day of the grace period, inclusive — the season is over the day after. */
  seasonEnd: Date;
}

function cycleStartForYear(year: number, cycleStartMonthDay: string): Date {
  const [month, day] = cycleStartMonthDay.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addUTCDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Midnight UTC on the day `date` falls in.
 *
 * The season bounds are whole days at 00:00 UTC, but callers pass a live
 * `new Date()`. Comparing an instant against them made the two ends behave
 * differently: any time on `seasonStart` counted (it is already past
 * midnight), but on `seasonEnd` only the midnight instant itself did — so the
 * last day of the grace period, Oct 1 under the current config, dropped out of
 * season the moment the clock ticked past 00:00 UTC. That is the day the
 * dashboard's renewal widget and the "My renewal calls" nav item matter most.
 * Normalising to the day makes both bounds inclusive of the whole day.
 */
function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Is `today` inside the current renewal season? Season = the day before the
 * first reminder is scheduled through the end of the grace period, both
 * derived from the same policy config the reminder/grace cron jobs already
 * use (lib/policy/engine.ts's getRenewalConfig) — no separate "season" flag
 * exists or is needed.
 *
 * Returns null outside a season (callers should render nothing).
 */
export async function getCurrentRenewalSeason(today: Date): Promise<RenewalSeason | null> {
  const config = await getRenewalConfig();
  const maxReminderDay = config.reminder_days.length > 0 ? Math.max(...config.reminder_days) : 0;

  // Compared as a whole day, not an instant — see startOfUTCDay.
  const day = startOfUTCDay(today);

  // Cycles are annual, so the only candidates that could possibly contain
  // `today` are this UTC year's occurrence, last year's, or next year's
  // (e.g. late December vs. an early-January cycle start).
  const todayYear = today.getUTCFullYear();
  const candidates = [todayYear - 1, todayYear, todayYear + 1].map((year) =>
    cycleStartForYear(year, config.cycle_start_month_day)
  );

  for (const cycleStart of candidates) {
    const seasonStart = addUTCDays(cycleStart, -(maxReminderDay + 1));
    const seasonEnd = addUTCDays(cycleStart, config.grace_days);
    if (day.getTime() >= seasonStart.getTime() && day.getTime() <= seasonEnd.getTime()) {
      return {
        renewalYear: cycleStart.getUTCFullYear() + 1,
        seasonStart,
        cycleStart,
        seasonEnd,
      };
    }
  }

  return null;
}
