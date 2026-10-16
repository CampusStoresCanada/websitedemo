/**
 * Build the three Conference in a Box partner campaigns as DRAFTS.
 *
 *   npx tsx scripts/build-conference-in-a-box-campaigns.mts           # dry run
 *   npx tsx scripts/build-conference-in-a-box-campaigns.mts --create  # writes
 *
 * Never schedules and never sends. The send is a human click in /admin/comms.
 *
 * Three cohorts, cut by the ENTITLEMENT GRAPH rather than booth price:
 *   A  holds a booth that does NOT grant the Box   -> pays $750
 *   B  holds no booth at all                       -> pays $750
 *   C  holds a booth that DOES grant the Box       -> included
 *
 * ⛔ Price is a proxy; the `includes` edge is the truth. SQL does not walk
 * instance_of, so the query needs an explicit arm for booths that inherit the
 * grant from archetype 600 — without it this resolves 1 org instead of 16.
 *
 * ⛔ Bodies are authored as ContentBlock[] and passed as bodyBlocks, never as
 * hand-written body_html. body_html is compiled output: raw HTML put there
 * survives only until someone opens the template in the UI, at which point the
 * editor normalises it and silently drops images, buttons and inline styles.
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
const { createCampaign } = await import("../lib/comms/send");
const { createCampaignInitiative } = await import("../lib/comms/campaigns");
const { deriveRecipientNameVariables } = await import("../lib/comms/format");
const { lookupUserEmailsByIds } = await import("../lib/supabase/user-lookup");
type ContentBlock = import("../lib/comms/blocks/types").ContentBlock;

const CREATE = process.argv.includes("--create");
const CONF = "7e650b08-51d1-4573-a332-7d6b6fbc50bd";
const BOX = "https://www.campusstores.ca/conference-in-a-box";
const CONFERENCE = "https://www.campusstores.events";
// ⛔ Storage, not the site. The old `/email/...` path is a live 404 — it only
// works if the file is committed AND deployed, and it never was. The three
// campaigns already built carry this storage URL; this constant was stale and
// would have reintroduced a broken header on any rebuild.
const HEADER =
  "https://kalosjtiwtnwsseitfys.supabase.co/storage/v1/object/public/comms-content/headers/conference-in-a-box-2027.png";
const BRAND_RED = "#EE2A2E";

// Steve's exclusions, 2026-10-05/06.
//   suitcasing risk:            My Dorm Store, Randmar
//   nothing physical to ship:   Bookware, FIEL, PrismRBS, Ambassador, McGraw Hill
//   Big Ideas Day only:         VitalSource
// ⛔ Login Canada is NOT excluded despite being in the same ops/publisher group —
// they run branches selling medicine-themed toys, so they genuinely have product
// for the box. Steve: "they should get both."
const EXCLUDED = [
  "Bookware", "FIEL", "PrismRBS", "My Dorm Store", "Randmar",
  "Ambassador Education Solutions", "McGraw Hill", "VitalSource",
];

const db = createAdminClient();

// ── Cohorts ──────────────────────────────────────────────────────
const { data: archetype } = await db
  .from("conference_entities")
  .select("id")
  .eq("conference_id", CONF)
  .eq("kind", "booth")
  .eq("name", "600")
  .maybeSingle();
if (!archetype) throw new Error("archetype booth 600 not found");

// Booth entities that grant the Box: the archetype itself plus its instances.
const { data: instanceRefs } = await db
  .from("conference_entity_refs")
  .select("from_entity_id")
  .eq("role", "instance_of")
  .eq("to_entity_id", archetype.id);
const grantingBoothIds = new Set<string>([archetype.id, ...(instanceRefs ?? []).map((r) => r.from_entity_id)]);

const { data: balances } = await db
  .from("entity_balances")
  .select("organization_id, entity_id, conference_entities!inner(kind)")
  .eq("conference_id", CONF)
  .gt("quantity", 0);

const holdsGranting = new Set<string>();
const holdsAnyBooth = new Set<string>();
for (const b of balances ?? []) {
  const ent = Array.isArray(b.conference_entities) ? b.conference_entities[0] : b.conference_entities;
  if (ent?.kind !== "booth" || !b.organization_id) continue;
  holdsAnyBooth.add(b.organization_id);
  if (grantingBoothIds.has(b.entity_id)) holdsGranting.add(b.organization_id);
}

const { data: partners } = await db
  .from("organizations")
  .select("id, name")
  .eq("type", "Vendor Partner")
  .in("membership_status", ["active", "reactivated"])
  .is("archived_at", null)
  .or("is_test.is.null,is_test.eq.false");

const eligible = (partners ?? []).filter((o) => !EXCLUDED.includes(o.name));

function cohortOf(orgId: string): "A" | "B" | "C" {
  if (holdsGranting.has(orgId)) return "C";
  return holdsAnyBooth.has(orgId) ? "A" : "B";
}

// ── Recipients ───────────────────────────────────────────────────
const orgIds = eligible.map((o) => o.id);
const { data: links } = await db
  .from("user_organizations")
  .select("user_id, organization_id")
  .in("organization_id", orgIds)
  .eq("status", "active")
  .in("role", ["org_admin", "member"]);

const userIds = [...new Set((links ?? []).map((l) => l.user_id).filter(Boolean))] as string[];
const emails = await lookupUserEmailsByIds(db, userIds);

// Names come from contacts, keyed per (person, org) — profiles.display_name
// holds the email handle for a large share of logins.
const contactName = new Map<string, string>();
for (let i = 0; i < userIds.length; i += 150) {
  const { data: rows } = await db
    .from("contacts")
    .select("profile_id, organization_id, first_name, name")
    .in("profile_id", userIds.slice(i, i + 150));
  for (const c of rows ?? []) {
    const real = c.first_name?.trim() || c.name?.trim();
    if (c.profile_id && c.organization_id && real) contactName.set(`${c.profile_id}:${c.organization_id}`, real);
  }
}

const orgName = new Map(eligible.map((o) => [o.id, o.name]));
const byCohort: Record<"A" | "B" | "C", { email: string; name: string | null; variableOverrides: Record<string, string> }[]> =
  { A: [], B: [], C: [] };
const seen = new Set<string>();

for (const l of links ?? []) {
  if (!l.user_id || !l.organization_id) continue;
  const email = emails[l.user_id];
  if (!email) continue;
  const key = `${email.toLowerCase()}:${l.organization_id}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const name = contactName.get(`${l.user_id}:${l.organization_id}`) ?? null;
  byCohort[cohortOf(l.organization_id)].push({
    email,
    name,
    variableOverrides: {
      ...deriveRecipientNameVariables(name, email),
      org_name: orgName.get(l.organization_id) ?? "",
    },
  });
}

// ── Bodies, as blocks ────────────────────────────────────────────
const header = (): ContentBlock => ({
  id: "header",
  type: "image",
  src: HEADER,
  alt: "Conference in a Box",
  href: BOX,
  widthPercent: 100,
});
const gap = (id: string, h = 12): ContentBlock => ({ id, type: "spacer", height: h });
const text = (id: string, html: string): ContentBlock => ({ id, type: "text", html });
const cta = (id: string, label: string): ContentBlock => ({
  id,
  type: "button",
  text: label,
  href: BOX,
  align: "left",
  color: BRAND_RED,
});

const WHO = `The buyer who never leaves the building, the staff who've never been to a trade
show, the person who decides what gets carried and never gets to travel. Your product ends up
in their hands, in their own store, weeks before February while they're still working out what
to stock.`;

const VARIANTS = {
  A: {
    name: "Conference in a Box — booth, not Connected",
    subject: "You will be on the floor. Be in their store too.",
    blocks: (): ContentBlock[] => [
      header(),
      gap("g1"),
      text("hi", "<p>Hi {{first_name}},</p>"),
      text("hook", "<p>Send us your most exciting product and get everyone in the store in on the action.</p>"),
      text(
        "body",
        `<p>You've got a booth in Toronto, so the people who walk the floor will meet you. <a href="${BOX}">Conference in a Box</a> is how you reach the rest of them. ${WHO}</p>`
      ),
      text("terms", "<p>$750, and it needs to reach us by Friday, November 20.</p>"),
      cta("cta", "Get your product into every store"),
    ],
  },
  B: {
    name: "Conference in a Box — no booth",
    subject: "Can't make the conference? Be in every store anyway.",
    blocks: (): ContentBlock[] => [
      header(),
      gap("g1"),
      text("hi", "<p>Hi {{first_name}},</p>"),
      text(
        "hook",
        `<p>Still contemplating this year's <a href="${CONFERENCE}">Campus Stores Conference</a>? We've got another way for you to be involved even if the big show isn't in the cards this year: <a href="${BOX}">Conference in a Box</a>.</p>`
      ),
      text(
        "body",
        "<p>We'll make sure your best, hottest product is in every CSC store. Not just the ones who can travel to the conference, but every member across the country, and it lands in their hands weeks before February while they're still working out what to stock.</p>"
      ),
      text("terms", "<p>$750, and it needs to reach us by Friday, November 20.</p>"),
      cta("cta", "Get your product into every store"),
      gap("g2", 8),
      text(
        "ps",
        `<p><strong>P.S.</strong> Register as a Connected Exhibitor and this comes included, along with a good deal more. <a href="${CONFERENCE}">Have a look.</a></p>`
      ),
    ],
  },
  C: {
    name: "Conference in a Box — Connected, included",
    subject: "You already paid for this. Here's how to use it.",
    blocks: (): ContentBlock[] => [
      header(),
      gap("g1"),
      text("hi", "<p>Hi {{first_name}},</p>"),
      text(
        "hook",
        `<p>Take advantage of what you've already got. <a href="${BOX}">Conference in a Box</a> comes with your Connected Exhibitor booth, a $750 value included in your registration, and we appreciate the support.</p>`
      ),
      text(
        "body",
        `<p>So there's nothing to buy. Just send us your most exciting product and we'll get everyone in the store in on the action. ${WHO}</p>`
      ),
      text("terms", "<p>We need it by Friday, November 20.</p>"),
      cta("cta", "Get the exact details here"),
    ],
  },
} as const;

console.log("cohort  orgs  contacts");
for (const k of ["A", "B", "C"] as const) {
  const orgs = new Set(eligible.filter((o) => cohortOf(o.id) === k).map((o) => o.id)).size;
  console.log(`  ${k}     ${String(orgs).padStart(3)}   ${String(byCohort[k].length).padStart(4)}   ${VARIANTS[k].name}`);
}
console.log(`\nexcluded: ${EXCLUDED.join(", ")}`);

if (!CREATE) {
  console.log("\nDRY RUN — nothing written. Re-run with --create.");
  process.exit(0);
}

const init = await createCampaignInitiative({
  name: "Conference in a Box — 2027",
  goal: "Get partner product into every member store before the 2027 conference. Three sends, cut by what the partner already holds.",
});
if (!init.success || !init.id) throw new Error(`initiative failed: ${init.error}`);
console.log(`\ninitiative: ${init.id}`);

for (const k of ["A", "B", "C"] as const) {
  const v = VARIANTS[k];
  const tpl = await createTemplate({
    name: v.name,
    description: `Conference in a Box, cohort ${k}. Audience baked at build time from the entitlement graph.`,
    category: "conference",
    subject: v.subject,
    body_html: "",
    bodyBlocks: v.blocks() as never,
    campaignId: init.id,
    isTransactional: false,
  });
  if (!tpl.success || !tpl.id) throw new Error(`template ${k} failed: ${tpl.error}`);

  const res = await createCampaign({
    name: v.name,
    templateId: tpl.id,
    audience: { type: "custom_recipient_list", filters: { recipients: byCohort[k] } },
    campaignId: init.id,
  });
  if (!res.success) throw new Error(`campaign ${k} failed: ${res.error}`);
  console.log(`  ${k}: template ${tpl.id}  campaign ${res.campaignId}  (${byCohort[k].length} recipients, draft)`);
}

console.log("\nAll three are DRAFTS. Nothing scheduled, nothing sent.");
