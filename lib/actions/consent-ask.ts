"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCampaign, executeCampaignSend } from "@/lib/comms/send";
import { summarizeConsentAsk, printedDetailsHtml } from "@/lib/publication/consent-ask";
import { loadPublication } from "@/lib/publication/store";

/**
 * Send the listing question to each person who has not answered it.
 *
 * Guarded by an explicit confirmation count from the caller: outbound mail to
 * hundreds of individuals should not be one mis-click away, and a stale preview
 * ("send to 511") must not silently become a different send.
 */
export async function sendConsentAsk(
  publicationId: string,
  expectedCount: number
): Promise<{ success: boolean; sent?: number; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error ?? "Admins only." };

  const saved = await loadPublication(publicationId);
  if (!saved) return { success: false, error: "Publication not found." };

  const summary = await summarizeConsentAsk(saved.publication);
  if (summary.askable === 0) return { success: false, error: "Nobody is waiting to be asked." };
  if (summary.askable !== expectedCount) {
    return {
      success: false,
      error:
        `The list changed since you looked — it is now ${summary.askable}, not ${expectedCount}. ` +
        `Reload and check before sending.`,
    };
  }

  const db = createAdminClient();
  const conferenceId =
    saved.publication.source.kind === "conference" ? saved.publication.source.conferenceId : null;
  const { data: conference } = conferenceId
    ? await db.from("conference_instances").select("year").eq("id", conferenceId).maybeSingle()
    : { data: null };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstorescanada.ca";
  const year = String(conference?.year ?? new Date().getUTCFullYear() + 1);
  const deadline = "1 November 2026";

  const recipients = summary.candidates.map((c) => ({
    email: c.email,
    name: c.name,
    variableOverrides: {
      contact_name: c.name,
      org_name: c.orgName,
      year,
      printed_details_html: printedDetailsHtml(c),
      // Straight to the control, not a landing page about it.
      choose_url: `${appUrl}/me`,
      deadline,
    },
  }));

  const campaign = await createCampaign({
    name: `Directory listing — your decision (${summary.askable} people)`,
    templateKey: "directory_visibility_ask",
    audience: { type: "custom_recipient_list", filters: { recipients } },
    triggerSource: "conference",
    automationMode: "auto_send",
  });
  if (!campaign.success || !campaign.campaignId) {
    return { success: false, error: campaign.error ?? "Could not create the campaign." };
  }

  await executeCampaignSend(campaign.campaignId);

  // Stamped only after the send is away, so a failure leaves people askable
  // rather than marking them contacted when they were not.
  const askedAt = new Date().toISOString();
  await db
    .from("contacts")
    .update({ directory_visibility_asked_at: askedAt })
    .in("id", summary.candidates.map((c) => c.contactId));

  revalidatePath(`/admin/publications/${publicationId}`);
  return { success: true, sent: summary.askable };
}
