/**
 * Turning a new-partner announcement into a DRAFT member email.
 *
 * PREPARES ONLY — never sends. It creates a `draft` MessageCampaign that
 * appears in /admin/comms for a human to review and send, the same contract
 * the Partner Asks tool uses. So the announcement passes two independent
 * gates: a human approves the Circle post, and a human sends the email.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createCampaign } from "@/lib/comms/send";
import type { AudienceDefinition } from "@/lib/comms/types";
import {
  buildAnnouncementEmail,
  type AnnouncementEmailInput,
} from "@/lib/ghosts/new-partner-email";

export type { AnnouncementEmailInput };

/**
 * Everyone at an ACTIVE Member org — org admins and ordinary members alike.
 *
 * Partners are excluded on purpose: a new partner joining is a supplier
 * announcement to buyers, not news for other suppliers.
 *
 * ⚠️ CASL: `resolveOrgAdmins` filters only on `is_test` and `org_type`, with no
 * membership-status check — so a bare { org_type: "Member" } audience reaches
 * everyone who has ever been a member, including 27 canceled orgs (103 people
 * as of 2026-08). We cannot demonstrate express consent for organizations that
 * have left, and unsolicited "look how good we're getting" mail to a former
 * member is exactly the kind of thing that invites a consent complaint.
 *
 * So the org list is pinned explicitly. Winning lapsed members back is a
 * separate exercise with its own opt-in, not a side effect of this pipeline.
 *
 * Scoped here rather than by changing `resolveOrgAdmins`, because other
 * campaigns depend on that resolver's current behaviour.
 */
async function activeMemberAudience(
  db: ReturnType<typeof createAdminClient>
): Promise<AudienceDefinition | null> {
  const { data: orgs } = await db
    .from("organizations")
    .select("id")
    .eq("type", "Member")
    .eq("membership_status", "active")
    .eq("is_test", false)
    .is("archived_at", null);

  const orgIds = (orgs ?? []).map((o) => o.id as string);
  if (!orgIds.length) return null;

  return {
    type: "org_admins",
    filters: {
      org_type: "Member",
      org_ids: orgIds,
      roles: ["org_admin", "member"],
    },
  };
}

/**
 * Creates the draft campaign and links it to the announcement.
 *
 * Returns null and logs rather than throwing — a failure here must not undo a
 * Circle post that already went out. The announcement stays published with
 * `email_campaign_id` null, which is visibly "post went, email didn't" rather
 * than an inconsistent half-state.
 */
export async function prepareAnnouncementEmail(
  announcementId: string,
  input: AnnouncementEmailInput
): Promise<string | null> {
  const db = createAdminClient();

  // Never prepare a second draft for the same announcement.
  const { data: existing } = await db
    .from("ghost_announcements")
    .select("email_campaign_id")
    .eq("id", announcementId)
    .maybeSingle();
  if (existing?.email_campaign_id) return existing.email_campaign_id as string;

  const audience = await activeMemberAudience(db);
  if (!audience) {
    console.error("[ghosts/announcement-email] no active member orgs — no audience to prepare");
    return null;
  }

  const { subject, bodyHtml } = buildAnnouncementEmail(input);

  try {
    const result = await createCampaign({
      name: `New partner — ${input.organizationName}`,
      subjectOverride: subject,
      bodyOverride: bodyHtml,
      audience,
      triggerSource: "manual",
    });

    if (!result.success || !result.campaignId) {
      console.error("[ghosts/announcement-email] campaign creation failed", result.error);
      return null;
    }

    await db
      .from("ghost_announcements")
      .update({ email_campaign_id: result.campaignId, updated_at: new Date().toISOString() })
      .eq("id", announcementId);

    return result.campaignId;
  } catch (err) {
    console.error("[ghosts/announcement-email] campaign creation threw", err);
    return null;
  }
}
