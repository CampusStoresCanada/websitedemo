import { describe, expect, it } from "vitest";

import { resolveMeetingGeometryFromEntities } from "../meeting-geometry";

describe("resolveMeetingGeometryFromEntities", () => {
  it("ignores a stale organization_id left in the attributes bag", () => {
    // The old copies are still sitting on 13 suites. They must not win over,
    // or stand in for, the derived holder — otherwise retiring them silently
    // resurrects the drift this change removed.
    const geo = resolveMeetingGeometryFromEntities(
      [],
      [{ suiteNumber: 7, organizationId: null, attributes: { organization_id: "org-stale" } }]
    );
    expect(geo.suiteOrgAssignmentsBySuiteNumber).toEqual({});
  });

  it("derives a day's meeting count from its cadence window", () => {
    const geo = resolveMeetingGeometryFromEntities(
      [
        {
          date: "2027-02-01",
          attributes: {
            meeting_start_time: "09:00",
            meeting_end_time: "12:00",
            slot_duration_minutes: 30,
            meeting_buffer_minutes: 0,
          },
        },
      ],
      [{ attributes: { suite_number: 1 } }, { attributes: { suite_number: 2 } }]
    );

    expect(geo.suitesTarget).toBe(2);
    expect(geo.dayConfigs).toHaveLength(1);
    const day = geo.dayConfigs[0];
    expect(day.date).toBe("2027-02-01");
    expect(day.dayNumber).toBe(1);
    expect(day.meetingCount).toBe(6); // 180 min / 30
    expect(day.startTime).toBe("09:00:00");
    expect(day.endTime).toBe("12:00:00");
  });

  it("excludes days with no meeting cadence", () => {
    const geo = resolveMeetingGeometryFromEntities(
      [
        { date: "2027-02-01", attributes: {} }, // travel day, no cadence
        { date: "2027-02-02", attributes: { meeting_start_time: "09:00", meeting_end_time: "10:00", slot_duration_minutes: 30 } },
      ],
      []
    );
    expect(geo.dayConfigs.map((d) => d.date)).toEqual(["2027-02-02"]);
    expect(geo.dayConfigs[0].dayNumber).toBe(1);
    expect(geo.suitesTarget).toBe(0);
  });

  it("takes the larger of an explicit meeting_count and the derived count", () => {
    const geo = resolveMeetingGeometryFromEntities(
      [
        {
          date: "2027-02-01",
          attributes: { meeting_start_time: "09:00", meeting_end_time: "10:00", slot_duration_minutes: 30, meeting_count: 10 },
        },
      ],
      []
    );
    // derived = 60/30 = 2; explicit 10 wins
    expect(geo.dayConfigs[0].meetingCount).toBe(10);
  });

  it("numbers days by date order regardless of input order", () => {
    const cadence = { meeting_start_time: "09:00", meeting_end_time: "10:00", slot_duration_minutes: 30 };
    const geo = resolveMeetingGeometryFromEntities(
      [
        { date: "2027-02-03", attributes: cadence },
        { date: "2027-02-01", attributes: cadence },
      ],
      []
    );
    expect(geo.dayConfigs.map((d) => [d.date, d.dayNumber])).toEqual([
      ["2027-02-01", 1],
      ["2027-02-03", 2],
    ]);
  });

  it("maps a suite's holder by suite number, from the resolved value", () => {
    /**
     * This used to read `attributes.organization_id` — a hand-kept copy of who
     * bought the containing booth. It had already fallen one behind (booth 202,
     * Ookami Promo), so the scheduler could never seat anyone in that suite.
     *
     * The holder is now derived from the sale plus booth --includes--> suite and
     * passed in. Checked before removing the old read: all 13 typed values
     * agreed with the sale, and the derivation additionally finds the missing
     * one — a strict superset, nothing lost.
     */
    const geo = resolveMeetingGeometryFromEntities(
      [],
      [
        { suiteNumber: 1, organizationId: "org-a", attributes: {} },
        { suiteNumber: 2, organizationId: null, attributes: {} },
      ]
    );
    expect(geo.suiteOrgAssignmentsBySuiteNumber).toEqual({ "1": "org-a" });
    expect(geo.suitesTarget).toBe(2);
  });

  it("returns empty geometry for no days or suites", () => {
    const geo = resolveMeetingGeometryFromEntities([], []);
    expect(geo.dayConfigs).toEqual([]);
    expect(geo.meetingDays).toEqual([]);
    expect(geo.suitesTarget).toBe(0);
    expect(geo.suiteOrgAssignmentsBySuiteNumber).toEqual({});
  });
});
