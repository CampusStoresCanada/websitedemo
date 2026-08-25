import { describe, expect, it } from "vitest";
import {
  cutoffUrgency,
  daysUntilCutoff,
  formatCutoffDate,
  formatRate,
  isCutoffPassed,
  parseHotelRates,
} from "../hotel";

describe("parseHotelRates", () => {
  it("keeps well-formed rows", () => {
    const rows = [
      { id: "a", label: "Single occupancy", rate_cents: 18500 },
      { id: "b", label: "Double occupancy", rate_cents: 20500, note: "plus tax" },
    ];
    expect(parseHotelRates(rows)).toEqual(rows);
  });

  it("drops rows that would render as garbage rather than throwing on them", () => {
    expect(
      parseHotelRates([
        { id: "a", label: "Single", rate_cents: 18500 },
        { id: "b", label: "No rate" },
        { label: "No id", rate_cents: 100 },
        { id: "c", label: "NaN rate", rate_cents: Number.NaN },
        null,
        "nonsense",
      ])
    ).toEqual([{ id: "a", label: "Single", rate_cents: 18500 }]);
  });

  it("treats a non-array (null column, object) as no rates", () => {
    expect(parseHotelRates(null)).toEqual([]);
    expect(parseHotelRates({})).toEqual([]);
    expect(parseHotelRates(undefined)).toEqual([]);
  });
});

describe("formatRate", () => {
  it("drops the decimals on whole-dollar rates", () => {
    expect(formatRate(18500)).toBe("$185");
  });

  it("keeps both decimals when there are cents", () => {
    expect(formatRate(18550)).toBe("$185.50");
  });

  it("groups thousands", () => {
    expect(formatRate(125000)).toBe("$1,250");
  });
});

describe("isCutoffPassed", () => {
  it("counts the cutoff day itself as still open", () => {
    expect(isCutoffPassed("2027-03-12", "2027-03-12")).toBe(false);
  });

  it("is passed the day after", () => {
    expect(isCutoffPassed("2027-03-12", "2027-03-13")).toBe(true);
  });

  it("is never passed when no cutoff is set", () => {
    expect(isCutoffPassed(null, "2099-01-01")).toBe(false);
  });

  it("ignores a time component rather than letting it shift the day", () => {
    expect(isCutoffPassed("2027-03-12T00:00:00Z", "2027-03-12T23:59:00Z")).toBe(false);
  });
});

describe("daysUntilCutoff", () => {
  it("counts whole days ahead", () => {
    expect(daysUntilCutoff("2027-03-12", "2027-03-01")).toBe(11);
  });

  it("is zero on the day itself", () => {
    expect(daysUntilCutoff("2027-03-12", "2027-03-12")).toBe(0);
  });

  it("goes negative once passed", () => {
    expect(daysUntilCutoff("2027-03-12", "2027-03-15")).toBe(-3);
  });

  it("counts across a DST boundary without dropping or adding a day", () => {
    // Canada springs forward 2027-03-14. A local-time subtraction would make
    // this 13.958... days and round to 14.
    expect(daysUntilCutoff("2027-03-20", "2027-03-06")).toBe(14);
  });
});

describe("cutoffUrgency", () => {
  it("is none without a cutoff", () => {
    expect(cutoffUrgency(null, "2027-03-01")).toBe("none");
  });

  it("is upcoming when comfortably ahead", () => {
    expect(cutoffUrgency("2027-03-12", "2027-01-01")).toBe("upcoming");
  });

  it("turns soon inside two weeks", () => {
    expect(cutoffUrgency("2027-03-12", "2027-02-26")).toBe("soon");
    expect(cutoffUrgency("2027-03-12", "2027-03-12")).toBe("soon");
  });

  it("does not flip to soon a day early", () => {
    expect(cutoffUrgency("2027-03-12", "2027-02-25")).toBe("upcoming");
  });

  it("is passed the day after the cutoff", () => {
    expect(cutoffUrgency("2027-03-12", "2027-03-13")).toBe("passed");
  });
});

describe("formatCutoffDate", () => {
  it("reads as a date a person would say out loud", () => {
    expect(formatCutoffDate("2027-03-12")).toBe("Friday, March 12, 2027");
  });

  it("does not slip a day for viewers behind UTC", () => {
    // The bug this guards: `new Date("2027-03-12")` is UTC midnight, which is
    // March 11 in Mountain time — the deadline would read a day early.
    expect(formatCutoffDate("2027-01-01")).toBe("Friday, January 1, 2027");
  });
});
