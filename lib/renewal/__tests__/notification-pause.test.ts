import { describe, expect, it } from "vitest";
import { isRenewalNotificationPaused } from "../notification-pause";

/**
 * Pins the pause window's day boundaries.
 *
 * The bar these tests are written to: a green run must distinguish a pause
 * that is inclusive of its end date from one that ends the night before, and
 * must hold that line for an instant late enough in the UTC day that Toronto
 * is still on the previous date. That second case is the one a naive
 * `new Date(pausedUntil) < new Date()` gets wrong — a bare date string parses
 * as UTC midnight while a Postgres timestamp read back without a trailing Z
 * parses as local, so the two disagree by hours at exactly the boundary the
 * pause is about, and the chase resumes a day early on the org whose payment
 * is in transit.
 */

const TZ = "America/Toronto";
const paused = (until: string | null) => ({ renewal_notifications_paused_until: until });

describe("isRenewalNotificationPaused", () => {
  it("is not paused when no end date is set", () => {
    expect(isRenewalNotificationPaused(paused(null), TZ, new Date("2026-09-09T12:00:00Z"))).toBe(false);
  });

  it("is paused well inside the window", () => {
    expect(
      isRenewalNotificationPaused(paused("2026-09-30"), TZ, new Date("2026-09-15T12:00:00Z"))
    ).toBe(true);
  });

  it("is still paused ON the end date — the window is inclusive", () => {
    expect(
      isRenewalNotificationPaused(paused("2026-09-30"), TZ, new Date("2026-09-30T12:00:00Z"))
    ).toBe(true);
  });

  it("resumes the day after the end date", () => {
    expect(
      isRenewalNotificationPaused(paused("2026-09-30"), TZ, new Date("2026-10-01T12:00:00Z"))
    ).toBe(false);
  });

  it("is paused at an instant that is already the next day in UTC but not in Toronto", () => {
    // 2026-10-01T02:00Z is 2026-09-30 22:00 in Toronto — still the last day
    // of the pause. A UTC-based comparison resumes the chase here, and the
    // 07:00 Toronto grace-reminder cron that runs a few hours later sends the
    // email the pause existed to stop.
    expect(
      isRenewalNotificationPaused(paused("2026-09-30"), TZ, new Date("2026-10-01T02:00:00Z"))
    ).toBe(true);
  });

  it("is not paused at an instant that is the next day in Toronto too", () => {
    expect(
      isRenewalNotificationPaused(paused("2026-09-30"), TZ, new Date("2026-10-01T13:00:00Z"))
    ).toBe(false);
  });

  it("tolerates a full timestamp in the column, not just a date", () => {
    expect(
      isRenewalNotificationPaused(
        paused("2026-09-30T00:00:00+00:00"),
        TZ,
        new Date("2026-09-30T12:00:00Z")
      )
    ).toBe(true);
  });

  it("treats an already-elapsed pause as no pause at all", () => {
    expect(
      isRenewalNotificationPaused(paused("2026-08-01"), TZ, new Date("2026-09-09T12:00:00Z"))
    ).toBe(false);
  });
});
