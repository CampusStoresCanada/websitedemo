import { describe, expect, it, vi } from "vitest";

/**
 * Pins the season's day boundaries.
 *
 * The season bounds are whole days at 00:00 UTC, but every caller passes a
 * live `new Date()` — an instant, usually mid-morning. Comparing the instant
 * made the two ends behave differently: `seasonStart` counted all day (any
 * time on it is already past midnight) while `seasonEnd` counted only at the
 * midnight instant itself. So the last day of the grace period — Oct 1 under
 * the live config, the cliff day — read as out of season for all but the first
 * moment of it, and both `getRenewalProgressData()` (the dashboard's renewal
 * widget) and the "My renewal calls" nav item disappeared on the day they
 * matter most.
 *
 * The bar these tests are written to: a green run must distinguish "the whole
 * end day is in season" from "only midnight on the end day is". Every case
 * therefore probes a mid-day instant, not 00:00 — reverting to
 * `today.getTime() <= seasonEnd.getTime()` fails the Oct 1 cases and passes
 * everything else.
 */

vi.mock("@/lib/policy/engine", () => ({
  // The live values: fiscal year starts 09-01, 30 days of grace, and a longest
  // reminder of 30 days out — giving a season of 2026-08-01 → 2026-10-01.
  getRenewalConfig: async () => ({
    cycle_start_month_day: "09-01",
    grace_days: 30,
    reminder_days: [30, 14, 7, 1],
  }),
}));

const { getCurrentRenewalSeason } = await import("../season");

const at = (iso: string) => new Date(iso);

describe("getCurrentRenewalSeason day boundaries", () => {
  it("covers the last day of grace for the whole day, not just midnight", async () => {
    for (const time of ["00:00:00", "09:30:00", "12:00:00", "23:59:59"]) {
      const season = await getCurrentRenewalSeason(at(`2026-10-01T${time}Z`));
      expect(season, `2026-10-01T${time}Z should be in season`).not.toBeNull();
      expect(season?.renewalYear).toBe(2027);
    }
  });

  it("covers the first day of the season for the whole day", async () => {
    for (const time of ["00:00:00", "09:30:00", "23:59:59"]) {
      const season = await getCurrentRenewalSeason(at(`2026-08-01T${time}Z`));
      expect(season, `2026-08-01T${time}Z should be in season`).not.toBeNull();
      expect(season?.renewalYear).toBe(2027);
    }
  });

  it("ends the season the day after the last day of grace", async () => {
    expect(await getCurrentRenewalSeason(at("2026-10-02T00:00:00Z"))).toBeNull();
    expect(await getCurrentRenewalSeason(at("2026-10-02T09:30:00Z"))).toBeNull();
  });

  it("starts the season no earlier than the first day", async () => {
    expect(await getCurrentRenewalSeason(at("2026-07-31T23:59:59Z"))).toBeNull();
  });

  it("reports the bounds it matched on", async () => {
    const season = await getCurrentRenewalSeason(at("2026-09-02T18:00:00Z"));
    expect(season).not.toBeNull();
    expect(season?.seasonStart.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(season?.cycleStart.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(season?.seasonEnd.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("stays out of season in the dead middle of the year", async () => {
    expect(await getCurrentRenewalSeason(at("2026-03-15T12:00:00Z"))).toBeNull();
  });
});
