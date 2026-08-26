import { describe, expect, it } from "vitest";
import { formatDayMonth, isValidDate, parseSupabaseTimestamp } from "../supabase-timestamp";

describe("parseSupabaseTimestamp", () => {
  it("handles the PostgREST shape with a colon in the offset", () => {
    expect(isValidDate(parseSupabaseTimestamp("2026-11-02T04:59:00+00:00"))).toBe(true);
  });

  it("handles the SQL-console shape: space separator, two-digit offset", () => {
    // This is the one that produced "NaN undefined" in a real send.
    expect(isValidDate(parseSupabaseTimestamp("2026-11-02 04:59:00+00"))).toBe(true);
  });

  it("handles a four-digit offset without a colon", () => {
    expect(isValidDate(parseSupabaseTimestamp("2026-11-01T23:59:00-0500"))).toBe(true);
  });

  it("handles an explicit Z", () => {
    expect(isValidDate(parseSupabaseTimestamp("2026-11-02T04:59:00Z"))).toBe(true);
  });

  it("reads a zone-less value as UTC, not as the server's local time", () => {
    expect(parseSupabaseTimestamp("2026-11-02T04:59:00").toISOString())
      .toBe("2026-11-02T04:59:00.000Z");
  });
});

describe("formatDayMonth", () => {
  it("renders an end-of-day Eastern deadline as its own day", () => {
    // 2 Nov 04:59 UTC is 1 Nov 23:59 EST. Formatted in UTC it would say 2 Nov.
    expect(formatDayMonth("2026-11-02T04:59:00+00:00")).toBe("1 November");
  });

  it("survives every shape the database emits", () => {
    for (const v of [
      "2026-11-02T04:59:00+00:00",
      "2026-11-02 04:59:00+00",
      "2026-11-02T04:59:00Z",
    ]) {
      expect(formatDayMonth(v), v).toBe("1 November");
    }
  });

  it("returns null rather than 'NaN undefined' on a bad value", () => {
    expect(formatDayMonth("not a timestamp")).toBeNull();
  });
});
