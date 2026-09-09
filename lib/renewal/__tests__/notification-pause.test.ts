import { describe, expect, it } from "vitest";
import { isInRenewalChase, isRenewalNotificationPaused } from "../notification-pause";

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

/**
 * Pins which orgs get a pause control.
 *
 * The window is NOT derived here — it comes from getCurrentRenewalSeason(),
 * the one existing reader, and these cases pass the season it returns. That
 * matters: an earlier version of this predicate derived its own cycle with
 * nextCycleStartOnOrAfter(), which on any day just past the cycle start
 * resolves to the NEXT cycle. It compared each org's expiry against a year
 * that had not started, and treated the Sept-to-Oct grace tail as out of
 * window even though renewal_charge_failed mail goes out in it.
 *
 * The bar: a green run must distinguish "not being chased right now" from
 * "exempt". Every non-canceled org re-enters the chase when next season
 * opens; the control is hidden between seasons because a pause caps at 120
 * days and cannot reach that far. A change that hides grace orgs, or shows
 * the button to a paid-up active org, fails here.
 */
describe("isInRenewalChase", () => {
  // What getCurrentRenewalSeason returns on 2026-09-09: the season running
  // 2026-08-01 → 2026-10-01, billing the cycle labelled 2027.
  const inSeason = { renewalYear: 2027 };
  const betweenSeasons = null;

  it("chases an org in grace even between seasons", () => {
    // Grace can outlive the season, and the weekly reminder goes out anyway.
    // U of L and Camosun today.
    expect(
      isInRenewalChase({ membershipStatus: "grace", membershipExpiresAt: "2026-08-31" }, betweenSeasons)
    ).toBe(true);
  });

  it("chases an org in grace during the season", () => {
    expect(
      isInRenewalChase({ membershipStatus: "grace", membershipExpiresAt: "2026-08-31" }, inSeason)
    ).toBe(true);
  });

  it("does not chase a paid-up active org during the season", () => {
    // Algonquin, Capilano, Carleton today: paid through 2027-08-31, which
    // covers the 2027 cycle being billed. Nothing is being sent to them.
    expect(
      isInRenewalChase({ membershipStatus: "active", membershipExpiresAt: "2027-08-31" }, inSeason)
    ).toBe(false);
  });

  it("chases an active org that has NOT paid through the cycle being billed", () => {
    // Still active but expired — the charge run is about to bill them and
    // mail renewal_charge_failed if it fails. This is the case the old
    // reminder-window-only derivation missed in the Sept-to-Oct tail.
    expect(
      isInRenewalChase({ membershipStatus: "active", membershipExpiresAt: "2026-08-31" }, inSeason)
    ).toBe(true);
  });

  it("chases nobody active between seasons — but does not mark them exempt", () => {
    // Same org as the case above; hidden only because no season is running.
    expect(
      isInRenewalChase({ membershipStatus: "active", membershipExpiresAt: "2026-08-31" }, betweenSeasons)
    ).toBe(false);
  });

  it("treats a null expiry as an outstanding renewal, not an unknown one", () => {
    expect(
      isInRenewalChase({ membershipStatus: "active", membershipExpiresAt: null }, inSeason)
    ).toBe(true);
  });

  it("chases reactivated orgs on the same terms as active ones", () => {
    expect(
      isInRenewalChase({ membershipStatus: "reactivated", membershipExpiresAt: "2026-08-31" }, inSeason)
    ).toBe(true);
  });

  it("does not chase a locked org — the grace job only selects grace", () => {
    expect(
      isInRenewalChase({ membershipStatus: "locked", membershipExpiresAt: "2026-08-31" }, inSeason)
    ).toBe(false);
  });
});
