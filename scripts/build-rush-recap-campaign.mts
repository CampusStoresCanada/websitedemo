/**
 * Build the Rush Recap member campaign as a DRAFT.
 *
 * Dry run by default — resolves the audience, computes each recipient's local
 * time and prints the breakdown without writing anything:
 *
 *   npx tsx scripts/build-rush-recap-campaign.mts
 *
 * Add --create to insert the draft campaign. It is left in `draft`, never
 * scheduled or sent: the send itself is a human click in /admin/comms.
 *
 * Uses custom_recipient_list because {{local_time}} differs per recipient —
 * a single shared variable set cannot express that. The recipient list is
 * resolved through the normal org_admins path first, so suppression,
 * test-org exclusion and the org variable loading all behave as usual.
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

const { resolveAudience } = await import("../lib/comms/audience");
const { createCampaign } = await import("../lib/comms/send");
const { localEventTimeSentence } = await import("../lib/comms/local-time");

const CREATE = process.argv.includes("--create");
const EVENT_AT = new Date("2026-10-07T16:00:00Z"); // 10:00 MDT
const APP = "https://www.campusstores.ca";
const POST = "/c/announcements-f3687d/rush-is-over-was-yours-normal";
const EVENT = "/c/events/rush-recap";
const SURVEY = "https://forms.gle/xFudr9BbZdFPhZ27A";
const bridge = (to: string) => `${APP}/api/circle/member-space?to=${encodeURIComponent(to)}`;

const ACTIVE = new Set(["active", "reactivated"]);

const resolved = await resolveAudience({
  type: "org_admins",
  filters: { org_type: "Member", roles: ["org_admin", "member"] },
});

console.log(`resolved from org_admins(Member): ${resolved.length}`);

// Membership status is already on each recipient as an organization variable,
// so the active filter happens here rather than as a saved condition key.
const active = resolved.filter((r) =>
  ACTIVE.has(String(r.variableOverrides?.organization_membership_status ?? "").toLowerCase())
);
console.log(`active / reactivated:            ${active.length}`);

const byProvince = new Map<string, number>();
let unknownProvince = 0;

const recipients = active.map((r) => {
  const province = r.variableOverrides?.organization_province ?? null;
  const when = localEventTimeSentence(EVENT_AT, province, "10:00 a.m. MT");
  const key = province ?? "(none)";
  byProvince.set(key, (byProvince.get(key) ?? 0) + 1);
  if (!province) unknownProvince += 1;
  return {
    email: r.email,
    name: r.name,
    variableOverrides: {
      ...r.variableOverrides,
      local_time: when,
    },
  };
});

console.log("\nlocal time by province:");
for (const [province, n] of [...byProvince].sort((a, b) => b[1] - a[1])) {
  const when = localEventTimeSentence(EVENT_AT, province === "(none)" ? null : province, "10:00 a.m. MT");
  console.log(`  ${province.padEnd(28)} ${String(n).padStart(3)}  ${when}`);
}
if (unknownProvince) console.log(`\n⚠️  ${unknownProvince} recipients fall back to the Mountain time line`);

const body = `
<tr><td style="padding:0 0 24px 0;">
  <img src="${APP}/email/rush-recap-2026-header.png" width="600"
       alt="Rush Recap: what even happened this year?"
       style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
</td></tr>
<tr><td style="padding:0 32px;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.6;color:#1f2328;">
  <p style="margin:0 0 16px;">Hi {{first_name}},</p>

  <p style="margin:0 0 16px;">Rush Recap is this Wednesday, October 7 at {{local_time}}. Ninety
  minutes, stores only, and it's the one call where you find out whether the thing that
  broke in your store broke everywhere.</p>

  <p style="margin:0 0 16px;">Back in August, Shannon wished us all tills that stayed
  connected and access codes that stayed redeemable. Wednesday is where we find out
  whose didn't.</p>

  <p style="margin:0 0 24px;">Bring one thing. A number that surprised you, a product that
  moved or didn't, something that broke in week two.</p>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
    <tr><td style="background-color:#EE2A2E;border-radius:4px;">
      <a href="${bridge(EVENT)}" style="display:inline-block;padding:13px 28px;
         font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:bold;
         color:#ffffff;text-decoration:none;">Get Registered</a>
    </td></tr>
  </table>

  <p style="margin:0 0 16px;">
    <a href="${bridge(POST)}" style="color:#EE2A2E;">Read the full post on Circle.</a></p>

  <p style="margin:0 0 32px;">Missed the Town Hall?
    <a href="https://youtu.be/DPdIF32MoSo" style="color:#EE2A2E;">Here's the recording to
    catch you up</a>, no sign-in needed. Don't worry, we'll be posting a lot of the details
    over the next couple of weeks as well.</p>

  <p style="margin:0 0 32px;padding-top:8px;border-top:1px solid #e5e7eb;">
    <strong>P.S.</strong> Were you at the Town Hall?
    <a href="${SURVEY}" style="color:#EE2A2E;">Tell us what you thought</a>.
    It takes about a minute.</p>
</td></tr>`;

if (!CREATE) {
  console.log("\nDRY RUN — nothing written. Re-run with --create to insert the draft.");
  console.log(`would create a draft for ${recipients.length} recipients`);
  process.exit(0);
}

const result = await createCampaign({
  name: "Rush Recap — members",
  subjectOverride: "Rush Recap: what even happened this year?",
  bodyOverride: body,
  audience: { type: "custom_recipient_list", filters: { recipients } },
});

console.log(result.success ? `\ndraft created: ${result.campaignId}` : `\nFAILED: ${result.error}`);
if (!result.success) process.exitCode = 1;
