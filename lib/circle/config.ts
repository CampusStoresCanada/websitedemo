// ---------------------------------------------------------------------------
// Circle configuration — env validation + mapping constants
// ---------------------------------------------------------------------------

export interface CircleConfig {
  apiKey: string;
  communityId: string;
  /** Numeric Circle community_member_id for the bot account */
  botUserId: string;
  /** Email of the bot Circle account — used by mintMemberToken when botUserId is not numeric */
  botEmail: string;
  /** Admin API key belonging to Butler Ghost — used to send DMs as Butler */
  ghostApiKey: string;
  announcementsSpaceId: string;
  headlessAuthToken: string;
  /** Space ID where CSC events are published in Circle */
  eventsSpaceId: string;
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
  const botEmail = process.env.CIRCLE_BOT_EMAIL;
  const ghostApiKey = process.env.CIRCLE_GHOST_KEY;
  const announcementsSpaceId = process.env.CIRCLE_ANNOUNCEMENTS_SPACE_ID;
  const headlessAuthToken = process.env.CIRCLE_HEADLESS_AUTH_TOKEN;
  const eventsSpaceId = process.env.CIRCLE_EVENTS_SPACE_ID;

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
    botEmail: botEmail ?? "",
    ghostApiKey: ghostApiKey ?? "",
    announcementsSpaceId: announcementsSpaceId ?? "",
    headlessAuthToken: headlessAuthToken ?? "",
    eventsSpaceId: eventsSpaceId ?? "",
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
  /** Shared downgrade group for a lapsed Member org (grace/active elsewhere; locked/canceled lands here). */
  nonMember: number | null;
  /** Shared downgrade group for a lapsed Vendor Partner org. */
  nonPartner: number | null;
} {
  return {
    member: Number(process.env.CIRCLE_MEMBER_ACCESS_GROUP_ID) || null,
    partner: Number(process.env.CIRCLE_PARTNER_ACCESS_GROUP_ID) || null,
    alumni: Number(process.env.CIRCLE_ALUMNI_ACCESS_GROUP_ID) || null,
    nonMember: Number(process.env.CIRCLE_NON_MEMBER_ACCESS_GROUP_ID) || null,
    nonPartner: Number(process.env.CIRCLE_NON_PARTNER_ACCESS_GROUP_ID) || null,
  };
}

// ---------------------------------------------------------------------------
// Admin API base URLs
// ---------------------------------------------------------------------------

export const CIRCLE_ADMIN_API_BASE = "https://app.circle.so/api/admin/v2";
export const CIRCLE_V1_API_BASE = "https://app.circle.so/api/v1";
export const CIRCLE_HEADLESS_AUTH_BASE = "https://app.circle.so/api/v1/headless";
export const CIRCLE_MEMBER_API_BASE = "https://app.circle.so/api/headless/v1";
