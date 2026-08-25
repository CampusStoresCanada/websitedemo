/**
 * Which day does this timestamp belong to, for grouping?
 *
 * The obvious `starts_at.slice(0, 10)` takes the **UTC** date, and every
 * calendar view then formats its heading in `America/Toronto`. Consistent
 * looking, wrong at the boundary: a deadline of 1 November 23:59 Eastern is
 * 2 November 04:59 UTC, so it grouped under the 2nd while claiming to be an
 * Eastern calendar. Anything between midnight and ~05:00 UTC lands a day late.
 *
 * `en-CA` formats as YYYY-MM-DD, which is the shape the rest of the calendar
 * already keys on — so this is a drop-in for the slice it replaces.
 */
import { isValidDate, parseSupabaseTimestamp } from "@/lib/time/supabase-timestamp";

export const CALENDAR_TIME_ZONE = "America/Toronto";

export function calendarDayKey(startsAt: string): string {
  // Shared parser: this file's own zone check was equally too narrow — it
  // missed Postgres's bare "+00" offset, which `new Date` then rejects.
  const parsed = parseSupabaseTimestamp(startsAt);
  if (!isValidDate(parsed)) return startsAt.slice(0, 10);
  return parsed.toLocaleDateString("en-CA", { timeZone: CALENDAR_TIME_ZONE });
}
