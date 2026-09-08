import { describe, expect, it } from "vitest";
import { checkInFactsFromRun, todayVerdict } from "../checkin";
import type { BadgeRun } from "../run";

/**
 * The desk must describe a badge the same way the badge does.
 *
 * ⛔ It used to read `conference_people.person_kind` — three values (delegate /
 * staff / exhibitor) for a conference that sells ten registration types. Every
 * Board Registration holder showed as "delegate", and a Thursday Day Pass
 * holder would have too, so the desk could not tell a four-day attendee from a
 * one-day pass at the moment somebody was standing in front of it.
 */

const seat = (id: string, org: string, person: Record<string, unknown> | null) =>
  ({
    seatId: id,
    organizationId: `org-${org}`,
    organizationName: org,
    organizationCity: "",
    organizationProvince: "",
    seatedAt: null,
    person,
  }) as never;

const access = (over: Record<string, unknown> = {}) =>
  ({
    days: ["Tue, Feb 2"],
    mealsIncluded: false,
    meetingDay: null,
    tradeShowDays: [],
    events: [],
    exhibitorCount: 0,
    ...over,
  }) as never;

const run = (over: Partial<BadgeRun> = {}): BadgeRun =>
  ({
    types: [
      {
        entityId: "type-day",
        name: "Thursday Day Pass",
        accessSummary: access({ days: ["Thu, Feb 4"] }),
        agenda: [],
        seats: [seat("s1", "Sundry Goods", { personId: "p1", firstName: "Ada", lastName: "L" })],
      },
      {
        entityId: "type-full",
        name: "Full Conference Registration",
        accessSummary: access({ days: ["Tue, Feb 2", "Wed, Feb 3", "Thu, Feb 4"] }),
        agenda: [],
        seats: [seat("s2", "Northern College", { personId: "p2", firstName: "Bo", lastName: "M" })],
      },
    ],
    peopleInMultipleTypes: [],
    venueAddress: null,
    entitlements: [],
    ...over,
  }) as BadgeRun;

describe("checkInFactsFromRun", () => {
  it("names the registration type from the catalogue, not a person kind", () => {
    const facts = checkInFactsFromRun(run());
    expect(facts.p1.registrationType).toBe("Thursday Day Pass");
    expect(facts.p2.registrationType).toBe("Full Conference Registration");
  });

  it("separates a one-day pass from a full registration by its days", () => {
    const facts = checkInFactsFromRun(run());
    expect(facts.p1.days).toEqual(["Thu, Feb 4"]);
    expect(facts.p2.days).toHaveLength(3);
  });

  it("carries the organisation, so a bare name is not all the desk gets", () => {
    expect(checkInFactsFromRun(run()).p1.organizationName).toBe("Sundry Goods");
  });

  it("leaves an unnamed seat out — there is nobody to scan", () => {
    const r = run();
    r.types[0].seats = [seat("s3", "Sundry Goods", null)];
    expect(Object.keys(checkInFactsFromRun(r))).toEqual(["p2"]);
  });

  /**
   * ⛔ Per PERSON, not per type. Event seats are sold separately, so the
   * type-level summary under-reports whoever bought an add-on — and an add-on
   * is exactly the thing a door is checking for.
   */
  it("prefers the person's own entitlement over the type's summary", () => {
    const facts = checkInFactsFromRun(
      run({
        entitlements: [
          {
            personId: "p1",
            access: access({ days: ["Thu, Feb 4"], events: ["Gala"], mealsIncluded: true }),
            agenda: [],
          },
        ],
      })
    );
    expect(facts.p1.admittedTo).toContain("Meals included");
    expect(facts.p1.admittedTo).toContain("1 evening event");
    // p2 has no entitlement row and still falls back to its type.
    expect(facts.p2.days).toHaveLength(3);
  });

  it("says nothing rather than guessing when there is no access data", () => {
    const r = run();
    r.types[0].accessSummary = null as never;
    const facts = checkInFactsFromRun(r);
    expect(facts.p1.days).toEqual([]);
    expect(facts.p1.admittedTo).toEqual([]);
  });
});

describe("todayVerdict", () => {
  const CONF_DATES = ["2027-02-02", "2027-02-03", "2027-02-04"];
  const on = (d: string) => new Date(`${d}T09:00:00`);

  it("says admitted when the badge covers today", () => {
    expect(
      todayVerdict({ dayDates: ["2027-02-03"] }, CONF_DATES, on("2027-02-03"))
    ).toEqual({ admitted: true });
  });

  // The whole point: a day pass on the wrong day is the thing a door catches.
  it("says not valid when today is a conference day the badge does not cover", () => {
    expect(
      todayVerdict({ dayDates: ["2027-02-04"] }, CONF_DATES, on("2027-02-03"))
    ).toEqual({ admitted: false });
  });

  /**
   * ⛔ Silent off-season. A badge scanned during setup, or while somebody is
   * testing the desk five months out, must not be stamped "NOT VALID TODAY" —
   * true, and completely useless.
   */
  it("says nothing at all when today is not a conference day", () => {
    expect(todayVerdict({ dayDates: ["2027-02-03"] }, CONF_DATES, on("2026-09-04"))).toBeNull();
  });

  it("says nothing when the badge carries no dated days", () => {
    expect(todayVerdict({ dayDates: [] }, CONF_DATES, on("2027-02-03"))).toBeNull();
    expect(todayVerdict(null, CONF_DATES, on("2027-02-03"))).toBeNull();
  });

  /**
   * ⚠️ Local, not UTC. The desk is a laptop in Mississauga; an evening scan
   * must not roll over to the next day because UTC already has.
   */
  it("uses the desk's local day, not UTC", () => {
    // 21:00 local on Feb 3 is already Feb 4 in UTC.
    expect(
      todayVerdict({ dayDates: ["2027-02-03"] }, CONF_DATES, new Date("2027-02-03T21:00:00"))
    ).toEqual({ admitted: true });
  });
});
