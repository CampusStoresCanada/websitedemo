/**
 * CSC fiscal year helpers — Sep 1 → Aug 31
 */

export interface FiscalYear {
  start: string;   // "YYYY-09-01"
  end:   string;   // "YYYY-08-31"
  label: string;   // "2025-2026"
}

/**
 * Returns the fiscal year that contains the given date (defaults to today).
 * CSC fiscal year: Sep 1 → Aug 31.
 */
export function getFiscalYear(asOf?: string): FiscalYear {
  const d = asOf ? new Date(asOf + "T12:00:00Z") : new Date();
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-based

  // Sep (9) or later → fiscal year starts this calendar year
  const startYear = month >= 9 ? year : year - 1;
  const endYear   = startYear + 1;

  return {
    start: `${startYear}-09-01`,
    end:   `${endYear}-08-31`,
    label: `${startYear}-${endYear}`,
  };
}

/**
 * Returns the prior fiscal year.
 */
export function getPriorFiscalYear(asOf?: string): FiscalYear {
  const current = getFiscalYear(asOf);
  const startYear = parseInt(current.start.slice(0, 4)) - 1;
  const endYear   = startYear + 1;
  return {
    start: `${startYear}-09-01`,
    end:   `${endYear}-08-31`,
    label: `${startYear}-${endYear}`,
  };
}

/**
 * Given a fiscal year and a report date, returns the equivalent YTD end
 * date in the PRIOR fiscal year.
 * e.g. asOf=2026-04-30 → 2025-04-30
 */
export function priorYTDEnd(fiscalYear: FiscalYear, asOf: string): string {
  const priorYear = parseInt(fiscalYear.start.slice(0, 4)) - 1;
  const monthDay  = asOf.slice(4); // "-MM-DD"
  return `${priorYear}${monthDay}`;
}

/**
 * Returns an array of YYYY-MM-01 strings for every month in the fiscal year
 * that is AFTER the given asOf date (i.e. months not yet elapsed).
 */
export function remainingBudgetMonths(fiscalYear: FiscalYear, asOf: string): string[] {
  const asOfDate = new Date(asOf + "T12:00:00Z");
  const months: string[] = [];

  const cursor = new Date(fiscalYear.start + "T12:00:00Z");
  const end    = new Date(fiscalYear.end   + "T12:00:00Z");

  while (cursor <= end) {
    // A month is "remaining" if its first day is after asOf
    if (cursor > asOfDate) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      months.push(`${y}-${m}-01`);
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

/**
 * Returns the last fully completed calendar month relative to a given date.
 * e.g. asOf=2026-05-25 → { start: "2026-04-01", end: "2026-04-30", label: "Apr 2026" }
 */
export function getLastFullMonth(asOf?: string): { start: string; end: string; label: string } {
  const ref = asOf ? new Date(asOf + "T12:00:00Z") : new Date();
  // Step back to first of current month, then subtract one day to get last day of prior month
  const lastDay = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
  const firstDay = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), 1));

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const label = firstDay.toLocaleDateString("en-CA", {
    month: "short",
    year:  "numeric",
    timeZone: "UTC",
  });

  return { start: fmt(firstDay), end: fmt(lastDay), label };
}

/**
 * Returns an array of YYYY-MM-01 strings for every month in the fiscal year
 * up to and including the month of asOf.
 */
export function elapsedBudgetMonths(fiscalYear: FiscalYear, asOf: string): string[] {
  const asOfDate   = new Date(asOf + "T12:00:00Z");
  const asOfMonthStart = new Date(asOf.slice(0, 7) + "-01T12:00:00Z");
  const months: string[] = [];

  const cursor = new Date(fiscalYear.start + "T12:00:00Z");
  const end    = new Date(fiscalYear.end   + "T12:00:00Z");

  while (cursor <= end && cursor <= asOfMonthStart) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}-01`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  void asOfDate; // suppress unused warning
  return months;
}
