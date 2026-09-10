import { describe, expect, it } from "vitest";
import { calendarDayKey } from "../day-key";

/**
 * The calendar formats its headings in Eastern but used to GROUP by the UTC
 * date, via `starts_at.slice(0, 10)`. Anything between midnight and ~05:00 UTC
 * therefore landed a day late — an end-of-day deadline being exactly the case
 * that hits it.
 */
describe("calendarDayKey", () => {
  it("keeps a late-evening Eastern deadline on its own day", () => {
    // 1 Nov 23:59 EST is 2 Nov 04:59 UTC. The slice said the 2nd.
    expect(calendarDayKey("2026-11-02T04:59:00+00:00")).toBe("2026-11-01");
  });

  it("agrees with the slice when the time is safely mid-day", () => {
    expect(calendarDayKey("2026-09-18T12:00:00+00:00")).toBe("2026-09-18");
  });

  it("reads a zone-less timestamp as UTC, not as the viewer's local time", () => {
    // Supabase does not always emit a zone marker; parsed as local it would
    // shift by the viewer's offset and differ between two admins.
    expect(calendarDayKey("2026-11-02 04:59:00")).toBe("2026-11-01");
  });

  it("handles the summer offset too, not just winter", () => {
    // 1 Jul 03:30 UTC is 30 Jun 23:30 EDT.
    expect(calendarDayKey("2026-07-01T03:30:00+00:00")).toBe("2026-06-30");
  });

  it("falls back to the raw date rather than throwing on a bad value", () => {
    expect(calendarDayKey("not-a-date")).toBe("not-a-date");
  });
});
