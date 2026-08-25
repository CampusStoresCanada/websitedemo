import { createAdminClient } from "@/lib/supabase/admin";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("profiles")
      .select("preferences")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.warn("[circle/badge-preference] read failed:", error.message);
      return false;
    }

    return isRecord(data?.preferences) && data.preferences[PREFERENCE_KEY] === true;
  } catch (err) {
    console.warn(
      "[circle/badge-preference] read threw:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Persist the pause flag for this account. Returns false if the account isn't
 * allowed to set it, or the write failed.
 *
 * Read-modify-write so unrelated preference keys survive; the admin client is
 * required because a session client hits RLS and reports a silent no-op.
 */
export async function setCircleBadgePaused(
  userId: string,
  email: string | null | undefined,
  paused: boolean
): Promise<boolean> {
  if (!canPauseCircleBadge(email)) return false;

  const db = createAdminClient();
  const { data, error: readError } = await db
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .maybeSingle();

  if (readError || !data) {
    console.error(
      "[circle/badge-preference] write aborted, profile unreadable:",
      readError?.message ?? "no profile row"
    );
    return false;
  }

  const current = isRecord(data.preferences) ? data.preferences : {};
  const { error } = await db
    .from("profiles")
    .update({ preferences: { ...current, [PREFERENCE_KEY]: paused } })
    .eq("id", userId);

  if (error) {
    console.error("[circle/badge-preference] write failed:", error.message);
    return false;
  }

  return true;
}
