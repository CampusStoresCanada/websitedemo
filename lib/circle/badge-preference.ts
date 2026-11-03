import { readPreferences, writePreference } from "@/lib/profile/preferences";

/**
 * Personal off-switch for the header's Circle notification poll.
 *
 * Two things bill Circle while someone browses the site:
 *   1. Header.tsx polls /api/circle/notifications every 5 minutes per visible
 *      tab, and every cache miss there costs two Circle calls (notifications
 *      feed + chat rooms).
 *   2. /api/circle/session/ensure mints a member token once per page load.
 *
 * For someone who already keeps Circle open on a second monitor all day, that
 * is thousands of billed calls a month buying a badge they never look at.
 *
 * Deliberately gated to an explicit allow-list rather than shipped as a
 * member-facing setting: a member who quietly switched this off would simply
 * stop seeing their DMs. Widen the list — or swap it for a role check — if
 * that calculus changes.
 */
const PAUSE_ALLOWED_EMAILS = new Set(["google@campusstores.ca"]);

/** Key inside profiles.preferences (see 20260825180000_profiles_preferences). */
const PREFERENCE_KEY = "circle_badge_paused";

/** True if this account is allowed to pause its own Circle badge poll. */
export function canPauseCircleBadge(email: string | null | undefined): boolean {
  if (!email) return false;
  return PAUSE_ALLOWED_EMAILS.has(email.trim().toLowerCase());
}

/**
 * True when this account has paused its own Circle badge poll.
 *
 * The allow-list is checked before the query on purpose: this runs from the
 * root layout on every render, and only the allow-listed account can have the
 * flag set, so nobody else pays a round-trip for it.
 */
export async function isCircleBadgePaused(
  userId: string,
  email: string | null | undefined
): Promise<boolean> {
  if (!canPauseCircleBadge(email)) return false;
  return (await readPreferences(userId))[PREFERENCE_KEY] === true;
}

/**
 * Persist the pause flag for this account. Returns false if the account isn't
 * allowed to set it, or the write failed.
 */
export async function setCircleBadgePaused(
  userId: string,
  email: string | null | undefined,
  paused: boolean
): Promise<boolean> {
  if (!canPauseCircleBadge(email)) return false;
  return writePreference(userId, PREFERENCE_KEY, paused);
}
