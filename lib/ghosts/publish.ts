/**
 * Paced release of approved announcements.
 *
 * Publishes **at most one item per call**. That single rule is what turns the
 * cron interval into the minimum spacing between posts — no timer, no
 * last-posted bookkeeping, nothing to drift. It is also what makes the backfill
 * work: approving four at once still results in four posts on four separate
 * business days, indistinguishable from steady-state behaviour.
 *
 * Only `approved` items are eligible. A draft nobody has read can never reach
 * a member, no matter how many times this runs.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleClient } from "@/lib/circle/client";
import { prepareAnnouncementEmail } from "@/lib/ghosts/announcement-email";
import { formatLocation } from "@/lib/ghosts/new-partner-post";
import {
  canPublishAmbient,
  civilDayBounds,
  type PipelineKey,
} from "@/lib/ghosts/posting-policy";

/**
 * Helpful Ghost. Attribution on a post comes from `user_email`, not from which
 * API key signs the request — verified 2026-08-19 against both the main admin
 * key and Butler's. So no separate Helpful key is needed. (DMs are the
 * opposite: there the sender IS the key owner.)
 */
const HELPFUL_EMAIL = "helpful.ghost@campusstores.ca";

function announcementsSpaceId(): number | null {
  return Number(process.env.CIRCLE_ANNOUNCEMENTS_SPACE_ID) || null;
}

export type PublishOutcome =
  | { published: true; announcementId: string; organizationName: string; url: string | null }
  | { published: false; reason: string };

/**
 * Releases the oldest approved announcement, if the policy allows one now.
 *
 * FIFO within the pipeline — partners are announced in the order they joined,
 * which is the fair ordering and the one that reads correctly if anyone looks
 * back through the space later.
 */
export async function publishNextAnnouncement(
  pipeline: PipelineKey = "new_partner",
  now: Date = new Date()
): Promise<PublishOutcome> {
  const db = createAdminClient();
  const spaceId = announcementsSpaceId();
  if (!spaceId) {
    return { published: false, reason: "CIRCLE_ANNOUNCEMENTS_SPACE_ID is not configured." };
  }

  // Oldest first. created_at tracks when Helpful drafted it, which follows
  // activation order.
  const { data: queued } = await db
    .from("ghost_announcements")
    .select("id, organization_id, kind, title, body_tiptap, summary_text")
    .eq("status", "approved")
    .eq("kind", pipeline)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!queued) return { published: false, reason: "Nothing approved and waiting." };

  // "Today" means the civil day here, not a rolling 24 hours — otherwise a
  // post made at 4pm yesterday would suppress one at 9am today.
  const { startUtc, endUtc } = civilDayBounds(now);

  const [{ count: spaceCount }, { count: pipelineCount }] = await Promise.all([
    db
      .from("ghost_announcements")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .eq("circle_space_id", spaceId)
      .gte("published_at", startUtc)
      .lt("published_at", endUtc),
    db
      .from("ghost_announcements")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .eq("kind", pipeline)
      .gte("published_at", startUtc)
      .lt("published_at", endUtc),
  ]);

  const decision = canPublishAmbient({
    now,
    pipeline,
    postsToSpaceToday: spaceCount ?? 0,
    postsInPipelineToday: pipelineCount ?? 0,
  });

  if (!decision.allowed) return { published: false, reason: decision.reason };

  const { data: org } = await db
    .from("organizations")
    .select("name, slug, city, province, primary_category")
    .eq("id", queued.organization_id as string)
    .maybeSingle();
  const organizationName = (org?.name as string) ?? "the new partner";

  const circle = getCircleClient();
  if (!circle) return { published: false, reason: "Circle is not configured." };

  try {
    const created = await circle.createPost({
      space_id: spaceId,
      name: (queued.title as string) || `Welcome, ${organizationName}`,
      tiptap_body: queued.body_tiptap as Record<string, unknown>,
      status: "published",
      user_email: HELPFUL_EMAIL,
    });

    await db
      .from("ghost_announcements")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        circle_space_id: spaceId,
        circle_post_id: created.id,
        circle_post_url: created.url ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", queued.id as string);

    // Prepare the member email as a DRAFT campaign — a second, independent
    // human gate. Deliberately after the post so it can link to it, and
    // deliberately non-fatal: a failure here leaves a published post with no
    // email rather than undoing a post that has already gone out.
    await prepareAnnouncementEmail(queued.id as string, {
      organizationName,
      organizationSlug: (org?.slug as string) ?? "",
      summaryText: (queued.summary_text as string) ?? "",
      circlePostUrl: created.url ?? null,
      category: (org?.primary_category as string) ?? null,
      location: formatLocation(org?.city as string | null, org?.province as string | null) || null,
    });

    return {
      published: true,
      announcementId: queued.id as string,
      organizationName,
      url: created.url ?? null,
    };
  } catch (err) {
    // Left `approved` on purpose — the next tick retries rather than the
    // announcement being silently lost.
    console.error("[ghosts/publish] Circle post failed", err);
    return {
      published: false,
      reason: `Circle rejected the post: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
