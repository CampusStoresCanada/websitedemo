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
  it("finds the third Wednesday of January", () => {
    expect(resolveAgmDate(CSC_ELECTIONS_CONFIG, 2027)).toBe("2027-01-20");
    expect(resolveAgmDate(CSC_ELECTIONS_CONFIG, 2028)).toBe("2028-01-19");
    expect(resolveAgmDate(CSC_ELECTIONS_CONFIG, 2029)).toBe("2029-01-17");
  });

  it("returns null where the occurrence does not exist", () => {
    // No fifth Wednesday in February 2027.
    expect(nthWeekdayOfMonth(2027, 2, 3, 5)).toBeNull();
  });
});

describe("the CSC 2026-27 cycle", () => {
  const schedule = deriveSchedule("2027-01-20", CSC_ELECTIONS_CONFIG);

  it("derives the four by-law countbacks", () => {
    expect(schedule).toEqual({
      agmDate: "2027-01-20",
      nominationsOpenAt: "2026-09-22", // 120 days
      nominationsCloseAt: "2026-10-22", // 90 days
      ballotsOpenAt: "2026-11-21", // 60 days
      ballotsCloseAt: "2026-12-21", // 30 days
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
    expect(phaseOn(schedule, "2027-01-20")).toBe("after_agm");
  });
});

describe("schedule validation", () => {
  it("rejects ballots opening before nominations close", () => {
    const broken = deriveSchedule("2027-01-20", {
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
