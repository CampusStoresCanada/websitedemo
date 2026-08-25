"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCampaign, executeCampaignSend } from "@/lib/comms/send";
import { buildChecklistDigest } from "@/lib/conference/checklist-engine";

/**
 * Send one checklist reminder to the signed-in admin, and nobody else.
 *
 * Uses `buildChecklistDigest` — the same builder the cron run uses — so this
 * tests the real email rather than an approximation of it.
 *
 * Two things it deliberately does NOT do:
 *  · write `conference_checklist_reminder_log`. That log is what stops an org
 *    being reminded twice; a test that wrote to it would silently cancel the
 *    real reminder for whichever org was sampled.
 *  · respect the checklist's `active` flag. Testing a switched-off checklist
 *    before arming it is the entire point.
 */
export async function sendChecklistTestEmail(
  checklistId: string,
  organizationId?: string
): Promise<{ success: boolean; sentTo?: string; sampledOrg?: string; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error ?? "Admins only." };

  const to = auth.ctx.userEmail;
  if (!to) return { success: false, error: "Your account has no email address to send to." };

  const db = createAdminClient();
  const { data: checklist } = await db
    .from("conference_checklists")
    .select("id, name, conference_id, deadline_at, publication_id, publication:publications(title), conference:conference_instances(year, edition_code)")
    .eq("id", checklistId)
    .maybeSingle();
  if (!checklist) return { success: false, error: "Checklist not found." };

  const conference = Array.isArray(checklist.conference) ? checklist.conference[0] : checklist.conference;
  if (!conference) return { success: false, error: "That checklist has no conference." };
  const publication = Array.isArray(checklist.publication) ? checklist.publication[0] : checklist.publication;

  // Pick an org with something actually outstanding. An org that is fully
  // caught up produces no email at all, and a test that silently sends nothing
  // reads as a broken send rather than as correct behaviour.
  let orgIds: string[] = organizationId ? [organizationId] : [];
  if (orgIds.length === 0) {
    const { data: balances } = await db
      .from("entity_balances")
      .select("organization_id")
      .eq("conference_id", checklist.conference_id)
      .not("organization_id", "is", null)
      .limit(40);
    orgIds = [...new Set((balances ?? []).map((b) => b.organization_id).filter((v): v is string => !!v))];
  }

  let digest = null as Awaited<ReturnType<typeof buildChecklistDigest>>;
  let sampledOrg: string | undefined;
  for (const orgId of orgIds) {
    digest = await buildChecklistDigest(
      { ...checklist, publicationTitle: publication?.title ?? null },
      conference,
      orgId,
      db
    );
    if (digest) { sampledOrg = digest.orgName; break; }
  }
  if (!digest) {
    return { success: false, error: "Nothing outstanding on this checklist — there is no reminder to send." };
  }

  const campaign = await createCampaign({
    name: `TEST — ${checklist.name} reminder to ${to}`,
    templateKey: "conference_checklist_reminder",
    audience: {
      type: "custom_recipient_list",
      filters: {
        recipients: [{
          email: to,
          name: auth.ctx.userEmail ?? null,
          variableOverrides: {
            contact_name: "there",
            ...digest.variables,
            // Marked in the body itself, not just the campaign name — the
            // recipient sees the email, not the campaign record.
            checklist_name: `[TEST] ${digest.variables.checklist_name}`,
          },
        }],
      },
    },
    triggerSource: "conference",
    automationMode: "auto_send",
  });
  if (!campaign.success || !campaign.campaignId) {
    return { success: false, error: campaign.error ?? "Could not create the test campaign." };
  }

  await executeCampaignSend(campaign.campaignId);
  return { success: true, sentTo: to, sampledOrg };
}
