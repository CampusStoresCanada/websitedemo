/**
 * How a survey deadline is written down for a member.
 *
 * `benchmarking_surveys.closes_at` is an EXCLUSIVE boundary. The 2026 cycle
 * stores `2026-11-21T08:00:00Z`, which is midnight Pacific — chosen so that
 * November 20 is a full working day in every Canadian zone rather than ending
 * early out west. The last day a store can file is therefore the 20th, not the
 * 21st.
 *
 * Formatting that instant directly gives the wrong answer everywhere:
 *
 *   in UTC                 → "November 21"   the boundary day
 *   in America/Toronto     → "November 21"   03:00 on the 21st
 *   in America/Vancouver   → "November 21"   00:00 on the 21st
 *
 * All three name a day on which the survey is already shut. So the deadline is
 * the calendar day containing one millisecond BEFORE the boundary, read in the
 * zone the boundary was set for — the westernmost, because that is the store
 * with the least time left and the one a wrong date would cheat.
 *
 * This is not a display nicety. "Closes November 21" printed on a worksheet and
 * repeated in three emails would hand every member a deadline a day later than
 * the real one, and the stores that believed it would file into a closed survey.
 */

/** The zone the closing boundary is chosen against. See above. */
const BOUNDARY_ZONE = "America/Vancouver";

/**
 * Parse a Supabase timestamptz.
 *
 * Two traps, both of which silently produce the wrong answer rather than an
 * error:
 *
 *   `2026-11-21T08:00:00+00`  — Postgres renders a whole-hour offset as `+00`,
 *                               which is NOT valid ISO 8601. `new Date()` on the
 *                               T-separated form returns Invalid Date, so every
 *                               deadline would come out blank.
 *   `2026-11-21 08:00:00`     — no zone at all parses as LOCAL time, which on
 *                               Vercel is UTC and on a laptop is not.
 */
function parseTimestamp(value: string): Date | null {
  let s = value.trim().replace(" ", "T");

  if (/[+-]\d{2}$/.test(s)) {
    // `+00` → `+00:00`
    s = `${s}:00`;
  } else if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    // No zone marker at all: it is UTC, say so explicitly.
    s = `${s}Z`;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The last calendar day a store can file, as a member should read it.
 *
 * Takes the exclusive `closes_at` boundary and returns e.g. "November 20, 2026".
 */
export function formatDeadline(closesAt: string | null | undefined): string | null {
  if (!closesAt) return null;

  const boundary = parseTimestamp(closesAt);
  if (!boundary) return null;

  const lastMoment = new Date(boundary.getTime() - 1);
  return lastMoment.toLocaleDateString("en-CA", {
    timeZone: BOUNDARY_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Whole days remaining, counted the same way the deadline is written.
 *
 * Rounds up, so the last day reads as "1 day left" rather than "0" — a reminder
 * that says zero days on the morning someone can still file is both wrong and
 * discouraging.
 */
export function daysUntilDeadline(
  closesAt: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!closesAt) return 0;
  const boundary = parseTimestamp(closesAt);
  if (!boundary) return 0;
  return Math.max(0, Math.ceil((boundary.getTime() - now.getTime()) / 86_400_000));
}

/**
 * A plain opening date. `opens_at` is an INCLUSIVE instant — the moment the
 * doors open — so unlike the deadline it is read as-is, in the same zone, and
 * needs no adjustment.
 */
export function formatOpening(opensAt: string | null | undefined): string | null {
  if (!opensAt) return null;
  const d = parseTimestamp(opensAt);
  if (!d) return null;
  return d.toLocaleDateString("en-CA", {
    timeZone: BOUNDARY_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
