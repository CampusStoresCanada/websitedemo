import { describe, expect, it } from "vitest";
import { defaultDeskTerm, deskTermsCover, nextIsoDate } from "../desk-staff";
import { isoDateInZone } from "../tz";

/**
 * ⛔ Desk staff are appointed FOR a conference, optionally for days. Suzie on
 * Wednesday at Conference 2027 is { start: Wed, end: Thu } — the end is
 * exclusive, as everywhere in governance_role_assignments.
 */
describe("deskTermsCover", () => {
  const wednesdayOnly = [{ termStart: "2027-02-03", termEnd: "2027-02-04" }];

  it("covers the day the shift is for", () => {
    expect(deskTermsCover(wednesdayOnly, "2027-02-03")).toBe(true);
  });

  it("does not cover the day before or the day after", () => {
    expect(deskTermsCover(wednesdayOnly, "2027-02-02")).toBe(false);
    expect(deskTermsCover(wednesdayOnly, "2027-02-04")).toBe(false);
  });

  it("covers any of several shifts", () => {
    const twoShifts = [...wednesdayOnly, { termStart: "2027-02-01", termEnd: "2027-02-02" }];
    expect(deskTermsCover(twoShifts, "2027-02-01")).toBe(true);
    expect(deskTermsCover(twoShifts, "2027-02-02")).toBe(false);
  });

  it("covers nothing with no appointments", () => {
    expect(deskTermsCover([], "2027-02-03")).toBe(false);
  });
});

describe("defaultDeskTerm (no days chosen)", () => {
  const conference = {
    registration_open_at: "2026-08-10T14:30:00+00:00",
    end_date: "2027-02-04",
    timezone: "America/Toronto",
  };

  it("runs from registration opening to the conference's last day", () => {
    expect(defaultDeskTerm(conference, "2026-07-01")).toEqual({
      termStart: "2026-08-10",
      termEnd: "2027-02-05",
    });
  });

  it("starts today when registration is already open", () => {
    expect(defaultDeskTerm(conference, "2026-10-19")?.termStart).toBe("2026-10-19");
  });

  it("cannot be made for a conference with no end date", () => {
    expect(defaultDeskTerm({ ...conference, end_date: null }, "2026-10-19")).toBeNull();
  });
});

describe("dates at the venue", () => {
  // ⛔ 9pm Wednesday in Ontario is already Thursday in UTC. A Wednesday shift
  // must still be on at 9pm at the desk.
  it("is still Wednesday at 9pm in Toronto", () => {
    const ninePmEastern = new Date("2027-02-04T02:00:00Z");
    expect(isoDateInZone(ninePmEastern, "America/Toronto")).toBe("2027-02-03");
    expect(ninePmEastern.toISOString().slice(0, 10)).toBe("2027-02-04");
  });

  it("steps an ISO date forward across a month end", () => {
    expect(nextIsoDate("2027-02-28")).toBe("2027-03-01");
  });
});
