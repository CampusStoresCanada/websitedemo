/**
 * Parsing a timestamp that came out of Supabase.
 *
 * There are three shapes in play and hand-rolling the check gets one wrong
 * every time:
 *
 *   2026-11-02T04:59:00+00:00   PostgREST, offset with a colon
 *   2026-11-02 04:59:00+00      SQL console, space separator, 2-digit offset
 *   2026-11-02T04:59:00         no zone at all — must be read as UTC, because
 *                               `new Date()` would read it as the SERVER's
 *                               local time and shift it silently
 *
 * The bug this exists to stop: a guard of `endsWith("Z")` treats the first two
 * as zone-less, appends a `Z`, and produces `…+00:00Z` — an invalid date that
 * formats as "NaN undefined". That shipped in a real email before it was
 * caught, telling members a directory goes to press on "NaN undefined".
 */

/** Zone marker: `Z`, `+00`, `-0500`, or `+00:00`. */
const HAS_ZONE = /(?:Z|z|[+-]\d{2}(?::?\d{2})?)$/;
/** A bare hours-only offset — valid in Postgres output, invalid to `new Date`. */
const BARE_HOUR_OFFSET = /([+-]\d{2})$/;

export function parseSupabaseTimestamp(value: string): Date {
  const trimmed = value.trim();
  let normalized = trimmed.replace(" ", "T");

  if (!HAS_ZONE.test(trimmed)) {
    normalized = `${normalized}Z`;
  } else {
    // Detecting the zone is not enough. Postgres emits "+00", but the ECMAScript
    // Date Time String Format requires ±HH:mm, so V8 rejects the bare form and
    // returns Invalid Date — the same silent failure as appending a stray Z.
    normalized = normalized.replace(BARE_HOUR_OFFSET, "$1:00");
  }
  return new Date(normalized);
}

/** True when the value parsed to a real date — call before formatting. */
export const isValidDate = (d: Date): boolean => !Number.isNaN(d.getTime());

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "1 November" in a given zone. Defaults to Eastern, where the association's
 * deadlines are set — formatting a 23:59 deadline in UTC lands it on the
 * following day.
 */
export function formatDayMonth(value: string, timeZone = "America/Toronto"): string | null {
  const parsed = parseSupabaseTimestamp(value);
  if (!isValidDate(parsed)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, day: "numeric", month: "numeric" })
    .formatToParts(parsed);
  const day = parts.find((p) => p.type === "day")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (!day || !month) return null;
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}
