/**
 * Place everyone in one space and read off who is near whom.
 *
 *   npx tsx scripts/match-space.mts              # compute + report, writes nothing
 *   npx tsx scripts/match-space.mts --write      # also persist an UNPROMOTED run
 *   npx tsx scripts/match-space.mts --reembed    # ignore the vector cache
 *
 * ⛔ `--write` never promotes. A new run lands with status 'complete' and the
 * site keeps reading whatever is promoted until a human moves it. Nothing here
 * changes what a member sees.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { getCircleClient } from "@/lib/circle/client";
import { normalize } from "@/lib/signals/embedding";
import { redactContactDetails, countRedactions, isExcludedSpace } from "@/lib/signals/redact";
import { postBodyText } from "@/lib/signals/circle-backfill";
import {
  poolSignals, nearest, placementConfidence, calibrate, removeCommonDirection, rarityWeight,
  type SignalVector, type Placed,
} from "@/lib/match/space";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = "nomic-embed-text";
const VEC_CACHE = ".cache/space-vectors.json";
const WRITE = process.argv.includes("--write");
const REEMBED = process.argv.includes("--reembed");
const NOW = new Date();

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── what each entity has said ────────────────────────────────────────────────
// One "document" is one act with its own date. Declared text is undated on
// purpose: this site never timestamps a form, and treating undated as ancient
// would decay every member's own description to nothing.
interface Doc { owner: string; text: string; verb: "posted" | "preferred" | "commented" | "rsvped" | "opened" | "clicked"; at: Date | null; weight?: number }

const docs: Doc[] = [];
// ⛔ Redaction happens HERE, at the single door into the corpus. Doing it at
// each call site means the next source someone adds is the one that forgets —
// and a personal detail that reaches an embedding cannot be taken back out.
const redacted = { emails: 0, phones: 0 };
const add = (owner: string, text: string | null | undefined, verb: Doc["verb"], at: Date | null, weight?: number) => {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  if (raw.length <= 25) return;
  const found = countRedactions(raw);
  redacted.emails += found.emails;
  redacted.phones += found.phones;
  docs.push({ owner, text: redactContactDetails(raw).slice(0, 4000), verb, at, weight });
};

const { data: orgs, error: orgErr } = await db
  .from("organizations")
  .select("id,name,type,company_description,website_summary,primary_category,procurement_info")
  .in("type", ["Member", "Vendor Partner"])
  .is("archived_at", null)
  .neq("is_test", true);

if (orgErr) { console.error("organizations:", orgErr.message); process.exit(1); }
const orgType = new Map<string, string>();
const orgName = new Map<string, string>();
for (const o of orgs ?? []) {
  orgType.set(o.id, o.type as string);
  orgName.set(o.id, o.name as string);
  const pi = (o.procurement_info ?? {}) as Record<string, unknown>;
  // ⛔ Content only — the NAME is deliberately not part of the position.
  // "University of Calgary Bookstore" embeds to something, so an org with no
  // description would still get placed, near every other org whose name says
  // "university bookstore". That is a confident match made entirely of nothing.
  const content = [
    o.company_description,
    o.website_summary,
    o.primary_category,
    Array.isArray(pi.store_services) ? (pi.store_services as string[]).join(", ") : null,
    typeof pi.requirements_notes === "string" ? pi.requirements_notes : null,
  ].filter(Boolean).join(". ");
  add(`org:${o.id}`, content, "preferred", null);
}

// ⛔ No `.in()` over the org list here. 159 UUIDs is ~6KB of query string, which
// PostgREST answers with an empty result rather than an error — the filter looks
// applied and the table looks empty. Pull and filter in memory instead.
const { data: allContacts, error: contactErr } = await db
  .from("contacts")
  .select("id,name,role_title,organization_id,profile_id,email")
  .limit(5000);
if (contactErr) { console.error("contacts:", contactErr.message); process.exit(1); }
const contacts = (allContacts ?? []).filter((c) => orgType.has(c.organization_id as string));

const contactOrg = new Map<string, string>();
const contactName = new Map<string, string>();
const byDisplay = new Map<string, string>();
// ⚠️ profile_id is NOT unique on contacts — one login can hold several contact
// rows (per person, per org). A Map would silently keep the last one, so the
// value is a LIST and an event attaches to every row that login owns.
const byProfile = new Map<string, string[]>();
for (const c of contacts ?? []) {
  contactOrg.set(c.id, c.organization_id as string);
  contactName.set(c.id, c.name as string);
  byDisplay.set(`${c.name} · ${orgName.get(c.organization_id as string) ?? "?"}`, c.id);
  if (c.profile_id) byProfile.set(c.profile_id as string, [...(byProfile.get(c.profile_id as string) ?? []), c.id]);
  // A title is what a person is FOR. Short, but it is the only declared thing
  // most people have, and it is what separates a director from a coordinator.
  if (c.role_title) add(`person:${c.id}`, String(c.role_title), "preferred", null);
}

// ⛔ CSC's own voice is not procurement signal.
//
// Steve, on his 101 posts: "sorta worthless. I am a functionary... a human
// function of the outputs and inputs of the org." An announcement says what the
// association is doing, not what anybody buys. CSC is org type 'Staff', so it
// falls outside the Member/Vendor Partner filter above and its people never
// enter `byDisplay` — this counter exists so that stays TRUE BY MEASUREMENT
// rather than by a filter someone can quietly widen later.
let cscVoice = 0;
// Directors deliberating is the association reasoning about ITSELF — it says
// nothing about what any store buys. Counted so the exclusion is visible.
let governance = 0;

// Circle posts, attributed through the display string the corpus was built with.
let corpusPosts = 0, attributed = 0;
if (existsSync(".cache/circle-corpus.json")) {
  const corpus = JSON.parse(readFileSync(".cache/circle-corpus.json", "utf8")) as {
    kind: string; text: string; author?: string | null; at?: string | null; space?: string | null;
  }[];
  for (const d of corpus) {
    if (d.kind !== "post") continue;
    corpusPosts++;
    if (isExcludedSpace(d.space)) { governance++; continue; }
    if (d.author?.includes("Campus Stores Canada")) { cscVoice++; continue; }
    const cid = d.author ? byDisplay.get(d.author) : undefined;
    if (!cid) continue;
    attributed++;
    add(`person:${cid}`, d.text, "posted", d.at ? new Date(d.at) : null);
  }
}

// Circle comments — the half that carries the answers.
//
// ⚠️ A comment's author is nested (`user.id`); a post's is flat (`user_id`).
// That single difference left 0 of 2,850 comments attributed in the first pass.
// The bulk feed also dates every one, which posts in the old cache are not.
const { data: cmMaps } = await db
  .from("circle_member_mapping")
  .select("circle_member_id,contact_id")
  .not("contact_id", "is", null);
const memberToContact = new Map<number, string>(
  (cmMaps ?? []).map((m) => [Number(m.circle_member_id), m.contact_id as string])
);

let comments = 0, commentsAttributed = 0, commentsCsc = 0;
if (existsSync(".cache/circle-comments.json")) {
  const circle = getCircleClient();
  const userToContact = new Map<number, string>();
  if (circle) {
    // circle_member_mapping stores the MEMBER id; a comment carries the USER id.
    // Circle's own member list is the only bridge between the two id spaces.
    const emailMap = await circle.buildEmailMap();
    for (const mem of emailMap.values() as Iterable<{ id: number; user_id?: number }>) {
      const cid = memberToContact.get(mem.id);
      if (cid && mem.user_id != null) userToContact.set(mem.user_id, cid);
    }
  }

  const rows = JSON.parse(readFileSync(".cache/circle-comments.json", "utf8")) as {
    body: string; userId: number | null; userName: string | null;
    createdAt: string | null; likes: number; spaceName?: string | null;
  }[];
  for (const c of rows) {
    comments++;
    if (isExcludedSpace(c.spaceName)) { governance++; continue; }
    if (c.userName?.includes("Campus Stores Canada")) { commentsCsc++; continue; }
    const cid = c.userId != null ? userToContact.get(c.userId) : undefined;
    if (!cid || !contactOrg.has(cid)) continue;
    commentsAttributed++;
    // A reply people liked is a better answer than one nobody did. Strength of
    // the ACT — not a judgement about what it was about.
    add(`person:${cid}`, c.body, "commented", c.createdAt ? new Date(c.createdAt) : null,
        1 + Math.min(c.likes, 5) * 0.2);
  }
  cscVoice += commentsCsc;
}

// ── Showing up is a CHOSEN act ───────────────────────────────────────────────
//
// Everything above is what someone said. This is what they turned up for, which
// is a stronger claim and one nobody makes idly. The event's own title and
// description are the text; `starts_at` dates it, so a 2019 webinar decays away
// while last term's does not.
//
// ⚠️ Both feeds are single-valued — every RSVP is 'yes', every registration
// 'registered'. No row is ever written for someone who stayed away, so the
// negative has to be DERIVED from the invited population; see the block below.
const { data: eventRows } = await db
  .from("events")
  .select("id,title,description,starts_at");
const eventText = new Map<string, { text: string; at: Date | null }>();
for (const e of eventRows ?? []) {
  const text = [e.title, e.description].filter(Boolean).join(". ");
  eventText.set(e.id as string, { text, at: e.starts_at ? new Date(e.starts_at as string) : null });
}

// How many distinct people each event drew, so a webinar everyone attended can
// be down-weighted against one a handful chose.
const eventReach = new Map<string, Set<string>>();
const reach = (eid: string, cid: string) => {
  const set = eventReach.get(eid) ?? new Set<string>();
  set.add(cid);
  eventReach.set(eid, set);
};

let rsvps = 0, rsvpAttached = 0;
const { data: rsvpRows } = await db
  .from("circle_event_rsvp_cache")
  .select("event_id,circle_member_id");
const rsvpPairs: { cid: string; eid: string }[] = [];
for (const r of rsvpRows ?? []) {
  rsvps++;
  const cid = r.circle_member_id != null ? memberToContact.get(Number(r.circle_member_id)) : undefined;
  const eid = r.event_id as string | null;
  if (!cid || !eid || !eventText.has(eid) || !contactOrg.has(cid)) continue;
  rsvpPairs.push({ cid, eid });
  reach(eid, cid);
}

let regs = 0, regAttached = 0;
const { data: regRows } = await db
  .from("event_registrations")
  .select("event_id,user_id,status");
const regPairs: { cid: string; eid: string }[] = [];
for (const r of regRows ?? []) {
  regs++;
  const eid = r.event_id as string | null;
  const cids = r.user_id ? byProfile.get(r.user_id as string) : undefined;
  if (!eid || !eventText.has(eid) || !cids) continue;
  for (const cid of cids) {
    if (!contactOrg.has(cid)) continue;
    regPairs.push({ cid, eid });
    reach(eid, cid);
  }
}

// ⛔ Two passes on purpose: an act's rarity cannot be known until every act is
// counted. Weighting as we went would score the first attendee of an event as
// though they were its only one.
const audience = new Set([...rsvpPairs, ...regPairs].map((p) => p.cid)).size;
for (const { cid, eid } of rsvpPairs) {
  const ev = eventText.get(eid)!;
  add(`person:${cid}`, ev.text, "rsvped", ev.at, rarityWeight(eventReach.get(eid)!.size, audience));
  rsvpAttached++;
}
for (const { cid, eid } of regPairs) {
  const ev = eventText.get(eid)!;
  add(`person:${cid}`, ev.text, "rsvped", ev.at, rarityWeight(eventReach.get(eid)!.size, audience));
  regAttached++;
}

// ⛔ EVERYONE IS ALWAYS INVITED. Steve: "We don't know why you didn't attend an
// event, but we know you didn't."
//
// So a non-attendance is an OBSERVATION, not missing data — and an earlier
// comment here claiming absence might mean "not invited" was simply wrong. It is
// weak and its meaning is unknown, which is fine: we are not required to know
// what a signal means, only that it happened. It nudges the vector away and
// nothing here pretends to say why.
//
// ⚠️ Magnitude is deliberately a fraction of attending — Steve's "low value
// weighted signal". Turning up is a choice; not turning up has a hundred boring
// explanations.
const NON_ATTENDANCE = -0.2;
let skipped = 0;
const everyone = new Set([...rsvpPairs, ...regPairs].map((p) => p.cid));
for (const [eid, went] of eventReach) {
  const ev = eventText.get(eid)!;
  if (ev.text.length <= 25) continue;
  const w = rarityWeight(went.size, everyone.size);
  for (const cid of everyone) {
    if (went.has(cid)) continue;
    skipped++;
    add(`person:${cid}`, ev.text, "rsvped", ev.at, NON_ATTENDANCE * w);
  }
}
console.log(`invited-and-did-not-go: ${skipped} weak negative signals`);

// ── Email engagement ─────────────────────────────────────────────────────────
//
// ⚠️ The AUTHOR is CSC and the ACT is the member's. We exclude the association's
// own voice everywhere else, and this is not a contradiction: nobody is claiming
// the newsletter says what a member buys. What a member OPENED, and what they
// clicked through from, is theirs — the email's subject is simply the topic they
// engaged with. Steve: "we don't know why you opened an email 8 times, but it is
// probably an indication of something."
//
// ⛔ Historical sends carry nothing. Engagement tracking was blind until the
// Resend endpoint was enabled on 2026-09-02, so ~580 earlier deliveries have no
// opens and never will. Absence before that date is a broken pipe, not disinterest.
// ⛔ Resolve by the address the mail was SENT TO, not by login.
//
// `message_recipients.user_id` is NULL on every engaged delivery — a campaign is
// addressed to an email, and the login link is not populated on that path. This
// is not "email as an identity key": we are not inferring who someone is, we are
// reading back the address a message was delivered to.
//
// ⚠️ It is still ambiguous where an inbox is shared, and shared inboxes are known
// to exist here. An address matching several contact rows is REPORTED AND
// DROPPED rather than attributed to a guess — one open is one human, and we do
// not know which. ⛔ Never merge the rows to make the ambiguity go away.
const { data: deliveries } = await db
  .from("message_deliveries")
  .select("opened_at, open_count, first_clicked_at, click_count, " +
          "message_recipients!inner(contact_email), " +
          "message_campaigns!inner(name, subject_override, body_override, " +
          "message_templates(subject, body_html))");

// email → the contact rows holding it. Length > 1 means we cannot say who acted.
const byEmail = new Map<string, string[]>();
for (const c of contacts) {
  const addr = (c as { email?: string | null }).email?.trim().toLowerCase();
  if (addr) byEmail.set(addr, [...(byEmail.get(addr) ?? []), c.id as string]);
}

let engaged = 0, opens = 0, clicks = 0, sharedInbox = 0;
const campaignReach = new Map<string, Set<string>>();
type Engagement = { cid: string; text: string; at: Date | null; verb: "opened" | "clicked"; count: number; key: string };
const engagements: Engagement[] = [];

for (const d of (deliveries ?? []) as unknown as Record<string, any>[]) {
  const openedAt = d.opened_at as string | null;
  const clickedAt = d.first_clicked_at as string | null;
  if (!openedAt && !clickedAt) continue;

  const addr = (d.message_recipients?.contact_email as string | null)?.trim().toLowerCase();
  const cids = addr ? byEmail.get(addr) : undefined;
  if (!cids?.length) continue;
  if (cids.length > 1) { sharedInbox++; continue; }

  const c = d.message_campaigns ?? {};
  const t = c.message_templates ?? {};
  const text = [c.subject_override || t.subject, c.name, postBodyText(c.body_override || t.body_html || "")]
    .filter(Boolean).join(". ");
  if (text.length <= 25) continue;

  const key = String(c.name ?? "");
  for (const cid of cids) {
    if (!contactOrg.has(cid)) continue;
    const set = campaignReach.get(key) ?? new Set<string>();
    set.add(cid);
    campaignReach.set(key, set);

    // ⛔ A click is a different act from an open, not a bigger one — they went
    // somewhere. Both are recorded; the verb profiles decide their weight and
    // half-life, which is not a judgement made here.
    if (openedAt) engagements.push({ cid, text, at: new Date(openedAt), verb: "opened", count: Number(d.open_count ?? 1), key });
    if (clickedAt) engagements.push({ cid, text, at: new Date(clickedAt), verb: "clicked", count: Number(d.click_count ?? 1), key });
  }
}

// ⛔ Second pass — a campaign's rarity is unknown until every delivery is
// counted. A newsletter the whole association opened separates nobody.
const mailAudience = new Set(engagements.map((e) => e.cid)).size;
for (const e of engagements) {
  // Repeat opens are repeat ACTS. Capped, because the twentieth open of the same
  // mail is a mail client refetching images, not twenty decisions.
  const repeat = 1 + Math.min(Math.max(e.count, 1) - 1, 4) * 0.25;
  add(`person:${e.cid}`, e.text, e.verb, e.at, repeat * rarityWeight(campaignReach.get(e.key)!.size, mailAudience));
  engaged++;
  if (e.verb === "opened") opens++; else clicks++;
}
console.log(`email engagement: ${engaged} acts (${opens} opens, ${clicks} clicks) across ${campaignReach.size} campaigns` +
  (sharedInbox ? ` · ${sharedInbox} dropped: shared inbox, cannot say who acted` : ""));

console.log(`events ${eventText.size}, with text ${[...eventText.values()].filter((e) => e.text.length > 25).length}`);
console.log(`rsvps ${rsvps}, attached ${rsvpAttached} · registrations ${regs}, attached ${regAttached}`);

console.log(`documents ${docs.length} · orgs ${orgType.size} · contacts ${contactOrg.size}`);
console.log(`circle posts    ${corpusPosts}, attributed ${attributed}`);
console.log(`circle comments ${comments}, attributed ${commentsAttributed}`);
console.log(`CSC's own voice excluded: ${cscVoice} documents`);
console.log(`governance spaces excluded: ${governance} documents`);
console.log(`redacted before embedding: ${redacted.emails} emails, ${redacted.phones} phone numbers`);

// ── embed ────────────────────────────────────────────────────────────────────
async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).embeddings as number[][];
}

let vectors: number[][];
if (!REEMBED && existsSync(VEC_CACHE)) {
  const cached = JSON.parse(readFileSync(VEC_CACHE, "utf8")) as { n: number; vectors: number[][] };
  if (cached.n === docs.length) { vectors = cached.vectors; console.log(`${vectors.length} vectors from cache`); }
  else { vectors = []; }
} else vectors = [];

if (vectors.length !== docs.length) {
  // ⛔ Embed each distinct TEXT once. One event's description is attached to
  // every person who attended it and every person who did not, so the corpus
  // holds tens of thousands of documents over a few dozen unique strings.
  // Embedding per-document would spend hours re-deriving the same vector.
  const uniqueTexts: string[] = [];
  const indexOfText = new Map<string, number>();
  for (const d of docs) {
    if (!indexOfText.has(d.text)) { indexOfText.set(d.text, uniqueTexts.length); uniqueTexts.push(d.text); }
  }
  console.log(`embedding ${uniqueTexts.length} distinct texts for ${docs.length} documents`);

  const unique: number[][] = [];
  for (let i = 0; i < uniqueTexts.length; i += 32) {
    unique.push(...(await embed(uniqueTexts.slice(i, i + 32))).map(normalize));
    process.stdout.write(`\r  embedded ${unique.length}/${uniqueTexts.length}`);
  }
  console.log();
  vectors = docs.map((d) => unique[indexOfText.get(d.text)!]);
  mkdirSync(".cache", { recursive: true });
  writeFileSync(VEC_CACHE, JSON.stringify({ n: docs.length, vectors }));
}

// ── place ────────────────────────────────────────────────────────────────────
const byOwner = new Map<string, SignalVector[]>();
docs.forEach((d, i) => {
  const list = byOwner.get(d.owner) ?? [];
  list.push({ vector: vectors[i], verb: d.verb, occurredAt: d.at, weight: d.weight });
  byOwner.set(d.owner, list);
});

const placed = new Map<string, Placed>();
for (const [owner, sigs] of byOwner) {
  const p = poolSignals(sigs, { now: NOW });
  if (p) placed.set(owner, { id: owner, ...p });
}

// ⚠️ Centre over the WHOLE population before comparing anything. Uncentred, one
// partner sat closest to the average of everything and took the #1 slot for 65
// of 240 people — the space was reporting genericness as fit.
const centred = removeCommonDirection([...placed.values()]);

const memberPeople: Placed[] = [], partnerOrgs: Placed[] = [], memberOrgs: Placed[] = [];
for (const p of centred) {
  const id = p.id;
  if (id.startsWith("org:")) {
    const t = orgType.get(id.slice(4));
    if (t === "Vendor Partner") partnerOrgs.push(p);
    else if (t === "Member") memberOrgs.push(p);
  } else {
    const org = contactOrg.get(id.slice(7));
    if (org && orgType.get(org) === "Member") memberPeople.push(p);
  }
}
console.log(`placed: ${memberPeople.length} member people · ${memberOrgs.length} member orgs · ${partnerOrgs.length} partner orgs`);

// ── read off who is near whom ────────────────────────────────────────────────
const label = (id: string) =>
  id.startsWith("org:") ? (orgName.get(id.slice(4)) ?? id)
  : `${contactName.get(id.slice(7)) ?? "?"} (${orgName.get(contactOrg.get(id.slice(7)) ?? "") ?? "?"})`;

const rows: { subject: string; candidate: string; sim: number; score: number; conf: number }[] = [];
for (const subj of [...memberPeople, ...memberOrgs]) {
  for (const n of nearest(subj, partnerOrgs, { k: 25 })) {
    rows.push({ subject: subj.id, candidate: n.id, sim: n.similarity, score: 0,
                conf: placementConfidence(subj) });
  }
}
// Scale to this run's own spread rather than a band fitted to a previous one.
const scale = calibrate(rows.map((r) => r.sim));
for (const r of rows) r.score = scale(r.sim);

const sims = rows.map((r) => r.sim).sort((a, b) => a - b);
const q = (p: number) => sims[Math.floor(sims.length * p)] ?? 0;
console.log(`\npairs ${rows.length}`);
console.log(`similarity  min ${q(0).toFixed(3)}  p25 ${q(.25).toFixed(3)}  median ${q(.5).toFixed(3)}  p75 ${q(.75).toFixed(3)}  max ${q(.999).toFixed(3)}`);
console.log(`distinct scores (2dp): ${new Set(rows.map((r) => r.score.toFixed(2))).size} of ${rows.length}`);

// ⛔ Dedupe on DISPLAY, never by merging the contacts.
//
// `contacts` is per (person, org) and the same human legitimately holds several
// rows — Dianne Salopek has three at Sheridan — so "Dianne → Resero" printed
// three times. A shared name is not evidence of one record: merging identities
// is forbidden, and collapsing them here is a rendering decision, not a write.
// ⚠️ The cost is real and worth stating: her signal is split across three
// vectors, so she is placed three times from a third of her evidence each. That
// is a data question for a human, not something a matcher may quietly fix.
console.log(`\ntop person → partner pairings:`);
const shown = new Set<string>();
for (const r of [...rows].filter((x) => x.subject.startsWith("person:")).sort((a, b) => b.sim - a.sim)) {
  const key = `${label(r.subject)}→${label(r.candidate)}`;
  if (shown.has(key)) continue;
  shown.add(key);
  console.log(`  ${r.sim.toFixed(3)}  ${label(r.subject)}  →  ${label(r.candidate)}`);
  if (shown.size >= 15) break;
}
const dupPeople = new Map<string, number>();
for (const p of memberPeople) dupPeople.set(label(p.id), (dupPeople.get(label(p.id)) ?? 0) + 1);
const split = [...dupPeople.values()].filter((n) => n > 1).length;
if (split) console.log(`\n⚠️  ${split} people hold more than one contact row — their signal is split across them`);

if (WRITE) {
  const { data: run, error } = await db.from("match_runs").insert({
    started_at: NOW.toISOString(), completed_at: new Date().toISOString(),
    status: "complete", embedding_model: MODEL, resolver_version: "space-v1",
    counts: { docs: docs.length, placed: placed.size, pairs: rows.length },
    notes: "embedding space — unpromoted",
  }).select("id").single();
  if (error) { console.error("run insert failed:", error.message); process.exit(1); }

  const edges = rows.map((r) => ({
    run_id: run!.id, direction: "member_to_partner",
    subject_org_id: r.subject.startsWith("org:") ? r.subject.slice(4) : contactOrg.get(r.subject.slice(7)),
    subject_contact_id: r.subject.startsWith("person:") ? r.subject.slice(7) : null,
    candidate_org_id: r.candidate.slice(4),
    total: Number(r.score.toFixed(2)), score: Number(r.score.toFixed(2)),
    confidence: Number(r.conf.toFixed(4)), rank: 0,
    breakdown: { similarity: Number(r.sim.toFixed(6)) }, reasons: [],
  }));
  for (let i = 0; i < edges.length; i += 500) {
    const { error: e } = await db.from("match_edges").insert(edges.slice(i, i + 500));
    if (e) { console.error("edge insert failed:", e.message); process.exit(1); }
  }
  console.log(`\nwrote run ${run!.id.slice(0, 8)} — ${edges.length} edges, NOT promoted`);
}

// ── hub check ────────────────────────────────────────────────────────────────
// A vector near everything is a vector that means nothing. If one partner takes
// the top slot for most subjects, the space is reporting genericness, not fit.
const topOf = new Map<string, string>();
for (const r of rows) {
  const cur = topOf.get(r.subject);
  if (!cur || r.sim > rows.find((x) => x.subject === r.subject && x.candidate === cur)!.sim) {
    topOf.set(r.subject, r.candidate);
  }
}
const hubs = new Map<string, number>();
for (const c of topOf.values()) hubs.set(c, (hubs.get(c) ?? 0) + 1);
const ranked = [...hubs.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\ndistinct partners taking a #1 slot: ${ranked.length} of ${partnerOrgs.length}`);
console.log(`most common #1s:`);
for (const [id, n] of ranked.slice(0, 6)) {
  console.log(`  ${String(n).padStart(3)} / ${topOf.size}  ${label(id)}`);
}
