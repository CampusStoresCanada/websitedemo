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
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getCircleClient } from "@/lib/circle/client";
import { normalize } from "@/lib/signals/embedding";
import { redactContactDetails, countRedactions, isExcludedSpace } from "@/lib/signals/redact";
import { postBodyText } from "@/lib/signals/circle-backfill";
import {
  poolSignals, nearest, placementConfidence, calibrate, rarityWeight,
  bestMatchingAct, removeCommonDirection,
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

// ── Vectors, cached by CONTENT ───────────────────────────────────────────────
//
// ⛔ The cache is keyed on a hash of each text, never on the corpus's shape. An
// earlier version keyed the whole file on `docs.length`: add one comment and
// delete another, the count matches, and EVERY vector is silently reused against
// the wrong document. A reorder did the same. Nothing errors — the run just
// quietly describes a world that never existed.
//
// Content addressing also makes this genuinely incremental, which is the point:
// only text nobody has embedded before ever reaches the model, however much else
// moved around it.
type VectorCache = { model: string; vectors: Record<string, number[]> };

const textKey = (text: string) => createHash("sha1").update(text).digest("hex");

let cache: VectorCache = { model: MODEL, vectors: {} };
if (!REEMBED && existsSync(VEC_CACHE)) {
  try {
    const loaded = JSON.parse(readFileSync(VEC_CACHE, "utf8")) as Partial<VectorCache>;
    // ⚠️ A cache built by a different model is not a cache, it is a trap:
    // its vectors are incomparable with anything this run produces.
    if (loaded.model === MODEL && loaded.vectors) cache = loaded as VectorCache;
    else console.log("cache was built by a different model — re-embedding");
  } catch {
    console.log("cache unreadable — re-embedding");
  }
}

// ⛔ Embed each distinct TEXT once. One event's description attaches to everyone
// who attended it and everyone who did not, so the corpus holds tens of
// thousands of documents over a few thousand unique strings.
const distinct = new Map<string, string>(); // key → text
for (const d of docs) distinct.set(textKey(d.text), d.text);

const missing = [...distinct.entries()].filter(([key]) => !cache.vectors[key]);
console.log(
  `${distinct.size} distinct texts for ${docs.length} documents · ` +
  `${distinct.size - missing.length} cached, ${missing.length} to embed`
);

if (missing.length > 0) {
  for (let i = 0; i < missing.length; i += 32) {
    const batch = missing.slice(i, i + 32);
    const fresh = (await embed(batch.map(([, text]) => text))).map(normalize);
    batch.forEach(([key], j) => { cache.vectors[key] = fresh[j]; });
    process.stdout.write(`\r  embedded ${Math.min(i + 32, missing.length)}/${missing.length}`);
  }
  console.log();

  // ⚠️ Prune anything the corpus no longer contains, or the cache grows without
  // bound as posts are edited and old wordings linger forever.
  const live = new Set(distinct.keys());
  for (const key of Object.keys(cache.vectors)) if (!live.has(key)) delete cache.vectors[key];

  mkdirSync(".cache", { recursive: true });
  writeFileSync(VEC_CACHE, JSON.stringify(cache));
}

const vectors: number[][] = docs.map((d) => cache.vectors[textKey(d.text)]);

// ── place ────────────────────────────────────────────────────────────────────
//
// ⛔ Centre the ACTS, not the pooled positions. Projection is linear, so pooling
// centred acts lands in the same place as centring the pooled result — but doing
// it here leaves individual acts in the SAME space as the positions, which is
// what makes a best-act score comparable to a pooled one. Uncentred, every act
// in this corpus scores ~0.6 against every partner, because it is all
// campus-store text.
const centredVectors = vectors; // ⚠️ see below — act-level centring was tested and reverted

const byOwner = new Map<string, SignalVector[]>();
const actsOf = new Map<string, { vector: number[]; text: string }[]>();
docs.forEach((d, i) => {
  const list = byOwner.get(d.owner) ?? [];
  list.push({ vector: centredVectors[i], verb: d.verb, occurredAt: d.at, weight: d.weight });
  byOwner.set(d.owner, list);
  // Kept alongside so the winning act can be quoted back as the REASON.
  const acts = actsOf.get(d.owner) ?? [];
  acts.push({ vector: centredVectors[i], text: d.text });
  actsOf.set(d.owner, acts);
});

const placed = new Map<string, Placed>();
for (const [owner, sigs] of byOwner) {
  const p = poolSignals(sigs, { now: NOW });
  if (p) placed.set(owner, { id: owner, ...p });
}

// ⚠️ Centre over the WHOLE population before comparing anything. Uncentred, one
// partner sat closest to the average of everything and took the #1 slot for 65
// of 240 people — the space was reporting genericness as fit.
// ⛔ A STORE IS ITS PEOPLE.
//
// Only 4 of 79 member orgs ever wrote a description, so placing orgs from their
// own text placed almost none of them — while 280 of their PEOPLE placed fine,
// because people write posts even when their store never filled in a form. The
// site reads org-level rows, so the engine was person-rich and unusable.
//
// A store's position is therefore pooled from the acts of everyone who works
// there, and only falls back to its own description when nobody there has said
// anything. That is also the truer statement: what a store buys is what its
// buyers do, not what somebody once typed into a profile field.
//
// ⚠️ Pooled BEFORE centring, so the store sits in the same space as everyone
// else. Pooling centred vectors would average away the very direction that
// centring exists to expose.
const peopleByOrg = new Map<string, SignalVector[]>();
for (const [owner, sigs] of byOwner) {
  if (!owner.startsWith("person:")) continue;
  const org = contactOrg.get(owner.slice(7));
  if (!org || orgType.get(org) !== "Member") continue;
  peopleByOrg.set(org, [...(peopleByOrg.get(org) ?? []), ...sigs]);
}

let orgsFromPeople = 0;
for (const [org, sigs] of peopleByOrg) {
  const pooled = poolSignals(sigs, { now: NOW });
  if (!pooled) continue;
  const key = `org:${org}`;
  // Their own description wins if they wrote one — it is a deliberate statement
  // about themselves, and this is only standing in for its absence.
  if (!placed.has(key)) orgsFromPeople++;
  if (!placed.has(key)) placed.set(key, { id: key, ...pooled });
}
console.log(`member orgs placed from their people: ${orgsFromPeople}`);

// ⛔ Centre POSITIONS, not acts. Tested both against the one externally
// validated pair we have — Waterloo → RAINS, where Steve knew of a real
// relationship nobody had stated. Centring at act level demoted it from rank 1
// to rank 11 and every Waterloo person with it. The common direction computed
// over 8,887 individual acts is a different axis from the one over ~350 pooled
// positions, and removing it takes the consistency signal with it.
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
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const label = (id: string) =>
  id.startsWith("org:") ? (orgName.get(id.slice(4)) ?? id)
  : `${contactName.get(id.slice(7)) ?? "?"} (${orgName.get(contactOrg.get(id.slice(7)) ?? "") ?? "?"})`;

const rows: {
  subject: string; candidate: string; sim: number; score: number; conf: number;
  bestSim: number | null; bestText: string | null;
}[] = [];
for (const subj of [...memberPeople, ...memberOrgs]) {
  const acts = actsOf.get(subj.id) ?? [];
  for (const n of nearest(subj, partnerOrgs, { k: 25 })) {
    const candidate = partnerOrgs.find((p) => p.id === n.id)!;
    // ⛔ The single strongest thing they said about this candidate — the number
    // AND the sentence. Waterloo's pooled position reaches 0.27 against RAINS
    // while Ana's post about Roots reaches 0.6: the evidence was always there,
    // pooling just diluted it with staplers and chocolates.
    const best = bestMatchingAct(acts.map((a) => a.vector), candidate.vector);
    rows.push({
      subject: subj.id, candidate: n.id, sim: n.similarity, score: 0,
      conf: placementConfidence(subj),
      bestSim: best?.similarity ?? null,
      bestText: best ? acts[best.index].text.slice(0, 300) : null,
    });
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
const withBest = rows.filter((r) => r.bestSim !== null);
if (withBest.length) {
  const lift = withBest.filter((r) => (r.bestSim ?? 0) > r.sim).length;
  console.log(`\nbest-act beats the pooled position on ${lift} of ${withBest.length} pairs ` +
    `(median pooled ${median(withBest.map((r) => r.sim)).toFixed(3)}, ` +
    `median best-act ${median(withBest.map((r) => r.bestSim!)).toFixed(3)})`);
}

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

// ── Open questions → who could answer them ───────────────────────────────────
//
// The one surface where the whole loop closes on live data: the engine shows a
// list, an admin picks a subset, some of those reply. shown ⊇ chosen ⊇ replied,
// and each narrowing is a labelled fact.
//
// ⛔ THE WHOLE COMMUNITY, not just partners. Half the answers in "Ask the
// Partners" come from MEMBERS — Sandy Nemeth and Shannon Blackadder answering
// sourcing questions because they are the people who actually know. Steve:
// "there are experts on both sides of the transaction." Ranking only vendors
// throws away half the expertise in the room.
//
// ⚠️ Computed here, nightly, because the site cannot reach this model. An ask
// posted today is scored tonight and the tool has it tomorrow — which is the
// right trade for a surface used a handful of times a year, and it keeps member
// conversation on this machine rather than at an embedding vendor.
const ASK_SPACE = "Ask the Partners";
let asksConsidered: string[] = [];
const askRows: {
  ask_ref: string; run_id: string | null; candidate_org_id: string;
  candidate_contact_id: string | null; recommended: boolean;
  rank: number; similarity: number; reason: string | null;
  candidate_last_spoke_at: string | null; answered_this_ask: boolean;
}[] = [];

// ⛔ THE TOOL IS AN ACTIVATION ENGINE, NOT A Q&A MATCHER.
//
// Steve: "I'm taking people who aren't answering questions in Circle and forcing
// the email into their inbox telling them to go answer it. If they never sign in
// they never get the notification, if they never get the notification they never
// get curious about what we're doing as a group. I'm using that space as a
// carrot — here's the sale, go get it."
//
// So the question is two-fold: WHO IS BEST ABLE TO ANSWER THIS, WHO IS NOT
// ALREADY ANSWERING IN CIRCLE. An already-active candidate is a wasted send —
// they would have seen the ask anyway. Ranking on relevance alone put a member
// who posts constantly at rank 1, which is the clearest possible failure.
//
// 70 of 80 partner orgs have NEVER posted or commented. That silence is the
// product, not a data gap.
//
// ⚠️ Recorded as FACTS — when they last spoke, whether they already answered
// this one — never as a score adjustment. Dormancy is a filter and relevance is
// the rank, the same split as blackouts and the spotlight. Baking silence into
// the similarity would make "they are quiet" indistinguishable from "they are a
// good fit", and the surface could never explain which it was reacting to.
const lastSpoke = new Map<string, Date>();
const noteVoice = (who: string | null | undefined, at: string | null | undefined) => {
  if (!who) return;
  const cid = byDisplay.get(who) ?? [...contactName.entries()].find(([, n]) => n === who)?.[0];
  if (!cid) return;
  const when = at ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) return;
  const prev = lastSpoke.get(cid);
  if (!prev || when > prev) lastSpoke.set(cid, when);
};

if (WRITE && existsSync(".cache/circle-corpus.json")) {
  const corpus = JSON.parse(readFileSync(".cache/circle-corpus.json", "utf8")) as {
    kind: string; text: string; postId?: string | number | null; space?: string | null;
  }[];
  const asks = corpus.filter((d) => d.kind === "post" && d.space === ASK_SPACE && d.postId);

  // Everyone who could answer: partner orgs AND member people. An org answers
  // through a person, so member candidates are person-grain — "ask Sandy", not
  // "ask the University of Manitoba".
  const answerers: Placed[] = [...partnerOrgs, ...memberPeople];

  // Who has spoken, and when — from the same corpora the space is built from.
  for (const d of corpus) {
    if (d.kind === "post") noteVoice((d as { author?: string | null }).author, (d as { at?: string | null }).at);
  }
  if (existsSync(".cache/circle-comments.json")) {
    for (const c of JSON.parse(readFileSync(".cache/circle-comments.json", "utf8")) as
         { userName?: string | null; createdAt?: string | null; postId?: number | string | null }[]) {
      noteVoice(c.userName, c.createdAt);
    }
  }

  // Who already replied to each ask — emailing them "go answer this" is noise.
  const answeredAsk = new Set<string>();
  if (existsSync(".cache/circle-comments.json")) {
    for (const c of JSON.parse(readFileSync(".cache/circle-comments.json", "utf8")) as
         { userName?: string | null; postId?: number | string | null }[]) {
      const cid = c.userName ? [...contactName.entries()].find(([, n]) => n === c.userName)?.[0] : null;
      if (cid && c.postId) answeredAsk.add(`${c.postId}\u001f${cid}`);
    }
  }

  for (const ask of asks) {
    const key = textKey(redactContactDetails(ask.text.replace(/\s+/g, " ").trim()).slice(0, 4000));
    const vector = cache.vectors[key];
    // An ask too short to have been embedded has no position and gets no list —
    // better than a list built from nothing.
    if (!vector) continue;

    const placedAsk: Placed = { id: `ask:${ask.postId}`, vector, contributing: 1, mass: 1 };
    for (const n of nearest(placedAsk, answerers, { k: 12 })) {
      const isPerson = n.id.startsWith("person:");
      const contactId = isPerson ? n.id.slice(7) : null;
      const orgId = isPerson ? contactOrg.get(n.id.slice(7))! : n.id.slice(4);
      const acts = actsOf.get(n.id) ?? [];
      const best = bestMatchingAct(acts.map((a) => a.vector), vector);
      askRows.push({
        ask_ref: String(ask.postId), run_id: null,
        candidate_org_id: orgId, candidate_contact_id: contactId,
        recommended: true,
        rank: askRows.filter((r) => r.ask_ref === String(ask.postId)).length + 1,
        similarity: Number(n.similarity.toFixed(6)),
        reason: best ? acts[best.index].text.slice(0, 300) : null,
        candidate_last_spoke_at: contactId ? (lastSpoke.get(contactId)?.toISOString() ?? null) : null,
        answered_this_ask: contactId ? answeredAsk.has(`${ask.postId}\u001f${contactId}`) : false,
      });
    }
  }
  // ⛔ Which asks were LOOKED AT, recorded as a fact of this run.
  //
  // Three of eight asks score to zero candidates. Without this list, a reader
  // cannot tell "the run has not reached this ask" from "the run considered it
  // and nobody matched" — both are simply an absence of rows — and the screen
  // then tells an operator to wait overnight for a list that already exists and
  // is empty. Derived at read time it would be a guess about what a job did;
  // written here it is the job's own account.
  asksConsidered = asks.map((a) => String(a.postId));
  console.log(
    `asks scored: ${asks.length}, with candidates: ` +
      `${new Set(askRows.map((r) => r.ask_ref)).size}, rows: ${askRows.length}`
  );
}

if (WRITE) {
  // ⛔ Claim the run BEFORE doing the work, not after.
  //
  // Writing only on success means a crash leaves no row at all — and "the Mac
  // started and died" then looks exactly like "the Mac never woke up". Those
  // have different fixes, so the watchdog on Vercel has to be able to tell them
  // apart. A row with no `completed_at` is the evidence that something tried.
  const { data: run, error } = await db.from("match_runs").insert({
    started_at: NOW.toISOString(), completed_at: null,
    status: "running", embedding_model: MODEL, resolver_version: "space-v1",
    // ⛔ `weights` is NOT NULL, and this engine HAS no per-axis weights — that
    // is the whole point of it. Rather than write `{}` and let a reader assume
    // the weights were lost, record what the run actually did: the shape of the
    // computation, so a future run can be compared against this one.
    weights: {
      engine: "embedding-space",
      model: MODEL,
      centred: true,
      calibration: "per-run percentile",
      note: "no named axes and no typed weights — see lib/match/space.ts",
    },
    counts: {
      docs: docs.length, placed: placed.size, pairs: rows.length,
      // Read by lib/comms/ask-candidates.ts to answer "have we looked at this
      // ask?" independently of whether it produced anybody.
      asksConsidered,
    },
    notes: "embedding space — unpromoted",
  }).select("id").single();
  if (error) { console.error("run insert failed:", error.message); process.exit(1); }

  // ⛔ `rank` is 1-based WITHIN each subject, ordered by raw similarity.
  //
  // An earlier version wrote 0 for every row. `readMatchEdges` orders by this
  // column, so every consumer was silently handed edges in whatever order the
  // database returned them — a ranked list that was not ranked, with nothing to
  // indicate it.
  //
  // ⚠️ Ordered by SIMILARITY, not by `total`. `total` is a percentile across ALL
  // pairs in the run, so one member's whole shortlist sits in the 98th–100th and
  // is nearly flat: the top ten of a real member span 1.3 points out of 100.
  // Similarity keeps its spread and is the only honest within-subject ordering.
  const bySubjectRank = new Map<string, number>();
  const ranked = [...rows].sort((a, b) => b.sim - a.sim);
  const rankOf = new Map<string, number>();
  for (const r of ranked) {
    const next = (bySubjectRank.get(r.subject) ?? 0) + 1;
    bySubjectRank.set(r.subject, next);
    rankOf.set(`${r.subject}\u001f${r.candidate}`, next);
  }

  const edges = rows.map((r) => ({
    run_id: run!.id, direction: "member_to_partner",
    subject_org_id: r.subject.startsWith("org:") ? r.subject.slice(4) : contactOrg.get(r.subject.slice(7)),
    subject_contact_id: r.subject.startsWith("person:") ? r.subject.slice(7) : null,
    candidate_org_id: r.candidate.slice(4),
    total: Number(r.score.toFixed(2)), score: Number(r.score.toFixed(2)),
    confidence: Number(r.conf.toFixed(4)),
    rank: rankOf.get(`${r.subject}\u001f${r.candidate}`) ?? 0,
    breakdown: {
      similarity: Number(r.sim.toFixed(6)),
      bestActSimilarity: r.bestSim === null ? null : Number(r.bestSim.toFixed(6)),
    },
    // ⛔ The reason is the ACT, quoted. "Waterloo → RAINS" is a number;
    // "because Ana said their Roots sales fell 25%" is something a human can use.
    reasons: r.bestText
      ? [{ kind: "observed", axis: "semantic", text: r.bestText, evidence: [],
           supports: true, sourceOrgId: null, sourceVisibility: "unset" }]
      : [],
  }));
  for (let i = 0; i < edges.length; i += 500) {
    const { error: e } = await db.from("match_edges").insert(edges.slice(i, i + 500));
    if (e) { console.error("edge insert failed:", e.message); process.exit(1); }
  }
  // Only now is the run a fact. ⛔ Still `complete`, never `promoted` — what the
  // site serves is a human's decision, not a side effect of the job finishing.
  const { error: doneErr } = await db
    .from("match_runs")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", run!.id);
  if (doneErr) { console.error("run completion failed:", doneErr.message); process.exit(1); }

  if (askRows.length > 0) {
    // ⛔ Upsert on (ask, candidate) so a re-run refreshes the suggestion without
    // stacking duplicates — and without touching selected_at, which belongs to
    // whatever a human already decided.
    const { error: askErr } = await db
      .from("ask_recommendations")
      .upsert(
        askRows.map((r) => ({ ...r, run_id: run!.id })),
        { onConflict: "ask_ref,candidate_org_id,candidate_contact_id", ignoreDuplicates: false }
      );
    if (askErr) console.error("ask recommendations failed:", askErr.message);
    else console.log(`ask recommendations: ${askRows.length} rows`);
  }

  /**
   * ⛔ Retract what this run no longer stands behind.
   *
   * The upsert refreshes rows it writes and is blind to rows it does not. A
   * candidate that drops out of an ask's top set keeps its row, still flagged
   * `recommended` with a stale rank — NorQuest College sat at rank 12 for the
   * notebooks ask two runs after the engine stopped ranking it, colliding with
   * the live rank 12. Left alone the table accretes phantom recommendations that
   * a surface will happily show as current, and the evaluation data then counts
   * a pick of a suggestion no engine ever made.
   *
   * ⚠️ Only rows this job owns. `selected_at is null` spares anything a human has
   * already acted on, and `recommended = true` spares their corrections — those
   * are the record of a decision, not a suggestion to withdraw. Scoped to the
   * asks actually considered, so an ask this run never looked at keeps whatever
   * an earlier run said about it.
   */
  if (asksConsidered.length > 0) {
    const { error: staleErr, count } = await db
      .from("ask_recommendations")
      .delete({ count: "exact" })
      .in("ask_ref", asksConsidered)
      .neq("run_id", run!.id)
      .is("selected_at", null)
      .eq("recommended", true);
    if (staleErr) console.error("stale retraction failed:", staleErr.message);
    else if (count) console.log(`retracted ${count} stale recommendation(s)`);
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
