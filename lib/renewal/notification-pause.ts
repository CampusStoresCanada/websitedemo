/**
 * Per-org pause on membership renewal notifications.
 *
 * The problem this solves: a member's payment is genuinely in transit — an
 * EFT sitting in a bank queue, a cheque in the mail — and every week the
 * renewal jobs mail their whole admin team asking for money they have
 * already sent. There was no way to stop that short of voiding the invoice
 * or cancelling the membership, both of which are decisions about the money
 * rather than about the mail.
 *
 * What a pause does: suppresses outbound renewal mail for one org until a
 * date. That is all it does.
 *
 * What a pause deliberately does NOT do:
 *   - stop the countdown. Grace still starts, grace still expires, the lock
 *     still lands on the day it would have landed.
 *   - alter the membership. Status, expiry, invoices and balances are
 *     untouched — the org still owes exactly what it owed.
 *   - hide anything from the member. /org/billing keeps showing the real
 *     status, because that page answers a question the member asked; it
 *     isn't us chasing them.
 *
 * A paused org that reaches the lock raises an ops alert instead of mailing
 * the member, so the silence is visible to staff rather than to nobody.
 *
 * On the end date: `paused_until` is required. A pause with no expiry stops
 * being a pause and becomes a permanent exemption, because clearing it is
 * nobody's job — the org quietly drops out of the renewal chase forever and
 * the only trace is a NULL that reads like "never set". The date forces the
 * decision to come back.
 */

/** The pause-bearing columns, as selected by the renewal jobs. */
export interface RenewalPauseFields {
  renewal_notifications_paused_until: string | null;
}

/**
 * Is renewal mail to this org suppressed today?
 *
 * Compared as YYYY-MM-DD strings in the renewal dispatch timezone, matching
 * how the jobs compute every other date boundary. Deliberately NOT a Date
 * comparison: a bare `new Date("2026-09-30")` is UTC midnight while a
 * timestamp read back from Postgres has no trailing Z and parses as local,
 * so the two disagree by hours at exactly the boundary the pause is about.
 * Two date strings compared lexicographically have no such seam.
 *
 * Inclusive of the end date — "paused until Sept 30" means Sept 30 is quiet
 * and Oct 1 is the first day the chase resumes.
 */
export function isRenewalNotificationPaused(
  org: RenewalPauseFields,
  timezone: string,
  now: Date = new Date()
): boolean {
  const pausedUntil = org.renewal_notifications_paused_until;
  if (!pausedUntil) return false;

  const today = now.toLocaleDateString("en-CA", { timeZone: timezone });
  return today <= pausedUntil.split("T")[0];
}

/** The columns every renewal job needs in its SELECT for the gate to work. */
export const RENEWAL_PAUSE_COLUMNS = "renewal_notifications_paused_until" as const;

/**
 * Is this org actually in the renewal chase right now?
 *
 * A pause only does something if a message would otherwise be sent while the
 * pause is still in force. Showing the control anywhere else is a button that
 * cannot have an effect — and worse, one an admin may press believing they
 * have stopped something.
 *
 * The two live cases, mirroring the gates in lib/renewal/jobs.ts:
 *
 *   - `grace`: the weekly grace reminder is going out now, and the lock notice
 *     is coming. This is the case the tool was built for.
 *   - `active`/`reactivated` while the shared reminder window is open, and the
 *     org has not already paid through the cycle being billed. That window is
 *     one global condition, not a per-org date — every org renews on the same
 *     calendar day — so the caller computes it once and passes it in.
 *
 * Everything else is out of the chase for longer than a pause can last. Note
 * this is "not being chased *now*", not "exempt": an active org paid up to
 * 2027-08-31 is chased again the moment next August's window opens. A pause
 * caps at 120 days and cannot reach that far, so the control appears then,
 * not now.
 */
export function isInRenewalChase(
  org: { membershipStatus: string | null; membershipExpiresAt: string | null },
  window: { reminderWindowOpen: boolean; renewalYear: number }
): boolean {
  if (org.membershipStatus === "grace") return true;

  if (
    window.reminderWindowOpen &&
    (org.membershipStatus === "active" || org.membershipStatus === "reactivated")
  ) {
    // A null expiry means an outstanding renewal, not an unknown one — so it
    // stays in the chase rather than being filtered out of it.
    if (!org.membershipExpiresAt) return true;
    return new Date(org.membershipExpiresAt).getFullYear() < window.renewalYear;
  }

  return false;
}
