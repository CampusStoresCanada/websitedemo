/**
 * Send ONE test copy of any campaign, rendered as a real recipient.
 *
 *   npx tsx scripts/send-campaign-test.mts <campaignId> [toAddress]
 *
 * Renders through the campaign's own template with a real audience member's
 * resolved variables, so the test differs from the real thing only in the
 * address it goes to. RENDER_AS=<email> picks which member to borrow; without
 * it, the first recipient is used.
 *
 * ⛔ Fails loudly rather than falling back to placeholder copy. An earlier
 * test sender fell back to a hardcoded sample when the lookup missed, which
 * meant a green "sent" could be a test of the wrong email entirely.
 *
 * Creates no campaign, template or delivery rows. DEV_EMAIL_INTERCEPT, when
 * set, redirects the actual delivery regardless of `toAddress`.
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
const { getTemplateById, renderTemplate } = await import("../lib/comms/templates");
const { sendEmail } = await import("../lib/email/send");

const CAMPAIGN_ID = process.argv[2];
const TO = process.argv[3] ?? "google@campusstores.ca";
if (!CAMPAIGN_ID) {
  console.error("usage: send-campaign-test.mts <campaignId> [toAddress]");
  process.exit(1);
}

const db = createAdminClient();
const { data: campaign, error } = await db
  .from("message_campaigns")
  .select("name, status, template_id, subject_override, body_override, audience_definition, variable_values")
  .eq("id", CAMPAIGN_ID)
  .maybeSingle();

if (error || !campaign) {
  console.error("campaign not found:", error?.message);
  process.exit(1);
}

const tmpl = campaign.template_id ? await getTemplateById(campaign.template_id as string) : null;
// Same precedence as executeCampaignSend.
const subjectRaw = ((campaign.subject_override ?? tmpl?.subject) ?? "") as string;
const bodyRaw = ((campaign.body_override ?? tmpl?.body_html) ?? "") as string;
if (!bodyRaw.trim()) {
  console.error("ABORT: resolved body is empty — nothing to test.");
  process.exit(1);
}

const people = await resolveAudience(campaign.audience_definition as never);
const borrow = process.env.RENDER_AS?.toLowerCase();
const who = borrow ? people.find((p) => p.email.toLowerCase() === borrow) : people[0];
if (!who) {
  console.error(`ABORT: no recipient to render as${borrow ? ` (${borrow} not in this audience)` : ""}.`);
  process.exit(1);
}

const variables: Record<string, string> = {
  app_url: process.env.NEXT_PUBLIC_APP_URL ?? "",
  ...((campaign.variable_values ?? {}) as Record<string, string>),
  ...((who.variableOverrides ?? {}) as Record<string, string>),
};

const subject = renderTemplate(subjectRaw, variables);
const html = renderTemplate(bodyRaw, variables);

const leftover = [...new Set([...(html.match(/\{\{[^}]*\}\}/g) ?? []), ...(subject.match(/\{\{[^}]*\}\}/g) ?? [])])];
if (leftover.length) {
  console.error(`ABORT: unrendered merge fields: ${leftover.join(", ")}`);
  process.exit(1);
}

// NOT wrapped here: sendEmail calls wrapEmailBody itself.
const res = await sendEmail({ to: TO, subject: `[TEST] ${subject}`, html });

console.log(`${campaign.name}`);
console.log(`  rendered as : ${who.variableOverrides?.first_name ?? "?"} <${who.email}>${borrow ? " (borrowed)" : ""}`);
console.log(`  subject     : ${subject}`);
console.log(`  result      : ${res.success ? "sent" : `FAILED ${res.error}`} ${res.messageId ?? ""}`);
if (process.env.DEV_EMAIL_INTERCEPT) console.log(`  intercepted : ${process.env.DEV_EMAIL_INTERCEPT}`);
if (!res.success) process.exitCode = 1;
