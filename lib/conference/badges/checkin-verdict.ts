/**
 * The desk's "does this badge cover today?" rule, on its own.
 *
 * ⚠️ Separate from checkin.ts because the desk's CLIENT bundle needs it, and
 * checkin.ts reaches the print pipeline (and sharp, which cannot be bundled for
 * a browser). Re-exported from checkin.ts, so server code is unchanged.
 */

/** Today where the DESK is standing, as an ISO date. */
export function localIsoDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Does this badge cover today?
 *
 * ⛔ Returns null unless today is a conference day. Listing the days is only
 * half an answer — the operator still has to compare them to a calendar with
 * somebody waiting — but stamping "NOT VALID TODAY" on every badge scanned
 * during setup, or while somebody tests the desk in September, is worse than
 * saying nothing. The verdict only means something once the doors are open.
 *
 * ⚠️ Local dates, not UTC. The desk is a laptop on a table in Mississauga and
 * "today" is the day the people in the room are having; a UTC comparison flips
 * the answer for everything after 7pm local.
 */
export function todayVerdict(
  facts: { dayDates: string[] } | null,
  conferenceDates: string[],
  now: Date = new Date()
): { admitted: boolean } | null {
  if (!facts) return null;
  return verdictForDay(facts.dayDates, conferenceDates, localIsoDate(now));
}

/**
 * The rule itself, for a known "today". ⛔ ONE rule: the desk card shows it and
 * the scan enforces it (personVerdictToday) — a badge for another day is
 * REFUSED at pickup, not checked in with a warning (Stephen, 2026-10-19).
 */
export function verdictForDay(
  dayDates: string[],
  conferenceDates: string[],
  today: string
): { admitted: boolean } | null {
  if (dayDates.length === 0) return null;
  if (!conferenceDates.includes(today)) return null;
  return { admitted: dayDates.includes(today) };
}
