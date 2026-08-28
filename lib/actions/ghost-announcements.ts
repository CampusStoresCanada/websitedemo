"use server";

/**
 * Review and release of Helpful Ghost's announcements.
 *
 * The human gate. Drafts are written by `draftPendingAnnouncements()`, edited
 * and approved here, and only then does the publisher pick them up. Nothing
 * in this file publishes anything — approval marks a draft as ready and the
 * paced release happens separately, so approving four at once still results
 * in four posts spread over four business days.
 *
 * Reviewers edit the TITLE and the PROSE, never the markup. `body_tiptap` is
 * regenerated from those on every save, which means the stored structure can
 * only ever contain node types Circle is verified to render — a reviewer
 * cannot paste in something that silently vanishes on publish.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";
import { buildNewPartnerPost } from "@/lib/ghosts/new-partner-post";
import { draftPendingAnnouncementsCore } from "@/lib/ghosts/draft";
import { fetchRecentFirstActivations, NEWEST_ORG_WINDOW_DAYS } from "@/lib/homepage-slides";
// The preview must show exactly what will be posted, so it uses the composer's
// own formatters rather than re-deriving location and URL display itself.
import {
  formatLocation,
  displayUrl,
  ensureAbsoluteUrl,
  splitCategories,
} from "@/lib/ghosts/new-partner-post";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";
const REVIEW_PATH = "/admin/comms/announcements";

export interface AnnouncementRow {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  status: "draft" | "approved" | "published" | "skipped";
  title: string;
  summaryText: string;
  skipReason: string | null;
  joinedOn: string | null;
  circlePostUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** Facts pulled live from the org, shown in the preview but not editable. */
  category: string | null;
  location: string | null;
  /** Display form — no protocol. */
  website: string | null;
  /** Always absolute, so the preview link actually goes somewhere. */
  websiteHref: string | null;
}

/** Everything that has been drafted, newest first. */
export async function listAnnouncements(): Promise<AnnouncementRow[]> {
  const auth = await requireAdmin();
  if (!auth.ok) return [];

  const db = createAdminClient();
  // Scoped to new_partner deliberately. Board recap rows live in the same
  // table but have no organization_id, and every field on this screen is an
  // org field — an unscoped read would render them as "Unknown organization".
  // They have their own review surface at /admin/board/recaps.
  const { data } = await db
    .from("ghost_announcements")
    .select(
      "id, organization_id, status, title, summary_text, skip_reason, circle_post_url, published_at, created_at"
    )
    .eq("kind", "new_partner")
    .order("created_at", { ascending: false });

  if (!data?.length) return [];

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name, slug, website, city, province, primary_category")
    .in(
      "id",
      data.map((r) => r.organization_id as string)
    );

  const orgById = new Map((orgs ?? []).map((o) => [o.id as string, o]));
  const activations = await fetchRecentFirstActivations(NEWEST_ORG_WINDOW_DAYS, 100);
  const joinedById = new Map(activations.map((a) => [a.organizationId, a.activatedOn]));

  return data.map((row) => {
    const org = orgById.get(row.organization_id as string);
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      organizationName: (org?.name as string) ?? "Unknown organization",
      organizationSlug: (org?.slug as string) ?? "",
      status: row.status as AnnouncementRow["status"],
      title: (row.title as string) ?? "",
      summaryText: (row.summary_text as string) ?? "",
      skipReason: (row.skip_reason as string) ?? null,
      joinedOn: joinedById.get(row.organization_id as string) ?? null,
      circlePostUrl: (row.circle_post_url as string) ?? null,
      publishedAt: (row.published_at as string) ?? null,
      createdAt: row.created_at as string,
      category: splitCategories(org?.primary_category as string | null).join(", ") || null,
      location: formatLocation(org?.city as string | null, org?.province as string | null) || null,
      website: org?.website ? displayUrl(org.website as string) : null,
      websiteHref: org?.website ? ensureAbsoluteUrl(org.website as string) : null,
    };
  });
}

/**
 * Draft an announcement for every newly-activated partner that doesn't have
 * one yet.
 *
 * Idempotent by construction: the unique (kind, organization_id) index means a
 * re-run conflicts rather than duplicating, so this is safe to call from the
 * cron on every tick and from the "check now" button at the same time.
 */
export async function draftPendingAnnouncements(): Promise<{
  drafted: number;
  skipped: number;
  error?: string;
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { drafted: 0, skipped: 0, error: auth.error };

  const result = await draftPendingAnnouncementsCore();
  revalidatePath(REVIEW_PATH);
  return result;
}

/** Rebuilds body_tiptap from the edited title and prose. */
async function regenerateBody(
  db: ReturnType<typeof createAdminClient>,
  organizationId: string,
  summaryText: string
) {
  const { data: org } = await db
    .from("organizations")
    .select("name, slug, website, city, province, primary_category")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) return null;

  return buildNewPartnerPost({
    organization: {
      name: org.name as string,
      slug: org.slug as string,
      website: org.website as string | null,
      city: org.city as string | null,
      province: org.province as string | null,
      primaryCategory: org.primary_category as string | null,
      // The reviewer's text becomes the narrated summary. Passing it here
      // rather than as companyDescription keeps it in third-person prose form
      // instead of being quoted.
      websiteSummary: summaryText,
      companyDescription: null,
    },
    joinedOn: "",
    appUrl: APP_URL,
  });
}

export async function saveAnnouncementDraft(
  id: string,
  title: string,
  summaryText: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: row } = await db
    .from("ghost_announcements")
    .select("organization_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!row) return { success: false, error: "Announcement not found" };
  if (row.status === "published") {
    return { success: false, error: "This announcement has already been published." };
  }

  const post = await regenerateBody(db, row.organization_id as string, summaryText.trim());
  if (!post) return { success: false, error: "Organization not found" };

  const { error } = await db
    .from("ghost_announcements")
    .update({
      title: title.trim() || post.title,
      summary_text: summaryText.trim(),
      body_tiptap: JSON.parse(JSON.stringify(post.tiptap_body)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  revalidatePath(REVIEW_PATH);
  return { success: true };
}

/**
 * Marks a draft ready to go. Does NOT publish — the paced release picks it up
 * on a business day when the caps allow, so approving several at once still
 * spreads them out.
 */
export async function approveAnnouncement(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db
    .from("ghost_announcements")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: auth.ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "draft");

  if (error) return { success: false, error: error.message };
  revalidatePath(REVIEW_PATH);
  return { success: true };
}

/** Pulls one back out of the queue before it goes. */
export async function unapproveAnnouncement(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db
    .from("ghost_announcements")
    .update({ status: "draft", approved_at: null, approved_by: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "approved");

  if (error) return { success: false, error: error.message };
  revalidatePath(REVIEW_PATH);
  return { success: true };
}

/** Never announcing this one. The reason is required — a silent gap is worse. */
export async function skipAnnouncement(
  id: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!reason.trim()) return { success: false, error: "A reason is required to skip an announcement." };

  const db = createAdminClient();
  const { error } = await db
    .from("ghost_announcements")
    .update({
      status: "skipped",
      skip_reason: reason.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "published");

  if (error) return { success: false, error: error.message };
  revalidatePath(REVIEW_PATH);
  return { success: true };
}
