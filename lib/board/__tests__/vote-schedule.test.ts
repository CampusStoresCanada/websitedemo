import { describe, it, expect } from "vitest";
import {
  computeClosesAt,
  formatCloseLabel,
  isBusinessDay,
  nationalHolidays,
  zonedTimeToUtc,
  computeReminderAt,
} from "@/lib/board/vote-schedule";

/** Wall-clock time in Toronto, as a UTC instant. */
const et = (y: number, m: number, d: number, hh = 10, mm = 0) => zonedTimeToUtc(y, m, d, hh, mm);

describe("zonedTimeToUtc", () => {
  it("resolves EDT (summer) correctly — 5pm ET is 21:00 UTC", () => {
    expect(zonedTimeToUtc(2026, 8, 24, 17, 0).toISOString()).toBe("2026-08-24T21:00:00.000Z");
  });

  it("resolves EST (winter) correctly — 5pm ET is 22:00 UTC", () => {
    expect(zonedTimeToUtc(2026, 1, 14, 17, 0).toISOString()).toBe("2026-01-14T22:00:00.000Z");
  });
});

describe("nationalHolidays", () => {
  it("includes the fixed national days", () => {
    const h = nationalHolidays(2027);
    expect(h.has("2027-01-01")).toBe(true); // New Year's, a Friday
    expect(h.has("2027-07-01")).toBe(true); // Canada Day
  });

  it("computes Good Friday from Easter", () => {
    // Easter Sunday 2026 is April 5 → Good Friday April 3.
    expect(nationalHolidays(2026).has("2026-04-03")).toBe(true);
    // Easter Sunday 2027 is March 28 → Good Friday March 26.
    expect(nationalHolidays(2027).has("2027-03-26")).toBe(true);
  });

  it("finds Labour Day and Thanksgiving", () => {
    const h = nationalHolidays(2026);
    expect(h.has("2026-09-07")).toBe(true); // 1st Monday of September
    expect(h.has("2026-10-12")).toBe(true); // 2nd Monday of October
  });

  it("observes a weekend Canada Day on the following Monday", () => {
    // July 1 2028 is a Saturday → observed Monday July 3.
    const h = nationalHolidays(2028);
    expect(h.has("2028-07-03")).toBe(true);
  });

  it("cascades Christmas and Boxing Day off a weekend without collision", () => {
    // Dec 25 2027 is a Saturday, Dec 26 a Sunday → observed Mon 27 and Tue 28.
    const h = nationalHolidays(2027);
    expect(h.has("2027-12-27")).toBe(true);
    expect(h.has("2027-12-28")).toBe(true);
  });

  it("excludes province-specific days — the board spans six provinces", () => {
    // Family Day (3rd Monday of Feb) and the August Civic Holiday are not national.
    const h = nationalHolidays(2026);
    expect(h.has("2026-02-16")).toBe(false);
    expect(h.has("2026-08-03")).toBe(false);
  });
});

describe("isBusinessDay", () => {
  it("rejects weekends", () => {
    expect(isBusinessDay(2026, 8, 22)).toBe(false); // Saturday
    expect(isBusinessDay(2026, 8, 23)).toBe(false); // Sunday
  });

  it("accepts an ordinary weekday", () => {
    expect(isBusinessDay(2026, 8, 20)).toBe(true); // Thursday
  });

  it("rejects a statutory holiday", () => {
    expect(isBusinessDay(2026, 12, 25)).toBe(false);
  });
});

describe("computeClosesAt", () => {
  it("counts three business days from a Wednesday, skipping the weekend", () => {
    // Opened Wed Aug 19 2026 → Thu 20, Fri 21, Mon 24.
    const closes = computeClosesAt(et(2026, 8, 19, 14, 30));
    expect(closes.toISOString()).toBe("2026-08-24T21:00:00.000Z");
    expect(formatCloseLabel(closes)).toBe("Monday, August 24 at 5:00 PM ET");
  });

  it("does not shortchange a vote opened late in the day", () => {
    // Counting starts the day after, so 4:55 PM still gets three full days.
    const late = computeClosesAt(et(2026, 8, 19, 16, 55));
    const early = computeClosesAt(et(2026, 8, 19, 9, 0));
    expect(late.toISOString()).toBe(early.toISOString());
  });

  it("skips a statutory holiday in the middle of the window", () => {
    // Opened Thu Dec 24 2026 → Fri 25 is Christmas, Mon 28 is Boxing Day
    // observed, so: Tue 29, Wed 30, Thu 31.
    const closes = computeClosesAt(et(2026, 12, 24, 10, 0));
    expect(formatCloseLabel(closes)).toBe("Thursday, December 31 at 5:00 PM ET");
  });

  it("carries a Friday vote across the weekend", () => {
    // Opened Fri Aug 21 2026 → Mon 24, Tue 25, Wed 26.
    expect(formatCloseLabel(computeClosesAt(et(2026, 8, 21)))).toBe(
      "Wednesday, August 26 at 5:00 PM ET"
    );
  });

  it("handles the EST→EDT switch inside the window", () => {
    // DST begins Sunday March 8 2026. Opened Thu Mar 5 → Fri 6, Mon 9, Tue 10.
    // Tuesday is EDT, so 5pm local is 21:00 UTC, not 22:00.
    const closes = computeClosesAt(et(2026, 3, 5, 10, 0));
    expect(closes.toISOString()).toBe("2026-03-10T21:00:00.000Z");
    expect(formatCloseLabel(closes)).toBe("Tuesday, March 10 at 5:00 PM ET");
  });

  it("accepts a different window length", () => {
    expect(formatCloseLabel(computeClosesAt(et(2026, 8, 19), 1))).toBe(
      "Thursday, August 20 at 5:00 PM ET"
    );
  });
});

describe("computeReminderAt", () => {
  it("lands 24h before close", () => {
    const opened = et(2026, 8, 19, 10, 0);
    const closes = computeClosesAt(opened);
    expect(computeReminderAt(opened, closes).toISOString()).toBe("2026-08-23T21:00:00.000Z");
  });

  it("never schedules a reminder before the vote opened", () => {
    const opened = et(2026, 8, 19, 10, 0);
    const closes = computeClosesAt(opened, 1); // closes tomorrow at 5pm
    expect(computeReminderAt(opened, closes).getTime()).toBeGreaterThanOrEqual(opened.getTime());
  });
});
