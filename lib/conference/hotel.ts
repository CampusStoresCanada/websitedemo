/**
 * Conference hotel booking — types, JSONB parsing, and display helpers.
 *
 * The public "Where you'll be staying" widget used to hardcode both the rate
 * ("$185/night for single occupancy") and the promise that a booking link was
 * coming. Both now come from conference_instances: `hotel_booking_url`,
 * `hotel_booking_cutoff`, and a `hotel_rates` JSONB array.
 *
 * Rates are stored in cents, like every other money value in this codebase, so
 * nothing here has to reason about floats.
 */

/** One room type in the block. */
export interface HotelRate {
  /** Client-generated UUID — stable across reorders. */
  id: string;
  /** Room type as guests will recognise it, e.g. "Single occupancy". */
  label: string;
  /** Nightly rate in cents. */
  rate_cents: number;
  /** Optional qualifier shown after the rate, e.g. "plus tax" or "max 2 guests". */
  note?: string;
}

export function parseHotelRates(raw: unknown): HotelRate[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is HotelRate =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as HotelRate).id === "string" &&
      typeof (item as HotelRate).label === "string" &&
      typeof (item as HotelRate).rate_cents === "number" &&
      Number.isFinite((item as HotelRate).rate_cents)
  );
}

/** "$185" for a whole-dollar rate, "$185.50" when there are cents. */
export function formatRate(rateCents: number): string {
  const dollars = rateCents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-CA")}`
    : `$${dollars.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A booking cutoff is a plain calendar date (no time, no zone) — the hotel
 * means "end of this day, local to the hotel". Comparing it against a
 * timestamp would make the deadline drift by a day depending on where the
 * viewer is, so compare date strings and let the whole day count.
 *
 * `today` is passed in rather than read from the clock so callers can render
 * deterministically and tests don't depend on when they run.
 */
export function isCutoffPassed(cutoff: string | null, today: string): boolean {
  if (!cutoff) return false;
  return cutoff.slice(0, 10) < today.slice(0, 10);
}

/** Whole days from `today` until the cutoff. Negative once it has passed. */
export function daysUntilCutoff(cutoff: string, today: string): number {
  const end = Date.parse(`${cutoff.slice(0, 10)}T00:00:00Z`);
  const start = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** "Friday, March 12, 2027" — the cutoff as a reader sees it. */
export function formatCutoffDate(cutoff: string): string {
  return new Date(`${cutoff.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * How urgently to nudge someone about the cutoff. "soon" is the only state
 * that earns visual weight — an amber callout months out is just noise the
 * reader learns to skip.
 */
export function cutoffUrgency(
  cutoff: string | null,
  today: string
): "none" | "upcoming" | "soon" | "passed" {
  if (!cutoff) return "none";
  const days = daysUntilCutoff(cutoff, today);
  if (days < 0) return "passed";
  if (days <= 14) return "soon";
  return "upcoming";
}

/**
 * A note is plain text, but it routinely contains an email address ("contact
 * carolyn@…") or a URL, and a reader on a phone expects those to be tappable.
 *
 * Splitting into tokens here — rather than building an HTML string — is the
 * whole point: the component renders each token as a React node, so
 * admin-entered text can never become markup. There is no path from this
 * function to dangerouslySetInnerHTML.
 */
export type NoteToken =
  | { kind: "text"; value: string }
  | { kind: "email"; value: string }
  | { kind: "url"; value: string };

const LINKABLE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?]|[\w.+-]+@[\w-]+\.[\w.-]*[\w])/g;

export function tokenizeNote(note: string): NoteToken[] {
  const tokens: NoteToken[] = [];
  let lastIndex = 0;

  for (const match of note.matchAll(LINKABLE)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      tokens.push({ kind: "text", value: note.slice(lastIndex, start) });
    }
    tokens.push(
      value.startsWith("http") ? { kind: "url", value } : { kind: "email", value }
    );
    lastIndex = start + value.length;
  }

  if (lastIndex < note.length) {
    tokens.push({ kind: "text", value: note.slice(lastIndex) });
  }
  return tokens;
}
