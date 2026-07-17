import { describe, expect, it } from "vitest";

import { zonedWallTimeToUtcIso } from "../tz";

describe("zonedWallTimeToUtcIso", () => {
  it("converts a winter (EST, UTC-5) wall time in Toronto", () => {
    expect(zonedWallTimeToUtcIso("2027-02-02", "09:00", "America/Toronto")).toBe(
      "2027-02-02T14:00:00.000Z"
    );
  });

  it("converts a summer (EDT, UTC-4) wall time in Toronto", () => {
    expect(zonedWallTimeToUtcIso("2027-07-01", "09:00", "America/Toronto")).toBe(
      "2027-07-01T13:00:00.000Z"
    );
  });

  it("is a no-op shift for UTC", () => {
    expect(zonedWallTimeToUtcIso("2027-02-02", "09:00:00", "UTC")).toBe(
      "2027-02-02T09:00:00.000Z"
    );
  });

  it("defaults missing time to midnight", () => {
    expect(zonedWallTimeToUtcIso("2027-02-02", null, "UTC")).toBe(
      "2027-02-02T00:00:00.000Z"
    );
  });
});
