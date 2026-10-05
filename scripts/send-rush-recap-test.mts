/**
 * Send ONE test copy of the Rush Recap member email.
 *
 * Deliberately does NOT create a campaign, template or delivery row: local
 * code talks to the production database, so a test send that persists records
 * would leave real rows behind. This goes straight through the email layer.
 *
 *   npx tsx scripts/send-rush-recap-test.mts [recipient]
 *
 * Members only — Rush Recap is a stores-only call.
 *
 * ASSET_BASE is production, because /email/* assets are already deployed and
 * mail clients proxy images through their own servers (Gmail cannot reach
 * localhost, so a localhost image renders broken).
 *
 * LINK_BASE defaults to localhost because the ?to= interstitial is not
 * deployed yet. Clicking from this machine exercises the real path. Once it
 * ships, re-run with LINK_BASE=https://www.campusstores.ca.
 */
import { readFileSync } from "node:fs";

// Env must be populated before the Supabase/Resend modules initialise, which
// is why the imports below are dynamic. Same pattern as elections-live-check.
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may already be set */
}

const { sendEmail } = await import("../lib/email/send");
const { BRAND_RED, FONT } = await import("../lib/email/layout");
const { localEventTimeSentence } = await import("../lib/comms/local-time");

// 2026-10-07 10:00 MDT. Per-recipient in the real send; PROVINCE simulates
// one recipient here.
const EVENT_AT = new Date("2026-10-07T16:00:00Z");
const PROVINCE = process.env.PROVINCE ?? "Alberta";
const WHEN = localEventTimeSentence(EVENT_AT, PROVINCE, "10:00 a.m. MT");

const ASSET_BASE = "https://www.campusstores.ca";
const LINK_BASE = process.env.LINK_BASE ?? "http://localhost:3000";
const RECIPIENT = process.argv[2] ?? "google@campusstores.ca";
// Members only. Rush Recap is a stores-only call, so there is deliberately no
// partner variant of this email.
const SURVEY = "https://forms.gle/xFudr9BbZdFPhZ27A";

const POST = "/c/announcements-f3687d/rush-is-over-was-yours-normal";
const EVENT = "/c/events/rush-recap";
const bridge = (to: string) => `${LINK_BASE}/api/circle/member-space?to=${encodeURIComponent(to)}`;

const content = `
<tr><td style="padding:0 0 24px 0;">
  <img src="${ASSET_BASE}/email/rush-recap-2026-header.png"
       width="600" alt="Rush Recap: what even happened this year?"
       style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
</td></tr>
<tr><td style="padding:0 32px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1f2328;">
  <p style="margin:0 0 16px;">Hi Steve,</p>

  <p style="margin:0 0 16px;">Rush Recap is this Wednesday, October 7 at ${WHEN}. Ninety
  minutes, stores only, and it's the one call where you find out whether the thing that
  broke in your store broke everywhere.</p>

  <p style="margin:0 0 16px;">Back in August, Shannon wished us all tills that stayed
  connected and access codes that stayed redeemable. Wednesday is where we find out
  whose didn't.</p>

  <p style="margin:0 0 24px;">Bring one thing. A number that surprised you, a product
  that moved or didn't, something that broke in week two.</p>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
    <tr><td style="background-color:${BRAND_RED};border-radius:4px;">
      <a href="${bridge(EVENT)}"
         style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:16px;
                font-weight:bold;color:#ffffff;text-decoration:none;">Get Registered</a>
    </td></tr>
  </table>

  <p style="margin:0 0 16px;">
    <a href="${bridge(POST)}" style="color:${BRAND_RED};">Read the full post on Circle.</a>
  </p>

  <p style="margin:0 0 32px;">Missed the Town Hall?
    <a href="https://youtu.be/DPdIF32MoSo" style="color:${BRAND_RED};">Here's the recording
    to catch you up</a>, no sign-in needed. Don't worry, we'll be posting a lot of the
    details over the next couple of weeks as well.</p>

  <p style="margin:0 0 32px;padding-top:8px;border-top:1px solid #e5e7eb;">
    <strong>P.S.</strong> Were you at the Town Hall?
    <a href="${SURVEY}" style="color:${BRAND_RED};">Tell us what you thought</a>.
    It takes about a minute.</p>
</td></tr>`;

// NOT wrapped here: sendEmail() calls wrapEmailBody() itself, so pre-wrapping
// nests the whole CSC letterhead inside another copy of it.
const result = await sendEmail({
  to: RECIPIENT,
  subject: "[TEST] Rush Recap: what even happened this year?",
  html: content,
});

console.log(result.success ? "sent" : "FAILED", result.error ?? "", result.messageId ?? "");
console.log("to:", RECIPIENT);
console.log("links point at:", LINK_BASE);
console.log("images point at:", ASSET_BASE, "(letterhead uses NEXT_PUBLIC_APP_URL)");
console.log("survey:", SURVEY);
console.log("province:", PROVINCE, "->", WHEN);
if (process.env.DEV_EMAIL_INTERCEPT) console.log("INTERCEPTED to:", process.env.DEV_EMAIL_INTERCEPT);
if (!result.success) process.exitCode = 1;
