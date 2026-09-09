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
 * The bar: a green run must distinguish "not being chased right now" from
 * "exempt". Every non-canceled org re-enters the chase when next August's
 * window opens; the control is hidden today because a pause caps at 120 days
 * and cannot reach that far, not because those orgs are permanently outside
 * the renewal cycle. A change that hides grace orgs, or that shows the button
 * to a paid-up active org while the window is shut, fails here.
 */
describe("isInRenewalChase", () => {
  const shut = { reminderWindowOpen: false, renewalYear: 2028 };
  const open = { reminderWindowOpen: true, renewalYear: 2028 };

  it("chases an org in grace even when the reminder window is shut", () => {
    // The live case: weekly grace reminders go out year-round, independent of
    // the reminder window. U of L today.
    expect(
      isInRenewalChase({ membershipStatus: "grace", membershipExpiresAt: "2026-08-31" }, shut)
    ).toBe(true);
  });

  it("does not chase a paid-up active org while the window is shut", () => {
    expect(
      isInRenewalChase({ membershipStatus: "active", membershipExpiresAt: "2027-08-31" }, shut)
    ).toBe(false);
  });

  it("chases that same org once the window opens", () => {
    // Not exempt — just out of season. The control reappears in August.
    expect(
      isInRenewalChase({ membershipStatus: "active", membershipExpiresAt: "2027-08-31" }, open)
    ).toBe(true);
  });

  it("does not chase an org already paid through the cycle being billed", () => {
    expect(
      isInRenewalChase({ membershipStatus: "active", membershipExpiresAt: "2028-08-31" }, open)
    ).toBe(false);
  });

  it("treats a null expiry as an outstanding renewal, not an unknown one", () => {
    expect(
      isInRenewalChase({ membershipStatus: "active", membershipExpiresAt: null }, open)
    ).toBe(true);
  });

  it("chases reactivated orgs on the same terms as active ones", () => {
    expect(
      isInRenewalChase({ membershipStatus: "reactivated", membershipExpiresAt: "2027-08-31" }, open)
    ).toBe(true);
  });

  it("does not chase a locked org — the grace job only selects grace", () => {
    expect(
      isInRenewalChase({ membershipStatus: "locked", membershipExpiresAt: "2026-08-31" }, open)
    ).toBe(false);
  });
});
