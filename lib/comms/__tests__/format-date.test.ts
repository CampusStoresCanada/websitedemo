import { describe, it, expect } from "vitest";
import { formatMemberFacingDate } from "../format";

describe("formatMemberFacingDate", () => {
  it("writes a stored date the way a person would", () => {
    expect(formatMemberFacingDate("2026-09-01")).toBe("September 1, 2026");
    expect(formatMemberFacingDate("2027-01-21")).toBe("January 21, 2027");
  });

  it("does not shift the day into another timezone", () => {
    // A renewal date is a calendar date, not a moment. Reading 2026-09-01 in a
    // negative-offset timezone turns it into August 31st, which is both wrong
    // and the kind of wrong nobody notices until a member argues about it.
    expect(formatMemberFacingDate("2026-09-01")).toContain("September 1");
    expect(formatMemberFacingDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatMemberFacingDate("2026-12-31")).toBe("December 31, 2026");
  });

  it("accepts a timestamp and uses its date part", () => {
    expect(formatMemberFacingDate("2026-09-01T23:59:00Z")).toBe("September 1, 2026");
    // Supabase timestamps arrive without a Z; the date part is still the date.
    expect(formatMemberFacingDate("2026-09-01 00:00:00")).toBe("September 1, 2026");
  });

  it("renders nothing rather than a literal null", () => {
    expect(formatMemberFacingDate(null)).toBe("");
    expect(formatMemberFacingDate(undefined)).toBe("");
    expect(formatMemberFacingDate("")).toBe("");
  });

  it("passes through anything that is not a date, rather than mangling it", () => {
    expect(formatMemberFacingDate("upon renewal")).toBe("upon renewal");
  });
});
