import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatDayMonth } from "../supabase-timestamp";

describe("calendar dates are not instants", () => {
  it("formats a bare date as itself", () => {
    expect(formatCalendarDate("2027-01-18")).toBe("18 January 2027");
    expect(formatCalendarDate("2026-12-30")).toBe("30 December 2026");
  });

  it("does not shift a date backwards into the previous day", () => {
    // Parsed as UTC midnight and rendered in Toronto, 2027-01-18 becomes the
    // 17th. A supplier deadline means that date wherever you are standing.
    expect(formatCalendarDate("2027-01-18")).toContain("18");
  });

  it("explains why formatDayMonth could not do this job", () => {
    // The bug: four Stronco/Encore deadlines rendered as raw ISO strings
    // because the timestamp parser returns null for a date-only value.
    expect(formatDayMonth("2027-01-18")).toBeNull();
  });

  it("rejects anything that is not a calendar date", () => {
    expect(formatCalendarDate("2027-01-18T10:00:00Z")).toBeNull();
    expect(formatCalendarDate("18 January")).toBeNull();
    expect(formatCalendarDate("2027-13-01")).toBeNull();
  });
});
