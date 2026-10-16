import { describe, it, expect } from "vitest";
import { formatLocalEventTime, zoneForProvince, localEventTimeSentence } from "../local-time";
import { deriveRecipientNameVariables } from "../format";

// Rush Recap: 2026-10-07 10:00 MDT === 16:00 UTC.
const EVENT = new Date("2026-10-07T16:00:00Z");

describe("formatLocalEventTime", () => {
  it.each([
    ["British Columbia", "9 a.m. PDT"],
    ["Alberta", "10 a.m. MDT"],
    ["Manitoba", "11 a.m. CDT"],
    ["Ontario", "12 p.m. EDT"],
    ["Quebec", "12 p.m. EDT"],
    ["Nova Scotia", "1 p.m. ADT"],
    ["New Brunswick", "1 p.m. ADT"],
    ["Prince Edward Island", "1 p.m. ADT"],
  ])("%s → %s", (province, expected) => {
    expect(formatLocalEventTime(EVENT, province)).toBe(expected);
  });

  /**
   * The reason this module exists. Saskatchewan does not observe DST, so in
   * October it is on Mountain time, an hour behind the rest of Central. The
   * email's static "11:00 CT" line was telling our Saskatchewan stores to
   * arrive an hour late.
   */
  it("puts Saskatchewan on Mountain time in October, not Central", () => {
    expect(formatLocalEventTime(EVENT, "Saskatchewan")).toBe("10 a.m. CST");
    expect(formatLocalEventTime(EVENT, "Manitoba")).toBe("11 a.m. CDT");
  });

  it("keeps Newfoundland's half hour", () => {
    expect(formatLocalEventTime(EVENT, "Newfoundland and Labrador")).toBe("1:30 p.m. NDT");
  });

  it("accepts two-letter codes for hand-entered data", () => {
    expect(formatLocalEventTime(EVENT, "SK")).toBe("10 a.m. CST");
    expect(formatLocalEventTime(EVENT, "on")).toBe("12 p.m. EDT");
  });

  it("tolerates surrounding whitespace and casing", () => {
    expect(formatLocalEventTime(EVENT, "  bRiTiSh CoLuMbIa ")).toBe("9 a.m. PDT");
  });

  it("returns null for an unknown or missing province rather than guessing", () => {
    expect(formatLocalEventTime(EVENT, null)).toBeNull();
    expect(formatLocalEventTime(EVENT, "")).toBeNull();
    expect(formatLocalEventTime(EVENT, "Atlantis")).toBeNull();
  });
});

describe("zoneForProvince", () => {
  it("separates Saskatchewan from the other Central provinces", () => {
    expect(zoneForProvince("Saskatchewan")).toBe("America/Regina");
    expect(zoneForProvince("Manitoba")).toBe("America/Winnipeg");
  });
});

describe("localEventTimeSentence", () => {
  it("uses the member's own time when the province is known", () => {
    expect(localEventTimeSentence(EVENT, "Nova Scotia", "10:00 a.m. MT")).toBe(
      "1 p.m. ADT where you are"
    );
  });

  it("falls back to the organizer's zone when it is not", () => {
    expect(localEventTimeSentence(EVENT, null, "10:00 a.m. MT")).toBe("10:00 a.m. MT");
  });
});

/**
 * profiles.display_name holds a bare email address for a large share of
 * member logins, so without this the Rush Recap send would have greeted
 * people with "Hi p2dwived@uwaterloo.ca,".
 */
describe("deriveRecipientNameVariables", () => {
  it("never greets someone with an email address", () => {
    const v = deriveRecipientNameVariables("wanda.beauchamp@lakelandcollege.ca", "wanda.beauchamp@lakelandcollege.ca");
    expect(v.first_name).toBe("wanda.beauchamp");
    expect(v.first_name).not.toContain("@");
  });

  it("uses a real name when there is one", () => {
    expect(deriveRecipientNameVariables("Priyanka Dwivedi", "p2dwived@uwaterloo.ca").first_name).toBe("Priyanka");
  });

  it("falls back to the email local part when the name is empty", () => {
    expect(deriveRecipientNameVariables(null, "tlinden@example.ca").first_name).toBe("tlinden");
  });
});
