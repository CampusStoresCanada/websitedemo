import { describe, expect, it } from "vitest";
import { zonedWallTimeToUtcIso } from "../tz";

/**
 * `meeting_slots.start_time` is `time without time zone` — the wall clock in the
 * conference's own zone, not an instant. Stamping it with Date.UTC() and then
 * rendering it in that zone subtracts the whole offset, so a 09:30 meeting
 * displayed as 04:30. It survived because `schedules` had no rows: the branch
 * that builds these items had never executed against data.
 *
 * These lock the arithmetic. The display path is covered by the conference
 * agenda view, which formats whatever instant lands here.
 */
describe("meeting slot placement", () => {
  const TZ = "America/Toronto";
  const DAY = "2027-02-02"; // Tuesday of CSC 2027 — the only day carrying a meeting cadence

  function localHhMm(iso: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  }

  it("places a 09:30 wall time at 14:30Z in February (EST, UTC-5)", () => {
    expect(zonedWallTimeToUtcIso(DAY, "09:30:00", TZ)).toBe("2027-02-02T14:30:00.000Z");
  });

  it("round-trips back to the wall time the slot was authored in", () => {
    for (const wall of ["09:30:00", "09:42:00", "13:30:00", "16:15:00"]) {
      const iso = zonedWallTimeToUtcIso(DAY, wall, TZ);
      expect(localHhMm(iso)).toBe(wall.slice(0, 5));
    }
  });

  it("is the whole UTC offset away from the Date.UTC() stamping it replaced", () => {
    // What the old code did: treat the wall clock as if it were already UTC.
    const wrong = new Date(Date.UTC(2027, 1, 2, 9, 30, 0)).toISOString();
    expect(localHhMm(wrong)).toBe("04:30"); // the bug, exactly as it rendered
    expect(localHhMm(zonedWallTimeToUtcIso(DAY, "09:30:00", TZ))).toBe("09:30");
  });

  it("stays correct across a DST boundary, so a summer conference does not drift", () => {
    // July is EDT (UTC-4); February is EST (UTC-5). One fixed offset cannot do both.
    expect(zonedWallTimeToUtcIso("2027-07-14", "09:30:00", TZ)).toBe("2027-07-14T13:30:00.000Z");
    expect(zonedWallTimeToUtcIso("2027-02-02", "09:30:00", TZ)).toBe("2027-02-02T14:30:00.000Z");
  });
});
