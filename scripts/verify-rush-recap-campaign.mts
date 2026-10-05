/**
 * Pre-flight for the Rush Recap draft. Writes nothing, sends nothing.
 *
 *   npx tsx scripts/verify-rush-recap-campaign.mts [campaignId]
 *
 * Proves three things the draft alone cannot:
 *   1. how many recipients survive suppression (CASL runs at send time, not
 *      when the draft was built, so the stored 344 is an upper bound)
 *   2. that every merge field actually resolves — an unrendered {{local_time}}
 *      would ship a literal brace to 344 people
 *   3. that each province renders its own time
 *
 * Renders through the same path executeCampaignSend uses for a campaign with
 * no template row (subject/body override + renderTemplate), so a pass here
 * means the real send renders identically.
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
const { resolveAudience } = await import("../lib/comms/audience");
const { filterSuppressedRecipients } = await import("../lib/comms/suppressions");
const { renderTemplate } = await import("../lib/comms/templates");

const CAMPAIGN_ID = process.argv[2] ?? "4bf9b6df-0326-42ff-a710-e6c4be604cef";
const supabase = createAdminClient();

const { data: campaign, error } = await supabase
  .from("message_campaigns")
  .select("*")
  .eq("id", CAMPAIGN_ID)
  .single();

if (error || !campaign) {
  console.error("campaign not found:", error?.message);
  process.exit(1);
}

console.log(`campaign: ${campaign.name}`);
console.log(`status:   ${campaign.status}`);
console.log(`template: ${campaign.template_id ?? "(none — subject/body override)"}\n`);

const stored = await resolveAudience(campaign.audience_definition as never);
// No template row means no is_transactional exemption, so suppression applies.
const live = await filterSuppressedRecipients(supabase, stored, null);

console.log(`stored in draft:      ${stored.length}`);
console.log(`after suppression:    ${live.length}`);
if (stored.length !== live.length) {
  console.log(`⚠️  ${stored.length - live.length} suppressed (unsubscribed) and will NOT receive it`);
}

const subjectRaw = (campaign.subject_override ?? "") as string;
const bodyRaw = (campaign.body_override ?? "") as string;

let unrendered = 0;
const samples = new Map<string, string>();

for (const r of live) {
  const variables: Record<string, string> = {
    app_url: process.env.NEXT_PUBLIC_APP_URL ?? "",
    ...((campaign.variable_values ?? {}) as Record<string, string>),
    ...((r.variableOverrides ?? {}) as Record<string, string>),
  };
  const subject = renderTemplate(subjectRaw, variables);
  const body = renderTemplate(bodyRaw, variables);

  if (/\{\{|\}\}/.test(subject) || /\{\{|\}\}/.test(body)) {
    unrendered += 1;
    if (unrendered <= 3) {
      const leftover: string[] = [
        ...(body.match(/\{\{[^}]*\}\}/g) ?? []),
        ...(subject.match(/\{\{[^}]*\}\}/g) ?? []),
      ];
      console.log(`  UNRENDERED for ${r.email}: ${[...new Set(leftover)].join(", ")}`);
    }
  }

  const province = variables.organization_province ?? "(none)";
  if (!samples.has(province)) {
    const line = body.match(/Rush Recap is this Wednesday[^<]*/)?.[0]?.trim() ?? "(sentence not found)";
    const greeting = body.match(/Hi [^<,]*/)?.[0]?.trim() ?? "(greeting not found)";
    samples.set(province, `${greeting} … ${line}`);
  }
}

console.log(`\nunrendered merge fields: ${unrendered === 0 ? "none ✓" : `${unrendered} RECIPIENTS AFFECTED ✗`}`);

console.log("\none sample per province:");
for (const [province, line] of [...samples].sort()) {
  console.log(`\n  ${province}`);
  console.log(`    ${line}`);
}

// Links must be absolute and production, never localhost.
const localhostLinks = (bodyRaw.match(/https?:\/\/localhost[^"']*/g) ?? []).length;
console.log(`\nlocalhost links in body: ${localhostLinks === 0 ? "none ✓" : `${localhostLinks} ✗`}`);

const ok = unrendered === 0 && localhostLinks === 0 && live.length > 0;
console.log(`\n${ok ? "READY" : "NOT READY"} — ${live.length} recipients, status ${campaign.status}`);
if (!ok) process.exitCode = 1;
