/**
 * Is a person's link to an organisation still in force? Client-safe.
 *
 * ⛔ A person's link can end on a date (`user_organizations.expires_at`,
 * EXCLUSIVE — off from the start of that day): a temp added to the staff
 * organisation for a conference, or a store employee who left. NULL means it
 * follows the organisation, which is everybody else.
 *
 * Two layers, on purpose:
 *   - READ: every sign-in reads links through this filter, so access ends on
 *     the day even if a nightly run fails.
 *   - NIGHTLY: the grace-check cron marks expired links inactive, so admin
 *     lists show them as off too (lib/org/org-link-lifecycle.ts).
 *
 * ⛔ The server auth context and the browser AuthProvider both use this. When
 * those two disagreed about something before, a person had access with no link
 * to it — one rule, one place.
 */

/** Today as a UTC calendar date. A link ends at the start of its day. */
export function orgLinkToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** PostgREST `.or()` filter: links with no end date, or one still ahead. */
export function inForceOrgLinkFilter(today: string = orgLinkToday()): string {
  return `expires_at.is.null,expires_at.gt.${today}`;
}

/** The same rule for a row already in hand. */
export function isOrgLinkInForce(
  link: { expires_at?: string | null },
  today: string = orgLinkToday(),
): boolean {
  return !link.expires_at || link.expires_at > today;
}
