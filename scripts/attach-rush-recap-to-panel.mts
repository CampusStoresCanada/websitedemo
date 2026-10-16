/**
 * Give the Rush Recap draft a home in the Comms panel.
 *
 *   npx tsx scripts/attach-rush-recap-to-panel.mts
 *
 * The draft was built with subject/body overrides and no template, which
 * made it invisible in /admin/comms:
 *
 *   - the "Campaigns" table lists initiatives and joins on campaign_id,
 *     which was null
 *   - "Other Sends" reads message_campaign_series, which is keyed by
 *     template and only contains series that have actually sent
 *
 * So it existed, rendered correctly, and could be sent — but only by URL.
 * This attaches it to the CSC Town Hall initiative (which is what the email
 * actually belongs to) and moves the content into a real template scoped to
 * that initiative, so the body is editable in the UI instead of living in a
 * script. Overrides are cleared so there is exactly one source of truth for
 * the content.
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may already be set */
}

const { createAdminClient } = await import("../lib/supabase/admin");
const { createTemplate } = await import("../lib/comms/templates");

const CAMPAIGN_ID = process.argv[2] ?? "4bf9b6df-0326-42ff-a710-e6c4be604cef";
const INITIATIVE_ID = "32b4c612-4541-4d58-afba-0819d0574b31"; // CSC Town Hall — September 2026

const supabase = createAdminClient();

const { data: campaign, error: loadErr } = await supabase
  .from("message_campaigns")
  .select("id, name, status, subject_override, body_override, template_id, campaign_id")
  .eq("id", CAMPAIGN_ID)
  .single();

if (loadErr || !campaign) {
  console.error("campaign not found:", loadErr?.message);
  process.exit(1);
}
if (campaign.status !== "draft") {
  console.error(`refusing to touch a campaign in status "${campaign.status}" — drafts only`);
  process.exit(1);
}
if (campaign.template_id) {
  console.log(`already has template ${campaign.template_id}; nothing to do`);
  process.exit(0);
}

const tpl = await createTemplate({
  name: "Rush Recap — members",
  description:
    "Town Hall follow-up #1. Members only (Rush Recap is a stores-only call). " +
    "{{local_time}} is resolved per recipient from the member's province.",
  category: "general",
  subject: (campaign.subject_override ?? "") as string,
  body_html: (campaign.body_override ?? "") as string,
  campaignId: INITIATIVE_ID,
  isTransactional: false, // commercial: suppression must apply
});

if (!tpl.success || !tpl.id) {
  console.error("template creation failed:", tpl.error);
  process.exit(1);
}
console.log(`template created: ${tpl.id} (scoped to the Town Hall initiative)`);

const { data: updated, error: updErr } = await supabase
  .from("message_campaigns")
  .update({
    template_id: tpl.id,
    campaign_id: INITIATIVE_ID,
    // One source of truth: the template now owns the content, so the
    // overrides must go or an edit in the UI would be silently ignored.
    subject_override: null,
    body_override: null,
  })
  .eq("id", CAMPAIGN_ID)
  .eq("status", "draft")
  .select("id, name, status, template_id, campaign_id")
  .maybeSingle();

if (updErr || !updated) {
  console.error("campaign update failed:", updErr?.message ?? "no draft matched");
  process.exit(1);
}

console.log(`campaign attached: ${updated.id}`);
console.log(`  initiative: ${updated.campaign_id}`);
console.log(`  template:   ${updated.template_id}`);
console.log(`  status:     ${updated.status}`);
