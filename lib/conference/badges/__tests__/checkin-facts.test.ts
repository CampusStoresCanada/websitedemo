import { describe, expect, it } from "vitest";
import { checkInFactsFromRun, openSeatsFromRun, todayVerdict, verdictForDay } from "../checkin";
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

describe("the CANCOLL pin at pickup", () => {
  it("is for people from a CANCOLL school, and nobody else", () => {
    const facts = checkInFactsFromRun(run(), new Map(), [], new Set(["org-Northern College"]));
    expect(facts.p2.cancollPin).toBe(true);
    expect(facts.p1.cancollPin).toBe(false);
  });

  it("goes to nobody when the school list is not known", () => {
    expect(checkInFactsFromRun(run()).p2.cancollPin).toBe(false);
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

/**
 * Which reprint job the desk is being asked for.
 *
 * ⛔ The desk cannot work this out for itself. It has one scanned person; the
 * answer depends on whether that person's COMPANY still has an unnamed seat
 * somewhere in the print run, which is a fact about the whole run.
 */
describe("reprint mode on the desk facts", () => {
  it("overprints a company blank when that company still has an unnamed seat", () => {
    const facts = checkInFactsFromRun(
      run({
        types: [
          {
            entityId: "type-a",
            name: "Full Conference",
            accessSummary: access(),
            agenda: [],
            seats: [
              seat("s1", "Sundry Goods", { personId: "p1", firstName: "Ada", lastName: "L" }),
              // Same company, nobody named — so a blank for it went to print.
              seat("s2", "Sundry Goods", null),
            ],
          },
        ],
      } as never)
    );
    expect(facts.p1.reprintStock).toBe("company_blank");
  });

  it("prints the whole card when every seat at that company is named", () => {
    const facts = checkInFactsFromRun(
      run({
        types: [
          {
            entityId: "type-a",
            name: "Full Conference",
            accessSummary: access(),
            agenda: [],
            seats: [seat("s1", "Sundry Goods", { personId: "p1", firstName: "Ada", lastName: "L" })],
          },
        ],
      } as never)
    );
    expect(facts.p1.reprintStock).toBe("none");
  });

  it("does not let one company's blank cover another company's person", () => {
    const facts = checkInFactsFromRun(
      run({
        types: [
          {
            entityId: "type-a",
            name: "Full Conference",
            accessSummary: access(),
            agenda: [],
            seats: [
              seat("s1", "Sundry Goods", { personId: "p1", firstName: "Ada", lastName: "L" }),
              seat("s2", "Other Co", null),
            ],
          },
        ],
      } as never)
    );
    expect(facts.p1.reprintStock).toBe("none");
  });
});

/**
 * ⛔ What the desk's company search offers a walk-up: seats their company holds
 * with nobody named. Read from the same run the badges print from, so a seat
 * the desk offers is a seat a blank was printed for.
 */
describe("openSeatsFromRun", () => {
  it("lists only unnamed seats, with their company and registration type", () => {
    const open = openSeatsFromRun(
      run({
        types: [
          {
            entityId: "type-full",
            name: "Full Conference",
            accessSummary: access(),
            agenda: [],
            seats: [
              seat("s1", "Sundry Goods", { personId: "p1", firstName: "Ada", lastName: "L" }),
              seat("s2", "Sundry Goods", null),
            ],
          },
          {
            entityId: "type-day",
            name: "Day Pass",
            accessSummary: access(),
            agenda: [],
            seats: [seat("s3", "Other Co", null)],
          },
        ],
      } as never)
    );
    expect(open).toEqual([
      {
        seatId: "s2",
        organizationId: "org-Sundry Goods",
        organizationName: "Sundry Goods",
        registrationTypeId: "type-full",
        registrationTypeName: "Full Conference",
        entityKind: "registration",
      },
      {
        seatId: "s3",
        organizationId: "org-Other Co",
        organizationName: "Other Co",
        registrationTypeId: "type-day",
        registrationTypeName: "Day Pass",
        entityKind: "registration",
      },
    ]);
  });

  it("offers nothing when every seat is named", () => {
    expect(openSeatsFromRun(run())).toEqual([]);
  });
});

/**
 * ⛔ The day rule, which the desk card shows AND the scan enforces: on a
 * conference day, a badge that does not cover it is refused (Stephen,
 * 2026-10-19). Off conference days it says nothing.
 */
describe("verdictForDay", () => {
  const conferenceDates = ["2027-02-02", "2027-02-03", "2027-02-04"];
  const thursdayPass = ["2027-02-04"];

  it("admits on a day the badge covers", () => {
    expect(verdictForDay(thursdayPass, conferenceDates, "2027-02-04")).toEqual({ admitted: true });
  });

  it("refuses on a conference day the badge does not cover", () => {
    expect(verdictForDay(thursdayPass, conferenceDates, "2027-02-02")).toEqual({ admitted: false });
  });

  it("says nothing on a day that is not a conference day", () => {
    expect(verdictForDay(thursdayPass, conferenceDates, "2026-10-19")).toBeNull();
  });

  it("says nothing when it does not know the badge's days", () => {
    expect(verdictForDay([], conferenceDates, "2027-02-02")).toBeNull();
  });
});
