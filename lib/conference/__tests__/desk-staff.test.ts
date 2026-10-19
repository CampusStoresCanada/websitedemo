import { describe, expect, it } from "vitest";
import { deskAppointmentActive, nextIsoDate, staffLinkEndDecision, type DeskWindow } from "../desk-staff";
import { isoDateInZone } from "../tz";

/** CSC 2027: registration opened 10 Aug 2026, last day 4 Feb 2027. */
const window2027: DeskWindow = { opensOn: "2026-08-10", lastDay: "2027-02-04" };
const conf = "conf-2027";

describe("an appointment for specific days", () => {
  // ⛔ The end is EXCLUSIVE: Wednesday only is { Wed, Thu }.
  const wednesday = { conferenceId: conf, termStart: "2027-02-03", termEnd: "2027-02-04" };

  it("is on for that day", () => {
    expect(deskAppointmentActive(wednesday, window2027, "2027-02-03")).toBe(true);
  });

  it("is off the day before and the day after", () => {
    expect(deskAppointmentActive(wednesday, window2027, "2027-02-02")).toBe(false);
    expect(deskAppointmentActive(wednesday, window2027, "2027-02-04")).toBe(false);
  });
});

describe("an appointment with the days left blank", () => {
  const blank = { conferenceId: conf, termStart: "2026-10-19", termEnd: null };

  it("is on from the day it was made while registration is open", () => {
    expect(deskAppointmentActive(blank, window2027, "2026-10-19")).toBe(true);
  });

  it("is on through the conference's last day, and off after", () => {
    expect(deskAppointmentActive(blank, window2027, "2027-02-04")).toBe(true);
    expect(deskAppointmentActive(blank, window2027, "2027-02-05")).toBe(false);
  });

  it("is off before registration opens, even if made earlier", () => {
    const early = { conferenceId: conf, termStart: "2026-07-01", termEnd: null };
    expect(deskAppointmentActive(early, window2027, "2026-08-09")).toBe(false);
    expect(deskAppointmentActive(early, window2027, "2026-08-10")).toBe(true);
  });

  // ⛔ The whole point of blank: it reads the conference's dates NOW.
  it("follows the conference when its dates move", () => {
    const extended: DeskWindow = { ...window2027, lastDay: "2027-02-06" };
    expect(deskAppointmentActive(blank, window2027, "2027-02-06")).toBe(false);
    expect(deskAppointmentActive(blank, extended, "2027-02-06")).toBe(true);
  });
});

describe("permanent desk access", () => {
  const permanent = { conferenceId: null, termStart: "2026-10-19", termEnd: null };

  it("is on regardless of any conference's dates", () => {
    expect(deskAppointmentActive(permanent, window2027, "2030-06-01")).toBe(true);
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

describe("the staff link's end date when someone is added", () => {
  // ⛔ Carolyn: on staff, no end date. Adding her to a desk without ticking
  // permanent must NOT schedule her removal.
  it("leaves a permanent staffer's link alone even when permanent is not ticked", () => {
    expect(
      staffLinkEndDecision({
        linkBefore: { status: "active", expires_at: null },
        permanent: false,
        lastDayWorked: "2027-02-04",
      })
    ).toEqual({ action: "keep" });
  });

  it("gives a new temp's link an end the day after their last day", () => {
    expect(staffLinkEndDecision({ linkBefore: null, permanent: false, lastDayWorked: "2027-02-04" })).toEqual({
      action: "set",
      endsOn: "2027-02-05",
    });
  });

  it("treats a switched-off link being brought back as new", () => {
    expect(
      staffLinkEndDecision({
        linkBefore: { status: "inactive", expires_at: null },
        permanent: false,
        lastDayWorked: "2027-02-04",
      })
    ).toEqual({ action: "set", endsOn: "2027-02-05" });
  });

  it("pushes a temp's end later for a later conference, never earlier", () => {
    const linkBefore = { status: "active", expires_at: "2027-02-05" };
    expect(staffLinkEndDecision({ linkBefore, permanent: false, lastDayWorked: "2027-06-10" })).toEqual({
      action: "set",
      endsOn: "2027-06-11",
    });
    expect(staffLinkEndDecision({ linkBefore, permanent: false, lastDayWorked: "2027-01-10" })).toEqual({
      action: "keep",
    });
  });

  it("clears any end date when permanent access is ticked", () => {
    expect(
      staffLinkEndDecision({
        linkBefore: { status: "active", expires_at: "2027-02-05" },
        permanent: true,
        lastDayWorked: "2027-02-04",
      })
    ).toEqual({ action: "clear" });
  });
});
