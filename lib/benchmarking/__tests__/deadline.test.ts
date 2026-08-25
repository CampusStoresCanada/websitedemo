import { describe, it, expect } from "vitest";
import { formatDeadline, formatOpening, daysUntilDeadline } from "../deadline";

/**
 * The 2026 cycle: opens 2026-10-08T12:00Z, closes 2026-11-21T08:00Z.
 *
 * The closing value is midnight Pacific — an EXCLUSIVE boundary chosen so that
 * November 20 is a full working day coast to coast. Every member-facing surface
 * must say the 20th. Saying the 21st hands 52 institutions a deadline a day
 * later than the real one.
 */
const CLOSES = "2026-11-21T08:00:00+00";
const OPENS = "2026-10-08T12:00:00+00";

describe("formatDeadline", () => {
  it("names the last day a store can file, not the boundary day", () => {
    expect(formatDeadline(CLOSES)).toBe("November 20, 2026");
  });

  it("survives the raw Postgres rendering as well as the client's", () => {
    // supabase-js returns "2026-11-21T08:00:00+00:00", which parses fine. These
    // are the other two shapes the same value takes — the space-separated form
    // psql and the MCP SQL tool return, and the hours-only `+00` offset that is
    // not valid ISO 8601. Neither reaches this code today; both are here so a
    // future caller reading a timestamp from somewhere else cannot reintroduce
    // a silent Invalid Date.
    expect(formatDeadline("2026-11-21 08:00:00+00")).toBe("November 20, 2026");
    expect(formatDeadline("2026-11-21T08:00:00+00")).toBe("November 20, 2026");
    expect(formatDeadline("2026-11-21T08:00:00+00:00")).toBe("November 20, 2026");
  });

  it("handles a boundary that is already an exact UTC midnight", () => {
    // 2026-11-21T00:00Z is 2026-11-20 16:00 Pacific, so the last day is still
    // the 20th — the helper must not assume the boundary is always Pacific
    // midnight.
    expect(formatDeadline("2026-11-21T00:00:00Z")).toBe("November 20, 2026");
  });

  it("returns null rather than an invalid date string", () => {
    expect(formatDeadline(null)).toBeNull();
    expect(formatDeadline("not a date")).toBeNull();
  });
});

describe("formatOpening", () => {
  it("reads the opening instant as-is — it is inclusive, unlike the deadline", () => {
    expect(formatOpening(OPENS)).toBe("October 8, 2026");
  });
});

describe("daysUntilDeadline", () => {
  it("rounds up so the final day reads as 1, never 0", () => {
    // Mid-morning Pacific on the last day. A reminder saying "0 days left" on a
    // morning someone can still file is both wrong and discouraging.
    const lastDay = new Date("2026-11-20T18:00:00Z");
    expect(daysUntilDeadline(CLOSES, lastDay)).toBe(1);
  });

  it("never goes negative once the survey has closed", () => {
    expect(daysUntilDeadline(CLOSES, new Date("2026-12-01T00:00:00Z"))).toBe(0);
  });

  it("counts a month out correctly", () => {
    expect(daysUntilDeadline(CLOSES, new Date("2026-10-22T08:00:00Z"))).toBe(30);
  });
});
