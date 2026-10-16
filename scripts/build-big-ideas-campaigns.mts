/**
 * Build the five Big Ideas Day campaigns as DRAFTS.
 *
 *   npx tsx scripts/build-big-ideas-campaigns.mts           # dry run
 *   npx tsx scripts/build-big-ideas-campaigns.mts --create  # writes
 *
 * Never schedules and never sends. The send is a human click in /admin/comms.
 *
 * Copy is transcribed verbatim from planning/town-hall-followup/03 and /04.
 * Change the copy there first, then here.
 *
 * ⛔ WHICH RATE A CURRENT PARTNER GETS COMES FROM THE NAMED LIST, NOT THE CSV.
 * `conference_entities.attributes.direct_purchase_org_ids` is what the live page
 * will actually offer them. Steve's CSV has a descriptive `Category` column, and
 * for Login Canada the two disagree: the CSV says publisher, the ops named list
 * says ops. Trusting the CSV would quote Login Canada $500 for an offer the page
 * only sells them at $1,000. The graph decides; the CSV is a contact list.
 *
 * ⛔ Bodies are authored as ContentBlock[] and passed as bodyBlocks, never as
 * hand-written body_html. body_html is compiled output: raw HTML put there
 * survives only until someone opens the template in the UI, at which point the
 * editor normalises it and silently drops images, buttons and inline styles.
 *
 * ⛔ The salutation is a {{greeting}} override, not {{first_name}}. 11 rows on
 * the reconnect list are shared inboxes with no human behind them, and
 * "Hi {{first_name}}," renders "Hi ," for those once the email handle is
 * stripped. A bare "Hi," is what a person would actually type.
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
const { createTemplate, updateTemplate, renderBlocksToHtml: _r } = await import("../lib/comms/templates");
const { renderBlocksToHtml } = await import("../lib/comms/blocks/render");
const { createCampaign } = await import("../lib/comms/send");
const { createCampaignInitiative } = await import("../lib/comms/campaigns");
const { lookupUserEmailsByIds } = await import("../lib/supabase/user-lookup");
type ContentBlock = import("../lib/comms/blocks/types").ContentBlock;

const CREATE = process.argv.includes("--create");
const REFRESH = process.argv.includes("--refresh");
const CONF = "7e650b08-51d1-4573-a332-7d6b6fbc50bd";
const CSV =
  process.argv.find((a) => a.endsWith(".csv")) ??
  "/Users/Work/Documents/Claude/Projects/Campus Stores Conference/big-ideas-day-invite-list.csv";

const DAY = "https://www.campusstores.ca/big-ideas-day";
const PARTNERSHIP = "https://www.campusstores.ca/partnership";
const BRAND_RED = "#EE2A2E";

// ⛔ Served from STORAGE, never from the site. `/email/<file>.png` only works if
// the file is committed AND deployed, and that has already failed once:
// campusstores.ca/email/conference-in-a-box-header.png is a live 404 today.
const HEADER =
  "https://kalosjtiwtnwsseitfys.supabase.co/storage/v1/object/public/comms-content/headers/big-ideas-day-2027.png";

/**
 * ⛔ Addresses removed from the audience whatever the graph says.
 *
 * andres.krisch@mheducation.com — Steve, 2026-10-06: "Andres is only
 * vitalsource. McGraw is a different company and we shouldn't be sending to
 * Andres." It is McGraw Hill's ONLY contact row and it carries an active login,
 * so excluding it here fixes the send and nothing else. The record itself needs
 * a human: see the open items in planning/town-hall-followup/03.
 */
const EXCLUDED_EMAILS = new Set(["andres.krisch@mheducation.com"]);

/** CSV company name -> organizations.name. Hand-written; never fuzzy-matched. */
const ALIASES: Record<string, string> = {
  "Carleton Technologies (Bookware 3000)": "Bookware",
};

type Variant = "ALREADY_IN" | "OPS" | "PUBLISHER" | "BOOTH_HOLDER" | "RECONNECT_PUBLISHER" | "RECONNECT_TECH";
type Row = { Company: string; Contact: string; Title: string; Email: string; Source: string; Category: string };
type Recipient = { email: string; name: string | null; variableOverrides: Record<string, string> };

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...rest] = rows.filter((r) => r.some((c) => c.trim()));
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])) as Row);
}

/** "Hi Dana," / "Hi," — never "Hi ," and never the email handle. */
function greetingFor(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw || raw.includes("@")) return "Hi,";
  const first = raw.split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hi,";
}

const db = createAdminClient();
const rows = parseCsv(readFileSync(CSV, "utf8"));

// ── Live org status ──────────────────────────────────────────────────────
const { data: orgs, error: orgErr } = await db
  .from("organizations")
  .select("id, name, type, membership_status")
  .is("archived_at", null)
  .or("is_test.is.null,is_test.eq.false");
if (orgErr) throw new Error(`orgs: ${orgErr.message}`);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const byNorm = new Map((orgs ?? []).map((o) => [norm(o.name), o]));
const ACTIVE = new Set(["active", "reactivated"]);

// ── The named lists ARE the rate assignment ──────────────────────────────
const { data: offers, error: offerErr } = await db
  .from("conference_entities")
  .select("id, name, kind, attributes")
  .eq("conference_id", CONF);
if (offerErr) throw new Error(`entities: ${offerErr.message}`);

function namedOrgIds(entityName: string): Set<string> {
  const e = (offers ?? []).find((x) => x.name === entityName);
  const raw = (e?.attributes as Record<string, unknown> | null)?.direct_purchase_org_ids;
  return new Set(Array.isArray(raw) ? raw.map(String) : []);
}
const opsNamed = namedOrgIds("Big Ideas Day — Operations Partner");
const pubNamed = namedOrgIds("Big Ideas Day — Publisher");
const presentNamed = namedOrgIds("Big Ideas Presentations");
if (!opsNamed.size || !pubNamed.size) {
  throw new Error("named lists empty — refusing to guess a rate from the CSV category");
}

// ── Who already holds a booth (the room is included) ─────────────────────
const { data: balances, error: balErr } = await db
  .from("entity_balances")
  .select("organization_id, entity_id, conference_entities!inner(kind)")
  .eq("conference_id", CONF)
  .gt("quantity", 0);
if (balErr) throw new Error(`balances: ${balErr.message}`);
const holdsBooth = new Set(
  (balances ?? [])
    .filter((b) => {
      const e = Array.isArray(b.conference_entities) ? b.conference_entities[0] : b.conference_entities;
      return e?.kind === "booth";
    })
    .map((b) => b.organization_id)
    .filter(Boolean) as string[]
);

const BIG_IDEAS_REGISTRATIONS = ["Big Ideas Day — Operations Partner", "Big Ideas Day — Publisher"];
const bigIdeasEntityIds = new Set(
  (offers ?? []).filter((e) => BIG_IDEAS_REGISTRATIONS.includes(e.name)).map((e) => e.id)
);
const alreadyIn = new Set(
  (balances ?? [])
    .filter((b) => b.entity_id && bigIdeasEntityIds.has(b.entity_id) && b.organization_id)
    .map((b) => b.organization_id as string)
);

/** Current partners only. Returns null when the org is not on any named list. */
function partnerVariant(orgId: string): Variant | null {
  // ⛔ Checked FIRST. Anyone who buys between build and send re-cohorts on the
  // next run, which is why this is a balance lookup and not a name list.
  if (alreadyIn.has(orgId)) return "ALREADY_IN";
  if (holdsBooth.has(orgId)) return "BOOTH_HOLDER";
  if (opsNamed.has(orgId)) return "OPS";
  if (pubNamed.has(orgId)) return "PUBLISHER";
  return null;
}

// ── Current-partner recipients: the org's own logins ─────────────────────
const partnerOrgIds = [...new Set([...opsNamed, ...pubNamed, ...presentNamed])].filter((id) => {
  const o = (orgs ?? []).find((x) => x.id === id);
  return o && o.type === "Vendor Partner" && ACTIVE.has(o.membership_status ?? "");
});

const { data: links, error: linkErr } = await db
  .from("user_organizations")
  .select("user_id, organization_id")
  .in("organization_id", partnerOrgIds)
  .eq("status", "active")
  .in("role", ["org_admin", "member"]);
if (linkErr) throw new Error(`user_organizations: ${linkErr.message}`);

const userIds = [...new Set((links ?? []).map((l) => l.user_id).filter(Boolean))] as string[];
const emails = await lookupUserEmailsByIds(db, userIds);

// Names from contacts, keyed per (person, org) — profiles.display_name holds
// the email handle for a large share of logins. Chunked: .in() past ~200 ids
// returns Bad Request, not rows.
const contactName = new Map<string, string>();
for (let i = 0; i < userIds.length; i += 150) {
  const { data: cs, error } = await db
    .from("contacts")
    .select("profile_id, organization_id, first_name, name")
    .in("profile_id", userIds.slice(i, i + 150));
  if (error) throw new Error(`contacts chunk ${i}: ${error.message}`);
  for (const c of cs ?? []) {
    const real = c.first_name?.trim() || c.name?.trim();
    if (c.profile_id && c.organization_id && real) contactName.set(`${c.profile_id}:${c.organization_id}`, real);
  }
}

const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));
const buckets: Record<Variant, Recipient[]> = {
  ALREADY_IN: [], OPS: [], PUBLISHER: [], BOOTH_HOLDER: [], RECONNECT_PUBLISHER: [], RECONNECT_TECH: [],
};
const seen = new Map<string, Variant>();
const provenance: Array<{ email: string; variant: Variant; org: string; via: string }> = [];

function add(variant: Variant, email: string, name: string | null, orgName: string, via: string) {
  const key = email.toLowerCase();
  if (EXCLUDED_EMAILS.has(key)) return;
  const already = seen.get(key);
  if (already) {
    if (already !== variant) {
      throw new Error(`${email} resolves to both ${already} and ${variant} — refusing to guess`);
    }
    return;
  }
  seen.set(key, variant);
  buckets[variant].push({
    email,
    name,
    variableOverrides: { greeting: greetingFor(name), org_name: orgName },
  });
  provenance.push({ email, variant, org: orgName, via });
}

// (a) every active login at a named partner org
for (const l of links ?? []) {
  if (!l.user_id || !l.organization_id) continue;
  const email = emails[l.user_id];
  const v = partnerVariant(l.organization_id);
  if (!email || !v) continue;
  add(v, email, contactName.get(`${l.user_id}:${l.organization_id}`) ?? null,
      orgById.get(l.organization_id)?.name ?? "", "login");
}

// (b) CSV rows. Current partners join their org's named-list variant; everyone
//     else is a reconnect, split by the CSV category because they have no
//     entitlement in the graph to read.
const unmatched = new Set<string>();
const lapsedWithOrg: string[] = [];
for (const r of rows) {
  if (!r.Email) continue;
  const org = byNorm.get(norm(ALIASES[r.Company] ?? r.Company));
  const isPublisher = r.Category.toLowerCase().startsWith("publisher");

  if (org && org.type === "Vendor Partner" && ACTIVE.has(org.membership_status ?? "")) {
    const v = partnerVariant(org.id);
    if (!v) throw new Error(`${org.name} is an active partner on no named list — Steve must place them`);
    add(v, r.Email, r.Contact || null, org.name, "csv");
    continue;
  }
  if (!org) unmatched.add(r.Company);
  else lapsedWithOrg.push(`${r.Company} -> ${org.name} (${org.membership_status ?? "?"}, ${org.type})`);
  add(isPublisher ? "RECONNECT_PUBLISHER" : "RECONNECT_TECH", r.Email, r.Contact || null, r.Company, "csv");
}

// ── Copy ─────────────────────────────────────────────────────────────────
const header = (): ContentBlock => ({
  id: "header", type: "image", src: HEADER, alt: "Conference Big Ideas Day", href: DAY, widthPercent: 100,
});
const gap = (id: string, h = 12): ContentBlock => ({ id, type: "spacer", height: h });
const text = (id: string, html: string): ContentBlock => ({ id, type: "text", html });
const cta = (id: string, label: string, href: string): ContentBlock => ({
  id, type: "button", text: label, href, align: "left", color: BRAND_RED,
});

const ROOM_OPEN = `<p><strong>On Thursday February 4 we're making a space for the members who deliver course materials.</strong> The book buyer, the manager who owns it, whoever at the institution has a real stake in getting it right. They'll be talking to each other about solutions. The gritty details.`;
const OPS_TAIL = ` The things that actually have to happen for this business to work.</p>`;
const PUB_TAIL = ` What it actually takes to get the right material into a student's hands at the start of term.</p>`;

const RECONNECT_OPEN = `<p><strong>At the Campus Stores Conference on February 4, 2027 we're hosting Big Ideas Day,</strong> a space for the members who deliver course materials. The book buyer, the manager who owns it, whoever at the institution has a real stake in getting it right. They'll be talking to each other about solutions. The gritty details.`;

/**
 * ⛔ Names info@ explicitly instead of saying "reply to this".
 *
 * Every campaign sends From `Campus Stores Canada <noreply@campusstores.ca>`
 * (lib/email/send.ts resolveFromAddress), and executeCampaignSend never sets
 * replyTo — BatchSendItem supports the field, but no campaign column feeds it.
 * So "reply to this" on the two emails that end by asking for a reply pointed
 * at noreply@. Naming the address in the copy fixes it with no code change.
 */
const REPLY_LINE =
  `<p><strong>Write to <a href="mailto:info@campusstores.ca">info@campusstores.ca</a> and we'll take it from there.</strong> We'd rather hear what you need than guess.</p>`;

const PITCH = text(
  "pitch",
  `<p><strong>If you want to put something in front of them directly,</strong> there are a handful of short sessions, and members choose them. Pitch a topic with a $250 deposit by Friday December 4. Member stores vote the following week on what they actually want to hear, we announce the picks straight after. If yours isn't one, the $250 comes back. The people voting are the people who buy from you, so getting picked tells you something no booth ever will.</p>`
);

const VARIANTS: Record<Variant, { label: string; subject: string; blocks: ContentBlock[] }> = {
  // ⛔ Writes to the reader, not to Steve. An earlier draft argued the
  // slot-vs-pitch distinction inside the email; Bookware knows nothing about
  // that conversation. State what is true and ask for the two things needed.
  ALREADY_IN: {
    label: "Big Ideas Day — already registered",
    subject: "You're in. Now tell us what you want to talk about.",
    blocks: [
      header(),
      gap("g0", 16),
      text("hi", "<p>{{greeting}}</p>"),
      text("thanks", "<p><strong>Thank you for being first in.</strong> {{org_name}} has a place at Big Ideas Day on Thursday February 4.</p>"),
      text("ask", "<p>Two things when you have a minute.</p>"),
      // ⛔ Both of these are self-serve and the copy says so. An earlier draft
      // said "email Steve", which is a non-answer: he cannot assign their seat
      // or write their pitch. Verified gates on origin/main —
      //   proposeTopic:  activeOrgIds.includes(org)  -> ANY active link, so
      //                  Julie (member) and Pete (org_admin) can both do it.
      //   allocateSeat:  canManageOrganization       -> org_admin ONLY, so Pete
      //                  can name the seat and Julie cannot. Hence naming Pete.
      text("topic", `<p><strong>What you'd put forward.</strong> You've paid for your pitch, so all that's left is the topic. Add it on the <a href="${DAY}">Big Ideas Day page</a> and it goes in front of member stores when they choose in December. Either of you can post it.</p>`),
      text("who", `<p><strong>Who's coming.</strong> Your place is for one person and there's no name against it yet. Pete can put a name to it from <a href="https://www.campusstores.ca/org/bookware">your Bookware page</a>. If you both want to be in the room, a second place is another $1,000 and you can add it the same way you bought the first.</p>`),
      cta("cta", "Add your topic", DAY),
    ],
  },
  OPS: {
    label: "Big Ideas Day — operations partner ($1,000)",
    subject: "Be in the room where it happens",
    blocks: [
      header(),
      gap("g0", 16),
      text("hi", "<p>{{greeting}}</p>"),
      text("room", ROOM_OPEN + OPS_TAIL),
      text("want", "<p><strong>We'd like you in that room.</strong></p>"),
      text("why", "<p><strong>Being part of that conversation isn't about placing another product.</strong> It's understanding what they're up against, and seeing where the solutions come from. That's hard to get from a booth and impossible to get from a call.</p>"),
      text("price", "<p><strong>It's $1,000, and you'd be there as a participant, not an exhibitor.</strong> Nothing to set up, no stand to manage. A seat and a conversation.</p>"),
      cta("cta", "Be in the room", DAY),
      gap("g1"),
      PITCH,
    ],
  },
  PUBLISHER: {
    label: "Big Ideas Day — publisher ($500)",
    subject: "Be in the room where it happens",
    blocks: [
      header(),
      gap("g0", 16),
      text("hi", "<p>{{greeting}}</p>"),
      text("room", ROOM_OPEN + PUB_TAIL),
      text("want", "<p><strong>We'd like you in that room.</strong></p>"),
      text("why", "<p><strong>Being part of that conversation isn't about placing another title.</strong> It's hearing, first hand, what makes you easy to adopt and where the opportunities are. That's hard to get from a booth and impossible to get from a call.</p>"),
      text("price", "<p><strong>It's $500, and you'd be there as a participant, not an exhibitor.</strong> Nothing to set up, no stand to manage. A seat and a conversation.</p>"),
      cta("cta", "Be in the room", DAY),
      gap("g1"),
      PITCH,
    ],
  },
  BOOTH_HOLDER: {
    label: "Big Ideas Day — booth holder (included)",
    subject: "You're already in the room on February 4",
    blocks: [
      header(),
      gap("g0", 16),
      text("hi", "<p>{{greeting}}</p>"),
      text("room", ROOM_OPEN + OPS_TAIL),
      text("included", "<p><strong>Your booth already includes that room, so there's nothing more to pay.</strong> It's worth knowing it's there.</p>"),
      text("why", "<p><strong>It's a different thing from the floor.</strong> On the floor people come to you with a question about your product. In here you get to hear what the problem actually is, before anyone has decided what the answer looks like.</p>"),
      text("frame", "<p><strong>This is an additional opportunity, not another thing to staff.</strong> Nothing to set up, no second place to be, just a seat at the table.</p>"),
      cta("cta", "See what's being discussed", DAY),
      gap("g1"),
      PITCH,
    ],
  },
  RECONNECT_PUBLISHER: {
    label: "Big Ideas Day reconnect — publisher ($500 + $600)",
    subject: "Be in the room where it happens",
    blocks: [
      header(),
      gap("g0", 16),
      text("hi", "<p>{{greeting}}</p>"),
      text("room", RECONNECT_OPEN + PUB_TAIL),
      text("gap", "<p><strong>It's been a while since we worked together, and we'd like you in that room.</strong></p>"),
      text("why", "<p><strong>Being part of that conversation isn't about placing another title.</strong> It's hearing, first hand, what makes you easy to adopt and where the opportunities are. That's hard to get from a booth and impossible to get from a call.</p>"),
      text("price", "<p><strong>The day is $500. Being a partner is $600 a year,</strong> and that's what gets you the rest of CSC, not just this one room.</p>"),
      cta("cta1", "What Big Ideas Day is", DAY),
      gap("g1", 8),
      cta("cta2", "See how CSC has changed", PARTNERSHIP),
      gap("g2"),
      text("reply", REPLY_LINE),
    ],
  },
  RECONNECT_TECH: {
    label: "Big Ideas Day reconnect — tech ($1,000 + $600)",
    subject: "Be in the room where it happens",
    blocks: [
      header(),
      gap("g0", 16),
      text("hi", "<p>{{greeting}}</p>"),
      text("room", RECONNECT_OPEN + OPS_TAIL),
      text("gap", "<p><strong>It's been a while since we worked together, and we'd like you in that room.</strong></p>"),
      text("why", "<p><strong>Being part of that conversation isn't about placing another product.</strong> It's understanding what they're up against, and seeing where the solutions come from. That's hard to get from a booth and impossible to get from a call.</p>"),
      text("price", "<p><strong>The day is $1,000. Being a partner is $600 a year,</strong> and that's what gets you the rest of CSC, not just this one room. It looks fairly different than it did the last time round, so it's worth a fresh look either way.</p>"),
      cta("cta1", "What Big Ideas Day is", DAY),
      gap("g1", 8),
      cta("cta2", "See what partnership looks like now", PARTNERSHIP),
      gap("g2"),
      text("reply", REPLY_LINE),
    ],
  },
};

// ── Report ───────────────────────────────────────────────────────────────
const ORDER: Variant[] = ["ALREADY_IN", "OPS", "PUBLISHER", "BOOTH_HOLDER", "RECONNECT_PUBLISHER", "RECONNECT_TECH"];
console.log("variant                       recipients  orgs");
for (const v of ORDER) {
  const orgCount = new Set(provenance.filter((p) => p.variant === v).map((p) => p.org)).size;
  console.log(`  ${v.padEnd(26)} ${String(buckets[v].length).padStart(5)}  ${String(orgCount).padStart(4)}  ${VARIANTS[v].label}`);
}
console.log(`  ${"TOTAL".padEnd(26)} ${String(ORDER.reduce((n, v) => n + buckets[v].length, 0)).padStart(5)}`);

console.log("\nRATE ASSIGNED BY NAMED LIST (not the CSV category):");
for (const v of ["ALREADY_IN", "OPS", "PUBLISHER", "BOOTH_HOLDER"] as const) {
  const byOrg = new Map<string, number>();
  for (const p of provenance.filter((x) => x.variant === v)) byOrg.set(p.org, (byOrg.get(p.org) ?? 0) + 1);
  for (const [org, n] of [...byOrg].sort()) console.log(`  ${v.padEnd(13)} ${org} (${n})`);
}

const csvOnly = provenance.filter((p) => p.via === "csv" && !p.variant.startsWith("RECONNECT"));
if (csvOnly.length) {
  console.log("\nCSV-named people at current partners, added on top of the org's logins:");
  for (const p of csvOnly) console.log(`  ${p.variant.padEnd(13)} ${p.email.padEnd(38)} ${p.org}`);
}

if (lapsedWithOrg.length) {
  console.log("\nLAPSED, has an org record — reconnect by status, not by absence:");
  for (const l of [...new Set(lapsedWithOrg)]) console.log(`  ${l}`);
}

console.log(`\n⚠️  ${unmatched.size} companies with NO org record, defaulted to reconnect by CSV category.`);
console.log("    Steve has seen this list. Confirm none is a current partner under another name:");
for (const c of [...unmatched].sort()) console.log(`      ${c}`);

const bareHi = provenance.filter((p) => buckets[p.variant].find((r) => r.email === p.email)?.variableOverrides.greeting === "Hi,");
console.log(`\n${bareHi.length} recipients greeted with a bare "Hi," (shared inboxes, no human named):`);
for (const p of bareHi) console.log(`      ${p.email.padEnd(38)} ${p.org}`);

// ⛔ renderTemplate replaces an unknown {{key}} with the EMPTY STRING. A missing
// greeting is therefore a blank line at the top of the email, not a visible
// placeholder anybody would catch in a preview. Refuse instead.
for (const v of ORDER) {
  for (const r of buckets[v]) {
    const g = r.variableOverrides.greeting;
    if (!g || !g.trim()) throw new Error(`${v}: ${r.email} has no greeting — would send a blank salutation`);
    if (g.includes("@")) throw new Error(`${v}: ${r.email} greeting contains an email handle: ${g}`);
    if (/\{\{/.test(JSON.stringify(r.variableOverrides))) throw new Error(`${v}: ${r.email} override holds a raw merge field`);
  }
}
const usedVars = new Set<string>();
for (const v of ORDER) {
  for (const b of VARIANTS[v].blocks) {
    const html = (b as { html?: string }).html ?? "";
    for (const m of html.matchAll(/\{\{(\w+)\}\}/g)) usedVars.add(m[1]);
  }
  for (const b of VARIANTS[v].blocks) {
    const href = (b as { href?: string }).href;
    if (href && !/^https:\/\/www\.campusstores\.(ca|events)\//.test(href)) {
      throw new Error(`${v}: button points somewhere unexpected: ${href}`);
    }
  }
}
const unsupplied = [...usedVars].filter((k) => ORDER.some((v) => buckets[v].some((r) => !(k in r.variableOverrides))));
if (unsupplied.length) throw new Error(`copy uses {{${unsupplied.join("}}, {{")}}} but not every recipient supplies it`);
console.log(`\n✅ merge fields used in copy: ${[...usedVars].join(", ")} — supplied for all ${ORDER.reduce((n, v) => n + buckets[v].length, 0)} recipients`);
console.log("✅ every button resolves to a campusstores.ca/.events https URL");

// ── --refresh: re-cohort an already-SCHEDULED send, in place ─────────────
//
// ⛔ Friday morning runs this, NOT --create. The six campaigns are `scheduled`,
// so --create would hit the not-a-draft guard and refuse; and if it did not
// refuse it would delete six scheduled campaigns and leave a window with
// nothing queued. This updates audience_definition only. Templates, status and
// scheduled_at are untouched, so the worst case is the audience it already had.
//
// What actually moves overnight: somebody buys a Big Ideas place (they leave
// OPS/PUBLISHER for ALREADY_IN), or a lapsed company rejoins (they leave a
// RECONNECT bucket). Both are silent and both would send the wrong email.
if (REFRESH) {
  const { data: init, error: iErr } = await db
    .from("comms_campaigns").select("id").eq("name", "Big Ideas Day — 2027");
  if (iErr) throw new Error(`initiative: ${iErr.message}`);
  if (init?.length !== 1) throw new Error(`expected 1 initiative, found ${init?.length ?? 0}`);

  const { data: cs, error: cErr } = await db
    .from("message_campaigns")
    .select("id, name, status, sent_at, template_id, audience_definition")
    .eq("campaign_id", init[0].id);
  if (cErr) throw new Error(`campaigns: ${cErr.message}`);

  const sent = (cs ?? []).filter((c) => c.sent_at || c.status === "sent");
  if (sent.length) throw new Error(`already sent, refusing to touch: ${sent.map((c) => c.name).join(", ")}`);

  let changed = 0;
  for (const v of ORDER) {
    const campaign = (cs ?? []).find((c) => c.name === VARIANTS[v].label);
    if (!campaign) throw new Error(`no campaign named "${VARIANTS[v].label}" — refusing to guess`);

    const before: string[] = (
      (campaign.audience_definition as { filters?: { recipients?: { email: string }[] } })?.filters?.recipients ?? []
    ).map((r) => r.email.toLowerCase()).sort();
    const after = buckets[v].map((r) => r.email.toLowerCase()).sort();

    if (JSON.stringify(before) === JSON.stringify(after)) {
      console.log(`  unchanged  ${String(after.length).padStart(3)}  ${VARIANTS[v].label}`);
      continue;
    }
    const gone = before.filter((e) => !after.includes(e));
    const added = after.filter((e) => !before.includes(e));
    console.log(`  CHANGED    ${String(after.length).padStart(3)}  ${VARIANTS[v].label}`);
    for (const e of gone) console.log(`               - ${e}`);
    for (const e of added) console.log(`               + ${e}`);

    if (!CREATE) { changed++; continue; }

    const { error: uErr } = await db
      .from("message_campaigns")
      .update({ audience_definition: { type: "custom_recipient_list", filters: { recipients: buckets[v] } } })
      .eq("id", campaign.id);
    if (uErr) throw new Error(`update ${VARIANTS[v].label}: ${uErr.message}`);
    changed++;
  }

  // ── Copy, same in-place rule as the audience ───────────────────────────
  // ⛔ The template is where the words live, so an audience-only refresh will
  // happily leave stale copy on a scheduled send. Recompile blocks through
  // updateTemplate (which runs renderBlocksToHtml) rather than rebuilding, for
  // the same reason: these campaigns are scheduled, not drafts.
  for (const v of ORDER) {
    const campaign = (cs ?? []).find((c) => c.name === VARIANTS[v].label);
    if (!campaign?.template_id) continue;
    const fresh = renderBlocksToHtml(VARIANTS[v].blocks);
    const { data: tpl } = await db
      .from("message_templates").select("body_html").eq("id", campaign.template_id).maybeSingle();
    if (tpl?.body_html === fresh) continue;
    console.log(`  COPY CHANGED   ${VARIANTS[v].label}`);
    if (!CREATE) { changed++; continue; }
    const res = await updateTemplate(campaign.template_id, {
      subject: VARIANTS[v].subject,
      bodyBlocks: VARIANTS[v].blocks as never,
    });
    if (!res.success) throw new Error(`template ${VARIANTS[v].label}: ${res.error}`);
    changed++;
  }

  console.log(changed ? `\n${changed} campaign(s) ${CREATE ? "updated" : "would change"}.` : "\nNothing moved overnight.");
  if (!CREATE) console.log("DRY RUN — add --create to write.");
  process.exit(0);
}

if (!CREATE) {
  console.log("\nDRY RUN — nothing written. Re-run with --create.");
  process.exit(0);
}

// ── Write ────────────────────────────────────────────────────────────────
// ── Replace a previous build, refusing if anything has left draft ────────
// Re-running without this leaves two sets of identical drafts in /admin/comms,
// and picking the wrong one is a send to a stale audience.
// ⛔ The initiative table is `comms_campaigns`, NOT `campaign_initiatives`.
// The wrong name here returned an error that was discarded by destructuring
// only `data`, so the replace silently no-opped and a second identical set of
// drafts was created. Check `error` on every read; a table that does not exist
// looks exactly like "nothing to replace".
const { data: prior, error: priorErr } = await db
  .from("comms_campaigns").select("id").eq("name", "Big Ideas Day — 2027");
if (priorErr) throw new Error(`prior lookup failed: ${priorErr.message}`);
for (const pi of prior ?? []) {
  const { data: cs, error: csErr } = await db
    .from("message_campaigns").select("id, name, status, sent_at, template_id").eq("campaign_id", pi.id);
  if (csErr) throw new Error(`prior campaigns failed: ${csErr.message}`);
  const live = (cs ?? []).filter((c) => c.status !== "draft" || c.sent_at);
  if (live.length) {
    throw new Error(`refusing to replace: ${live.map((c) => `${c.name} is ${c.status}`).join("; ")}`);
  }
  for (const c of cs ?? []) {
    await db.from("message_campaigns").delete().eq("id", c.id);
    if (c.template_id) await db.from("message_templates").delete().eq("id", c.template_id);
  }
  await db.from("comms_campaigns").delete().eq("id", pi.id);
  console.log(`replaced prior build ${pi.id} (${(cs ?? []).length} drafts removed)`);
}

const init = await createCampaignInitiative({
  name: "Big Ideas Day — 2027",
  goal: "Fill the February 4 room. Three sends to current partners at the rate their named list sets, two to lapsed course-materials companies with a rejoin door.",
});
if (!init.success || !init.id) throw new Error(`initiative failed: ${init.error}`);
console.log(`\ninitiative: ${init.id}`);

for (const v of ORDER) {
  if (!buckets[v].length) {
    console.log(`  ${v}: SKIPPED, no recipients`);
    continue;
  }
  const spec = VARIANTS[v];
  const tpl = await createTemplate({
    name: spec.label,
    description: `Big Ideas Day, ${v}. Audience baked at build time; rates from the named lists, not the CSV.`,
    category: "conference",
    subject: spec.subject,
    body_html: "",
    bodyBlocks: spec.blocks as never,
    campaignId: init.id,
    isTransactional: false,
  });
  if (!tpl.success || !tpl.id) throw new Error(`template ${v} failed: ${tpl.error}`);

  const res = await createCampaign({
    name: spec.label,
    templateId: tpl.id,
    audience: { type: "custom_recipient_list", filters: { recipients: buckets[v] } },
    campaignId: init.id,
  });
  if (!res.success) throw new Error(`campaign ${v} failed: ${res.error}`);
  console.log(`  ${v.padEnd(21)} template ${tpl.id}  campaign ${res.campaignId}  (${buckets[v].length} recipients, draft)`);
}

console.log("\nAll DRAFTS. Nothing scheduled, nothing sent.");
console.log("⚠️  Re-run the morning of the send: status moves, and a rejoin flips someone out of reconnect.");
