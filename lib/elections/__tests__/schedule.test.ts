import { describe, it, expect } from "vitest";
import { CSC_ELECTIONS_CONFIG } from "../config";
import {
  nthWeekdayOfMonth,
  resolveAgmDate,
  deriveSchedule,
  validateSchedule,
  phaseOn,
} from "../schedule";

describe("AGM date resolution", () => {
  it("finds the third Thursday of January", () => {
    expect(resolveAgmDate(CSC_ELECTIONS_CONFIG, 2027)).toBe("2027-01-21");
    expect(resolveAgmDate(CSC_ELECTIONS_CONFIG, 2028)).toBe("2028-01-20");
    expect(resolveAgmDate(CSC_ELECTIONS_CONFIG, 2029)).toBe("2029-01-18");
  });

  it("moves every countback with the AGM rule", () => {
    // Moving Wednesday -> Thursday shifts all four windows by a day. Nothing
    // recomputes them by hand, which is the point of deriving them.
    const wed = deriveSchedule("2027-01-20", CSC_ELECTIONS_CONFIG);
    const thu = deriveSchedule("2027-01-21", CSC_ELECTIONS_CONFIG);
    expect(wed.nominationsOpenAt).toBe("2026-09-22");
    expect(thu.nominationsOpenAt).toBe("2026-09-23");
  });

  it("returns null where the occurrence does not exist", () => {
    // No fifth Thursday in February 2027.
    expect(nthWeekdayOfMonth(2027, 2, 4, 5)).toBeNull();
  });
});

describe("the CSC 2026-27 cycle", () => {
  const schedule = deriveSchedule("2027-01-21", CSC_ELECTIONS_CONFIG);

  it("keeps the ballot clear of the holiday shutdown", () => {
    // The by-law minimums (60/30) would run the ballot to Dec 22, into a period
    // when campus stores are closed. Running EARLIER than a minimum is
    // compliant; the deadline would have collected out-of-office replies.
    expect(schedule.ballotsCloseAt < "2026-12-18").toBe(true);
  });

  it("still satisfies every by-law minimum", () => {
    // "no fewer than 120 days", "no less than 60 days", "no less than 30 days"
    const days = (from: string) =>
      Math.round(
        (Date.parse("2027-01-21T00:00:00Z") - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
      );
    expect(days(schedule.nominationsOpenAt)).toBeGreaterThanOrEqual(120);
    expect(days(schedule.ballotsOpenAt)).toBeGreaterThanOrEqual(60);
    expect(days(schedule.ballotsCloseAt)).toBeGreaterThanOrEqual(30);
    // The 90-day nomination close is a member RIGHT and must not move earlier.
    expect(days(schedule.nominationsCloseAt)).toBe(90);
  });

  it("derives the four by-law countbacks", () => {
    expect(schedule).toEqual({
      agmDate: "2027-01-21",
      nominationsOpenAt: "2026-09-23", // 120 days
      nominationsCloseAt: "2026-10-23", // 90 days
      ballotsOpenAt: "2026-11-18", // 64 days — ahead of the 60-day minimum
      ballotsCloseAt: "2026-12-07", // 45 days — ahead of the 30-day minimum
    });
  });

  it("leaves a preparation gap between nominations closing and ballots opening", () => {
    // The reading that these are the same day is what makes the by-law look
    // self-contradictory. They are 30 days apart, and the committee needs it.
    expect(schedule.nominationsCloseAt).not.toBe(schedule.ballotsOpenAt);
    expect(schedule.nominationsCloseAt < schedule.ballotsOpenAt).toBe(true);
  });

  it("is internally coherent", () => {
    expect(validateSchedule(schedule)).toEqual([]);
  });

  it("reports which phase a date falls in", () => {
    expect(phaseOn(schedule, "2026-09-01")).toBe("before_nominations");
    expect(phaseOn(schedule, "2026-10-01")).toBe("nominating");
    expect(phaseOn(schedule, "2026-11-01")).toBe("between_nominations_and_ballot");
    expect(phaseOn(schedule, "2026-12-01")).toBe("balloting");
    expect(phaseOn(schedule, "2027-01-05")).toBe("after_ballot");
    expect(phaseOn(schedule, "2027-01-21")).toBe("after_agm");
  });
});

describe("schedule validation", () => {
  it("rejects ballots opening before nominations close", () => {
    const broken = deriveSchedule("2027-01-21", {
      ...CSC_ELECTIONS_CONFIG,
      schedule: {
        nominationsOpenDaysBefore: 120,
        nominationsCloseDaysBefore: 60,
        ballotsOpenDaysBefore: 90,
        ballotsCloseDaysBefore: 30,
      },
    });
    expect(validateSchedule(broken).join(" ")).toMatch(/cannot go out before nominations close/);
  });
});
