import { describe, it, expect } from "vitest";
import { bucketByDay, summarise } from "../dashboard-widget";

/**
 * The widget's rate line and sparkline are the part that cannot be seen against
 * live data until a cycle is actually running — both phase start dates sit in
 * the future for months. So the arithmetic is pinned here instead.
 */

describe("bucketByDay", () => {
  it("zero-fills every day from the phase opening to today", () => {
    const d = bucketByDay([], "2026-11-18", "2026-11-22");
    expect(d.map((x) => x.date)).toEqual([
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(d.every((x) => x.count === 0)).toBe(true);
  });

  it("counts timestamps into the right day, ignoring the time", () => {
    const d = bucketByDay(
      ["2026-11-18T23:59:00Z", "2026-11-20T00:01:00Z", "2026-11-20T14:00:00Z"],
      "2026-11-18",
      "2026-11-20"
    );
    expect(d.map((x) => x.count)).toEqual([1, 0, 2]);
  });

  it("returns nothing when the phase has not opened yet", () => {
    // Exactly the live state while the 2027 cycle is only a draft — the
    // sparkline draws nothing rather than inventing a flat line at zero.
    expect(bucketByDay([], "2026-11-18", "2026-08-26")).toEqual([]);
  });
});

describe("summarise", () => {
  const daily = bucketByDay(
    ["2026-11-18T10:00:00Z", "2026-11-19T10:00:00Z", "2026-11-19T11:00:00Z", "2026-11-20T10:00:00Z"],
    "2026-11-18",
    "2026-11-20"
  );

  it("reports arrivals in the last seven days", () => {
    expect(summarise(daily, 4, 17, 24).recent7).toBe(4);
  });

  it("averages over days elapsed, not days remaining", () => {
    expect(summarise(daily, 4, 17, 24).perDay).toBe(1.3);
  });

  it("projects the current pace forward, capped at the electorate", () => {
    // 4 in 3 days is ~1.33/day; 17 days left would be ~27, but only 24
    // institutions exist, so the projection cannot exceed them.
    expect(summarise(daily, 4, 17, 24).projected).toBe(24);
  });

  it("projects nothing from a single data point", () => {
    // One arrival is a point, not a line. A number here would be a guess
    // wearing a number's clothes.
    const one = bucketByDay(["2026-11-18T10:00:00Z"], "2026-11-18", "2026-11-20");
    expect(summarise(one, 1, 17, 24).projected).toBeNull();
  });

  it("projects nothing once the deadline has passed", () => {
    expect(summarise(daily, 4, 0, 24).projected).toBeNull();
  });
});
