// ---------------------------------------------------------------------------
// Circle announcement feed — server-side data fetcher for ISR pages
// ---------------------------------------------------------------------------

import { getCircleClient } from "./client";
import type { CirclePost } from "./types";

/**
 * Fetch recent published posts from the Circle announcements space.
 * Returns an empty array if Circle is not configured or on any error.
 * Designed for ISR-cached server component consumption.
 */
export async function getAnnouncementPosts(
  limit = 4
): Promise<CirclePost[]> {
  const client = getCircleClient();
  if (!client) return [];

  const spaceId = process.env.CIRCLE_ANNOUNCEMENTS_SPACE_ID;
  if (!spaceId) {
    console.warn(
      "[circle/announcements] CIRCLE_ANNOUNCEMENTS_SPACE_ID not set — skipping"
    );
    return [];
  }

  try {
    return await client.listPosts(parseInt(spaceId, 10), {
      per_page: limit,
      sort: "latest",
      status: "published",
    });
  } catch (err) {
    console.error(
      "[circle/announcements] Failed to fetch posts:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
