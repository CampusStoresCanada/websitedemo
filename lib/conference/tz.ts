/**
 * Wall-clock → absolute-instant conversion, without a date library.
 *
 * The catalog stores a thing's time as a local calendar date (on its Day) plus
 * a wall time ("09:00"). To place it on a real timeline we need the absolute
 * UTC instant for that wall time *in the conference's timezone* — accounting for
 * DST. We do it with `Intl` only: compute the zone's offset at the candidate
 * instant, then subtract it.
 */

/**
 * The signed offset, in milliseconds, of `timeZone` from UTC at the instant
 * `utcMs` (i.e. how far ahead local wall-clock is of UTC). Positive east of UTC.
 */
export function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour === 24 ? 0 : map.hour,
    map.minute,
    map.second
  );
  return asUtc - utcMs;
}

/**
 * Given a local calendar date (`YYYY-MM-DD`), a wall time (`HH:MM` or `HH:MM:SS`,
 * defaulting to midnight), and an IANA timezone, return the absolute instant as
 * a UTC ISO string. DST-correct: `09:00` in `America/Toronto` is `14:00Z` in
 * winter and `13:00Z` in summer.
 */
export function zonedWallTimeToUtcIso(
  dateYmd: string,
  timeHms: string | null | undefined,
  timeZone: string
): string {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const [hh = 0, mm = 0, ss = 0] = String(timeHms ?? "00:00")
    .split(":")
    .map((part) => Number(part) || 0);
  // Treat the wall time as if it were UTC, then correct by the zone's offset at
  // (approximately) that instant. One correction is exact except in the rare
  // DST fold/gap hour, which conference schedules don't land in.
  const utcGuess = Date.UTC(y, mo - 1, d, hh, mm, ss);
  const offset = timeZoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess - offset).toISOString();
}
