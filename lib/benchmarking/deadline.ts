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

/**
 * The last day a store can file, as `YYYY-MM-DD`.
 *
 * ⛔ The machine-readable twin of formatDeadline, for anywhere that has to sort
 * or compare rather than print — "is today past the deadline", a date chip on a
 * timeline. Slicing the raw boundary instead (`closesAt.slice(0, 10)`) is the
 * same off-by-one this file exists to prevent, and it is harder to spot here
 * because the string looks like a date rather than like a bug: the admin
 * timeline said "Closes 2026-11-21" directly beside a header reading
 * "closes November 20, 2026", for the same cycle, on the same screen.
 */
export function deadlineDay(closesAt: string | null | undefined): string | null {
  if (!closesAt) return null;
  const boundary = parseTimestamp(closesAt);
  if (!boundary) return null;
  return new Date(boundary.getTime() - 1).toLocaleDateString("en-CA", {
    timeZone: BOUNDARY_ZONE,
  });
}

/**
 * The day collection opens, as `YYYY-MM-DD`, read in the zone the boundary was
 * set for. Inclusive, so no adjustment — but still not a slice: `opens_at` is
 * stored as an instant, and `2026-10-08T00:00:00Z` is still October 7th out
 * west.
 */
export function openingDay(opensAt: string | null | undefined): string | null {
  if (!opensAt) return null;
  const d = parseTimestamp(opensAt);
  if (!d) return null;
  return d.toLocaleDateString("en-CA", { timeZone: BOUNDARY_ZONE });
}

/**
 * The UTC instant of midnight in the boundary zone, on a given calendar day.
 *
 * Two passes, because the offset you need depends on the instant you are
 * computing: guess midnight UTC, correct by the offset in force there, then
 * correct once more by the offset in force at the corrected instant. That
 * second pass is what makes a cycle closing in summer (PDT, −7) come out right
 * rather than an hour off a cycle closing in November (PST, −8). Midnight is
 * never the ambiguous hour in this zone — the transitions happen at 02:00 — so
 * it converges.
 */
function zoneMidnightUTC(day: string): Date {
  const offsetAt = (instant: Date): number => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: BOUNDARY_ZONE,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(instant)
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const asIfUTC = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    return asIfUTC - instant.getTime();
  };

  const guess = Date.parse(`${day}T00:00:00Z`);
  const once = guess - offsetAt(new Date(guess));
  return new Date(guess - offsetAt(new Date(once)));
}

/**
 * Turn "the last day a store can file" back into the exclusive boundary stored
 * in `closes_at` — midnight, in the zone the deadline is set for, on the day
 * AFTER the one named.
 *
 * ⛔ The inverse of formatDeadline, and the reason an editor can exist at all.
 * An admin form that puts the raw boundary in a date input shows a day on which
 * the survey is already shut, contradicting the header beside it — and saving
 * that value unchanged re-reads it as a bare date, which is midnight UTC, which
 * quietly moves the real cutoff eight hours earlier than the committee set. So
 * the input holds the last filing day, the same day the member is told, and
 * this puts the boundary back.
 */
export function boundaryFromLastDay(lastDay: string | null | undefined): string | null {
  if (!lastDay) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lastDay.trim());
  if (!m) return null;
  const dayAfter = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
    .toISOString()
    .slice(0, 10);
  return zoneMidnightUTC(dayAfter).toISOString();
}

/**
 * The instant collection opens, from a plain date. Inclusive, so it is midnight
 * on the day itself — the doors open at the start of it, out west, which is the
 * store with the least time.
 */
export function openingFromDay(day: string | null | undefined): string | null {
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.trim())) return null;
  return zoneMidnightUTC(day.trim()).toISOString();
}
