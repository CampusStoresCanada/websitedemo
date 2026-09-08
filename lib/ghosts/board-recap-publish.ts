/**
 * Posting an approved board recap into the private board space.
 *
 * Unlike the new-partner pipeline this does NOT queue for paced release. A
 * recap is TIMELY (see `posting-policy.ts`): one post a month, into a private
 * space, read by the twelve people who were in the room. The daily caps exist
 * to protect member attention from ambient news, which this is not — and
 * delaying a recap is the only thing that could spoil it.
 *
 * Approval is still the gate. Nothing here runs without a human having said so.
 *
 * TWO DESTINATIONS, one function. By default the recap is sent to Circle as a
 * DRAFT: it lands in the board space unpublished, visible only to admins, and
 * Butler reports that it is there. The final publish is then a human act inside
 * Circle, where the person can read it in situ and edit it with Circle's own
 * editor before anyone is notified. `asDraft: false` publishes outright, which
 * is what the paced new-partner pipeline does.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleClient } from "@/lib/circle/client";

/**
 * Butler Ghost. Attribution comes from `user_email`, not from which API key
 * signs the request — verified 2026-08-19. Butler is already the board's voice
 * for factual "here is the state of things" posts (board votes, tallies), and
 * a recap is the same register.
 */
const BUTLER_EMAIL = "butler.ghost@campusstores.ca";

/** The private board space. Same default the vote pipeline uses. */
function boardSpaceId(): number {
  return Number(process.env.CIRCLE_BOARD_SPACE_ID) || 1749439;
}

export type PublishRecapOutcome =
  | { published: true; url: string | null; asDraft: boolean }
  | { published: false; reason: string };

export async function publishBoardRecap(
  announcementId: string,
  opts: { asDraft?: boolean } = {}
): Promise<PublishRecapOutcome> {
  // Draft is the default: Butler hands over a draft and reports it, rather
  // than notifying the board on its own authority.
  const asDraft = opts.asDraft ?? true;
  const db = createAdminClient();

  const { data: row, error } = await db
    .from("ghost_announcements")
    .select("id, status, title, body_tiptap, meeting_id, circle_post_id")
    .eq("id", announcementId)
    .eq("kind", "board_recap")
    .maybeSingle();

  if (error || !row) return { published: false, reason: "That recap could not be found." };
  if (row.status === "published") return { published: false, reason: "This recap has already been posted." };
  // In draft mode the row stays `approved`, so status alone can no longer tell
  // us whether it has been sent. The Circle id can.
  if (row.circle_post_id) {
    return { published: false, reason: "This recap is already in Circle — open it there rather than sending it twice." };
  }
  if (!row.body_tiptap) return { published: false, reason: "The recap has no body to post." };

  const circle = getCircleClient();
  if (!circle) return { published: false, reason: "Circle is not configured." };

  const spaceId = boardSpaceId();

  try {
    const created = await circle.createPost({
      space_id: spaceId,
      name: (row.title as string) || "Board meeting recap",
      tiptap_body: row.body_tiptap as Record<string, unknown>,
      status: asDraft ? "draft" : "published",
      // A draft notifies nobody by definition; belt and braces on the publish
      // path is deliberate — a recap is a record, not an announcement, and the
      // people it concerns were in the room.
      skip_notifications: asDraft,
      user_email: BUTLER_EMAIL,
      // Explicit, not inherited: omitting these stores NULL, which the
      // member-facing API resolves to FALSE — a post with no like button and
      // no comment box, which also blocks our own API comments later.
      is_comments_enabled: true,
      is_liking_enabled: true,
    });

    await db
      .from("ghost_announcements")
      .update({
        // A Circle draft is NOT published — leaving the row `approved` with a
        // circle_post_id says exactly what is true: a human approved it, it is
        // sitting in Circle, and nobody has been notified yet. published_at
        // stays null so the daily-cap counters never see it as a post.
        status: asDraft ? "approved" : "published",
        published_at: asDraft ? null : new Date().toISOString(),
        circle_space_id: spaceId,
        circle_post_id: created.id,
        circle_post_url: created.url ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", announcementId);

    return { published: true, url: created.url ?? null, asDraft };
  } catch (err) {
    // Left as-is on purpose so the reviewer can retry, rather than the recap
    // being silently marked done after a failed post.
    console.error("[ghosts/board-recap] Circle post failed", err);
    return {
      published: false,
      reason: `Circle rejected the post: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
