import { describe, expect, it } from "vitest";
import { parseServiceDetails } from "../service-details";

describe("service details", () => {
  it("orders deadlines soonest first", () => {
    const d = parseServiceDetails("Stronco", {
      show_code: "533166583",
      deadlines: [
        { label: "Last advance receipt", date: "2027-01-27" },
        { label: "Pre-show discount ends", date: "2027-01-10" },
        { label: "Advance shipments open", date: "2026-12-30" },
      ],
    });
    expect(d?.deadlines.map((x) => x.label)).toEqual([
      "Advance shipments open",
      "Pre-show discount ends",
      "Last advance receipt",
    ]);
  });

  it("drops a deadline missing its date rather than rendering an undefined one", () => {
    // "goes to press on NaN undefined" shipped to a real inbox once already.
    const d = parseServiceDetails("X", {
      show_code: "1",
      deadlines: [{ label: "No date here" }, { label: "Real", date: "2027-01-01" }],
    });
    expect(d?.deadlines).toHaveLength(1);
  });

  it("returns null when there is nothing worth showing", () => {
    expect(parseServiceDetails("Empty", { what: "Just a description" })).toBeNull();
    expect(parseServiceDetails("Empty", null)).toBeNull();
  });

  it("treats blank strings as absent", () => {
    const d = parseServiceDetails("X", { show_code: "   ", action_url: "https://x.test" });
    expect(d?.showCode).toBeNull();
    expect(d?.actionUrl).toBe("https://x.test");
  });
});
