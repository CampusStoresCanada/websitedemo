/**
 * Deadline arithmetic for board votes.
 *
 * A vote opens when Butler posts and closes 3 business days later at 5:00 PM
 * Eastern — late enough that the Pacific directors still have their afternoon,
 * early enough that it isn't the middle of the night in Atlantic Canada.
 *
 * Everything is stored in UTC. The Eastern offset is resolved through Intl
 * rather than hardcoded, so EST/EDT transitions are handled correctly: a vote
 * opened in early March and closing after the switch gets the right instant.
 */

/** The board's civil timezone for deadlines. */
export const BOARD_TIMEZONE = "America/Toronto";

/** Votes close at 17:00 local Eastern. */
export const BOARD_CLOSE_HOUR = 17;

// ─── Timezone helpers ─────────────────────────────────────────────────────────

/** Milliseconds that `timeZone` is ahead of UTC at the given instant. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl renders midnight as hour 24 in some engines; normalise it.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUtc - instant.getTime();
}

/**
 * The UTC instant corresponding to a wall-clock time in `timeZone`.
 *
 * Two passes: the offset depends on the instant, and the instant depends on the
 * offset. The second pass settles DST boundary cases.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = BOARD_TIMEZONE
): Date {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = offsetMs(new Date(wallClock), timeZone);
  let instant = wallClock - first;
  const second = offsetMs(new Date(instant), timeZone);
  if (second !== first) instant = wallClock - second;
  return new Date(instant);
}

/** Calendar Y/M/D as seen in `timeZone`, not in the runtime's local zone. */
function zonedParts(instant: Date, timeZone: string = BOARD_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// ─── Holidays ─────────────────────────────────────────────────────────────────

/** Easter Sunday (anonymous Gregorian algorithm), as [month, day]. */
function easter(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const key = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Nth given weekday of a month, e.g. nthWeekday(2026, 9, 1, 1) = first Monday of September. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
}

/**
 * National statutory holidays — the ones on which campus stores are closed
 * everywhere in Canada. Deliberately excludes province-specific days
 * (Family Day, Civic Holiday, St. Jean-Baptiste): the board spans six
 * provinces, and a deadline that slips because one director's province had a
 * holiday is worse than one that doesn't.
 */
export function nationalHolidays(year: number): Set<string> {
  const days = new Set<string>();
  const fixed: Array<[number, number]> = [
    [1, 1], // New Year's Day
    [7, 1], // Canada Day
    [12, 25], // Christmas Day
    [12, 26], // Boxing Day
  ];

  // Fixed-date holidays falling on a weekend are observed on the next weekday.
  // Christmas and Boxing Day can cascade onto Monday *and* Tuesday.
  const taken = new Set<string>();
  for (const [month, day] of fixed) {
    const date = new Date(Date.UTC(year, month - 1, day));
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6 || taken.has(date.toISOString())) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    taken.add(date.toISOString());
    days.add(key(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()));
  }

  const [em, ed] = easter(year);
  const goodFriday = new Date(Date.UTC(year, em - 1, ed - 2));
  days.add(
    key(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate())
  );

  days.add(key(year, 9, nthWeekday(year, 9, 1, 1))); // Labour Day — 1st Monday of September
  days.add(key(year, 10, nthWeekday(year, 10, 1, 2))); // Thanksgiving — 2nd Monday of October

  return days;
}

/** Weekend or national holiday, evaluated in the board's timezone. */
export function isBusinessDay(year: number, month: number, day: number): boolean {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !nationalHolidays(year).has(key(year, month, day));
}

// ─── Deadline ─────────────────────────────────────────────────────────────────

/**
 * The instant a vote opened at `openedAt` should close: `businessDays` business
 * days later, at 5:00 PM Eastern.
 *
 * Counting starts the day *after* the vote opens, so a vote posted at 4:55 PM
 * still gets three full working days rather than five minutes of one.
 */
export function computeClosesAt(openedAt: Date, businessDays = 3): Date {
  const { year, month, day } = zonedParts(openedAt);
  const cursor = new Date(Date.UTC(year, month - 1, day));

  let counted = 0;
  while (counted < businessDays) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (
      isBusinessDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate())
    ) {
      counted++;
    }
  }

  return zonedTimeToUtc(
    cursor.getUTCFullYear(),
    cursor.getUTCMonth() + 1,
    cursor.getUTCDate(),
    BOARD_CLOSE_HOUR,
    0
  );
}

/** "Monday, August 24 at 5:00 PM ET" — for Butler's post and reminder comment. */
export function formatCloseLabel(closesAt: Date): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOARD_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(closesAt);

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: BOARD_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(closesAt);

  return `${date} at ${time} ET`;
}

/**
 * When to post the "closes tomorrow" reminder comment: 24h before close, but
 * never before the vote opened (a 1-business-day vote would otherwise want to
 * remind in the past).
 */
export function computeReminderAt(openedAt: Date, closesAt: Date): Date {
  const dayBefore = new Date(closesAt.getTime() - 24 * 60 * 60 * 1000);
  return dayBefore > openedAt ? dayBefore : openedAt;
}
