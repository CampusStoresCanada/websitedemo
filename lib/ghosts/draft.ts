/**
 * Drafting Helpful Ghost's new-partner announcements.
 *
 * Split from the server actions so the cron can call it without an admin
 * session. Produces DRAFTS only — nothing here can publish.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { buildNewPartnerPost } from "@/lib/ghosts/new-partner-post";
import { fetchRecentFirstActivations, NEWEST_ORG_WINDOW_DAYS } from "@/lib/homepage-slides";
import { SPOTLIGHT_EXCLUSIONS } from "@/lib/membership/spotlight-exclusions";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";

/**
 * Draft an announcement for every newly-activated partner that doesn't have
 * one yet.
 *
 * No auth guard — this is the shared core. The admin server action wraps it
 * with requireAdmin(); the cron calls it directly, where there is no user.
 *
 * Idempotent by construction: the unique (kind, organization_id) index means a
 * re-run conflicts rather than duplicating, so it is safe to call from the
 * cron on every tick and from the "check now" button at the same time.
 */
export async function draftPendingAnnouncementsCore(): Promise<{
  drafted: number;
  skipped: number;
}> {
  const db = createAdminClient();
  const activations = await fetchRecentFirstActivations(NEWEST_ORG_WINDOW_DAYS, 100);

  // Orgs deliberately held out of the automated pipeline get a `skipped` row
  // rather than being silently absent — so the review screen can show WHY
  // there is no announcement, instead of leaving a puzzling gap.
  const exclusions = new Map(SPOTLIGHT_EXCLUSIONS.map((e) => [e.organizationId, e]));

  const candidateIds = [...activations.map((a) => a.organizationId), ...exclusions.keys()];
  if (!candidateIds.length) return { drafted: 0, skipped: 0 };

  const { data: existing } = await db
    .from("ghost_announcements")
    .select("organization_id")
    .eq("kind", "new_partner")
    .in("organization_id", candidateIds);

  const alreadyHave = new Set((existing ?? []).map((r) => r.organization_id as string));

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name, slug, website, city, province, primary_category, website_summary, company_description")
    .in("id", candidateIds)
    .eq("type", "Vendor Partner");

  let drafted = 0;
  let skipped = 0;

  for (const org of orgs ?? []) {
    const orgId = org.id as string;
    if (alreadyHave.has(orgId)) continue;

    const exclusion = exclusions.get(orgId);
    if (exclusion) {
      await db.from("ghost_announcements").insert({
        kind: "new_partner",
        organization_id: orgId,
        status: "skipped",
        title: `Welcome, ${org.name}`,
        skip_reason: exclusion.reason,
      });
      skipped++;
      continue;
    }

    const joinedOn = activations.find((a) => a.organizationId === orgId)?.activatedOn;
    if (!joinedOn) continue;

    const summaryText =
      (org.website_summary as string)?.trim() || (org.company_description as string)?.trim() || "";

    const post = buildNewPartnerPost({
      organization: {
        name: org.name as string,
        slug: org.slug as string,
        website: org.website as string | null,
        city: org.city as string | null,
        province: org.province as string | null,
        primaryCategory: org.primary_category as string | null,
        websiteSummary: org.website_summary as string | null,
        companyDescription: org.company_description as string | null,
      },
      joinedOn,
      appUrl: APP_URL,
    });

    await db.from("ghost_announcements").insert({
      kind: "new_partner",
      organization_id: orgId,
      status: "draft",
      title: post.title,
      summary_text: summaryText,
      // Round-tripped to satisfy the generated Json column type — the same
      // coercion signup_applications.application_data uses.
      body_tiptap: JSON.parse(JSON.stringify(post.tiptap_body)),
    });
    drafted++;
  }

  return { drafted, skipped };
}
