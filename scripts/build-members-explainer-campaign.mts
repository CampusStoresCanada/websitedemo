/**
 * Build the Friday members explainer as a DRAFT, then schedule it.
 *
 *   npx tsx scripts/build-members-explainer-campaign.mts            # dry run
 *   npx tsx scripts/build-members-explainer-campaign.mts --create   # writes a draft
 *   npx tsx scripts/build-members-explainer-campaign.mts --schedule # draft + schedules
 *
 * First of a series answering "what's in this website for me", one capability
 * at a time. Steve, 2026-10-07: "Real quick, hey this is a thing the website
 * can do. Find someone like you."
 *
 * ⛔ MEMBERS ONLY this week. Partners get the same idea in a "here's how to
 * find your members" version LATER — not Friday, because they already receive
 * Conference in a Box at 6:15 and Big Ideas Day at 9:00 that morning.
 *
 * ⛔ The copy promises only what the data supports. Size and province are
 * filled in for all 51 active member orgs, so those filters never return an
 * empty page. Platform, services and operating model come from benchmarking
 * (33 of 51 have a POS recorded, across 12 platforms), so they are mentioned
 * as a conditional and never as the headline.
 *
 * ⛔ The survey is the SAME form Monday's Rush Recap already linked
 * (both short links resolve to .../1FAIpQLSeu946Vym...). So it is written as a
 * nudge for people who have not filled it in, not as a new ask.
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
const { createTemplate } = await import("../lib/comms/templates");
const { createCampaign, scheduleCampaign } = await import("../lib/comms/send");
const { createCampaignInitiative } = await import("../lib/comms/campaigns");
type ContentBlock = import("../lib/comms/blocks/types").ContentBlock;

const CREATE = process.argv.includes("--create") || process.argv.includes("--schedule");
const SCHEDULE = process.argv.includes("--schedule");

const MEMBERS_URL = "https://www.campusstores.ca/members";
const SURVEY = "https://forms.gle/GboAiZKeabYP1c44A";
const BRAND_RED = "#EE2A2E";
// 9:00 a.m. MDT. MDT is UTC-6 on this date; DST ends 2026-11-01.
const WHEN = new Date("2026-10-09T15:00:00.000Z");

// Same rule that produced the Rush Recap audience, re-resolved rather than
// copied: that list was baked on 2026-10-05 and membership moves.
const people = await resolveAudience({
  type: "org_admins",
  filters: { org_type: "Member", roles: ["org_admin", "member"] },
} as never);

const ACTIVE = new Set(["active", "reactivated"]);
const active = people.filter((r) =>
  ACTIVE.has(String(r.variableOverrides?.organization_membership_status ?? "").toLowerCase())
);

/** "Hi Dana," / "Hi," — never "Hi ," and never an email handle. */
function greetingFor(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw || raw.includes("@")) return "Hi,";
  const first = raw.split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hi,";
}

const recipients = active.map((r) => ({
  email: r.email,
  name: r.name ?? null,
  variableOverrides: {
    ...r.variableOverrides,
    greeting: greetingFor(r.variableOverrides?.first_name ?? r.name),
  },
}));

const text = (id: string, html: string): ContentBlock => ({ id, type: "text", html });
const gap = (id: string, h = 12): ContentBlock => ({ id, type: "spacer", height: h });

const blocks: ContentBlock[] = [
  text("hi", "<p>{{greeting}}</p>"),
  text(
    "what",
    "<p><strong>The members tab does one thing well.</strong> It puts every CSC store on a map and in a table, and lets you narrow to the ones that look like you.</p>"
  ),
  text(
    "how",
    "<p>By size, by province, and where a store has done benchmarking, by the platform they run and the services they offer.</p>"
  ),
  text(
    "why",
    "<p>So next time you're about to decide something and want to know who has already decided it, that's where you look.</p>"
  ),
  { id: "cta", type: "button", text: "Find a store like yours", href: MEMBERS_URL, align: "left", color: BRAND_RED },
  gap("g1", 20),
  { id: "rule", type: "divider" },
  gap("g2", 12),
  text(
    "survey",
    `<p><strong>Were you at the Town Hall?</strong> If you haven't already, <a href="${SURVEY}">tell us what you thought</a>. It takes a couple of minutes.</p>`
  ),
];

console.log(`resolved ${people.length} member contacts, ${recipients.length} at active orgs`);
const bare = recipients.filter((r) => r.variableOverrides.greeting === "Hi,").length;
console.log(`${bare} greeted with a bare "Hi," (no name on file)`);

for (const r of recipients) {
  if (!r.variableOverrides.greeting?.trim()) throw new Error(`${r.email}: no greeting`);
  if (r.variableOverrides.greeting.includes("@")) throw new Error(`${r.email}: greeting holds an email handle`);
}
const used = new Set<string>();
for (const b of blocks) for (const m of ((b as { html?: string }).html ?? "").matchAll(/\{\{(\w+)\}\}/g)) used.add(m[1]);
const missing = [...used].filter((k) => recipients.some((r) => !(k in r.variableOverrides)));
if (missing.length) throw new Error(`copy uses {{${missing.join("}}, {{")}}} but not every recipient supplies it`);
console.log(`✅ merge fields: ${[...used].join(", ")} — supplied for all ${recipients.length}`);

if (!CREATE) {
  console.log("\nDRY RUN — nothing written. Re-run with --create (or --schedule).");
  process.exit(0);
}

const init = await createCampaignInitiative({
  name: "Website explainers — 2026",
  goal: "Answer \"what's in this website for me\", one capability per send. First: the members tab for finding comparable institutions.",
});
if (!init.success || !init.id) throw new Error(`initiative failed: ${init.error}`);

const tpl = await createTemplate({
  name: "Members explainer — find a store like yours",
  description: "First website explainer. Members tab, filtering to comparable institutions. Town Hall survey nudge in the footer.",
  category: "membership",
  subject: "Find a store like yours",
  body_html: "",
  bodyBlocks: blocks as never,
  campaignId: init.id,
  isTransactional: false,
});
if (!tpl.success || !tpl.id) throw new Error(`template failed: ${tpl.error}`);

const res = await createCampaign({
  name: "Members explainer — find a store like yours",
  templateId: tpl.id,
  audience: { type: "custom_recipient_list", filters: { recipients } },
  campaignId: init.id,
});
if (!res.success || !res.campaignId) throw new Error(`campaign failed: ${res.error}`);
console.log(`\ninitiative ${init.id}\ntemplate   ${tpl.id}\ncampaign   ${res.campaignId}  (${recipients.length} recipients, draft)`);

if (!SCHEDULE) {
  console.log("\nDRAFT only. Re-run with --schedule to set it for Friday 9:00 MDT.");
  process.exit(0);
}

const sched = await scheduleCampaign(res.campaignId, WHEN);
if (!sched.success) throw new Error(`schedule failed: ${sched.error}`);
console.log(`scheduled for ${WHEN.toISOString()} (Fri 9 Oct 2026, 9:00 a.m. MDT)`);
