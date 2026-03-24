// ---------------------------------------------------------------------------
// Circle configuration — env validation + mapping constants
// ---------------------------------------------------------------------------

export interface CircleConfig {
  apiKey: string;
  communityId: string;
  botUserId: string;
  announcementsSpaceId: string;
  headlessAuthToken: string;
}

let _warned = false;

/**
 * Returns Circle config if all required env vars are set, otherwise null.
 * Logs a single warning on first miss to avoid log spam.
 */
export function getCircleConfig(): CircleConfig | null {
  const apiKey = process.env.CIRCLE_API_KEY;
  const communityId = process.env.CIRCLE_COMMUNITY_ID;
  const botUserId = process.env.CIRCLE_BOT_USER_ID;
  const announcementsSpaceId = process.env.CIRCLE_ANNOUNCEMENTS_SPACE_ID;
  const headlessAuthToken = process.env.CIRCLE_HEADLESS_AUTH_TOKEN;

  if (!apiKey || !communityId) {
    if (!_warned) {
      console.warn(
        "[circle/config] CIRCLE_API_KEY or CIRCLE_COMMUNITY_ID not set — Circle integration disabled"
      );
      _warned = true;
    }
    return null;
  }

  return {
    apiKey,
    communityId,
    botUserId: botUserId ?? "",
    announcementsSpaceId: announcementsSpaceId ?? "",
    headlessAuthToken: headlessAuthToken ?? "",
  };
}

/**
 * Quick boolean check — avoids allocating a config object.
 */
export function isCircleConfigured(): boolean {
  return !!(process.env.CIRCLE_API_KEY && process.env.CIRCLE_COMMUNITY_ID);
}

// ---------------------------------------------------------------------------
// Access group IDs — set via env, numeric Circle access group IDs
// ---------------------------------------------------------------------------

/**
 * Returns configured Circle access group IDs from env.
 * All values optional — if null, the corresponding sync is skipped.
 */
export function getAccessGroupIds(): {
  member: number | null;
  partner: number | null;
  alumni: number | null;
} {
  return {
    member: Number(process.env.CIRCLE_MEMBER_ACCESS_GROUP_ID) || null,
    partner: Number(process.env.CIRCLE_PARTNER_ACCESS_GROUP_ID) || null,
    alumni: Number(process.env.CIRCLE_ALUMNI_ACCESS_GROUP_ID) || null,
  };
}

// ---------------------------------------------------------------------------
// Admin API base URLs
// ---------------------------------------------------------------------------

export const CIRCLE_ADMIN_API_BASE = "https://app.circle.so/api/admin/v2";
export const CIRCLE_V1_API_BASE = "https://app.circle.so/api/v1";
export const CIRCLE_HEADLESS_AUTH_BASE = "https://app.circle.so/api/v1/headless";
export const CIRCLE_MEMBER_API_BASE = "https://app.circle.so/api/headless/v1";
