import { describe, it, expect } from "vitest";
import { nextOccurrence } from "@/lib/board/recurrence";

const TODAY = "2026-08-19";
// The real board series: last Thursday monthly, except December, which is
// deliberately pulled forward to avoid New Year's Eve.
const MEETINGS = ["2026-08-27", "2026-09-24", "2026-10-29", "2026-11-26", "2026-12-17"];

describe("nextOccurrence — every board meeting", () => {
  it("lands on the next real meeting, not a four-week interval", () => {
    expect(nextOccurrence("each_meeting", "2026-08-27", MEETINGS, TODAY)).toBe("2026-09-24");
  });

  it("respects the December exception rather than drifting", () => {
    // A 4-week interval from Nov 26 would give Dec 24; the board meets Dec 17.
    expect(nextOccurrence("each_meeting", "2026-11-26", MEETINGS, TODAY)).toBe("2026-12-17");
  });

  it("returns null once the calendar runs out, rather than inventing a date", () => {
    expect(nextOccurrence("each_meeting", "2026-12-17", MEETINGS, TODAY)).toBeNull();
  });

  it("skips meetings already past when the instance was overdue", () => {
    expect(nextOccurrence("each_meeting", "2026-06-23", MEETINGS, TODAY)).toBe("2026-08-27");
  });
});

describe("nextOccurrence — monthly and quarterly", () => {
  it("advances one month", () => {
    expect(nextOccurrence("monthly", "2026-09-15", MEETINGS, TODAY)).toBe("2026-10-15");
  });

  it("advances three months", () => {
    expect(nextOccurrence("quarterly", "2026-09-15", MEETINGS, TODAY)).toBe("2026-12-15");
  });

  it("clamps rather than rolling over a short month", () => {
    // Jan 31 + 1 month is Feb 28, not Mar 3.
    expect(nextOccurrence("monthly", "2027-01-31", MEETINGS, TODAY)).toBe("2027-02-28");
  });

  it("never schedules the next instance in the past", () => {
    // Completing something that was due in April must not create a May task.
    const next = nextOccurrence("monthly", "2026-04-30", MEETINGS, TODAY);
    expect(next).not.toBeNull();
    expect(next! > TODAY).toBe(true);
  });
});
