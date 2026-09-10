#!/usr/bin/env npx tsx
/**
 * Circle → signal events. READ-ONLY probe by default.
 *
 *   npx tsx scripts/circle-signal-backfill.mts            # fetch, resolve, report
 *   npx tsx scripts/circle-signal-backfill.mts --limit 5  # fewer spaces, for a quick look
 *
 * ⛔ Writes nothing. The raw log lives in local Postgres on the Mac and that
 * server does not exist yet (only the psql client is installed). Resolution is
 * the uncertain half and is worth measuring before anything is stored; the write
 * is a few lines once there is a target.
 */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const { getCircleClient } = await import("../lib/circle/client");
const { createAdminClient } = await import("../lib/supabase/admin");
const { postToSignalEvents, profileGapsFor, summarizeBackfill } = await import("../lib/signals/circle-backfill");
const { parseOrgCategories } = await import("../lib/publication/categories");
const { unresolvedDemand } = await import("../lib/signals/aggregate");
type SignalEvent = import("../lib/signals/types").SignalEvent;
type CircleActor = import("../lib/signals/circle-backfill").CircleActor;

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const SPACE_LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;

const circle = getCircleClient();
if (!circle) {
  console.error("No Circle client — CIRCLE_API_KEY / CIRCLE_COMMUNITY_ID not set.");
  process.exit(1);
}

const db = createAdminClient();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = db as any;

// circle member -> contact -> org. This mapping is the attribution gate: 236
// rows against 986 contacts, so a large share of posts will be unattributed —
// which is fine, they are still demand.
const { data: mappings } = await q
  .from("circle_member_mapping")
  .select("circle_member_id, contact_id, contacts(id, organization_id)")
  .not("contact_id", "is", null);

// ⚠️ Two different Circle ids, and the obvious join is the wrong one.
//
// `circle_member_mapping.circle_member_id` stores the COMMUNITY MEMBER id
// (verified: 241 of 241 mapping rows match `member.id`, and 0 match
// `member.user_id`). Posts carry `user_id`. Joining posts straight to the
// mapping silently attributes nothing — the first probe reported 0 of 783 posts
// attributed with no error anywhere.
//
// So the chain is: post.user_id → member (by user_id) → member.id → mapping.
const actorByMemberId = new Map<number, CircleActor>();
for (const m of (mappings ?? []) as Record<string, never>[]) {
  const contact = (m as unknown as { contacts?: { id: string; organization_id: string } }).contacts;
  if (!contact?.organization_id) continue;
  actorByMemberId.set(
    Number((m as unknown as { circle_member_id: number }).circle_member_id),
    { organizationId: contact.organization_id, contactId: contact.id }
  );
}

const memberEmailMap = await circle.buildEmailMap();
const actorByCircleUserId = new Map<number, CircleActor>();
let membersWithUserId = 0;
for (const member of memberEmailMap.values() as Iterable<{ id: number; user_id?: number }>) {
  if (member.user_id == null) continue;
  membersWithUserId++;
  const actor = actorByMemberId.get(member.id);
  if (actor) actorByCircleUserId.set(member.user_id, actor);
}

// Spaces named after a partner resolve to that org rather than to categories.
const { data: orgs } = await q
  .from("organizations")
  .select("id, name")
  .is("archived_at", null);
const orgIdByName = new Map<string, string>(
  ((orgs ?? []) as { id: string; name: string }[]).map((o) => [o.name.trim().toLowerCase(), o.id])
);

// Partner names, for detecting mentions in post bodies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { data: partnerRows } = await q
  .from("organizations")
  .select("id, name")
  .eq("type", "Vendor Partner")
  .is("archived_at", null)
  .eq("is_test", false);
const partnersByName = new Map<string, string>(
  ((partnerRows ?? []) as { id: string; name: string }[]).map((o) => [o.name.trim(), o.id])
);

// ⛔ What each org has already DECLARED. The backfill refuses to guess a category
// for anyone in this map — we know, and a guess can only contradict.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { data: declaredRows } = await q
  .from("organizations")
  .select("id, primary_category, procurement_info")
  .is("archived_at", null);
const declaredTermsByOrg = new Map<string, Set<string>>();
for (const o of (declaredRows ?? []) as { id: string; primary_category: string | null; procurement_info: Record<string, unknown> | null }[]) {
  const tokens: string[] = [];
  if (o.primary_category) tokens.push(o.primary_category);
  const buyers = Array.isArray(o.procurement_info?.category_buyers)
    ? (o.procurement_info!.category_buyers as { category?: string; contact_subcategories?: Record<string, string[]> }[])
    : [];
  for (const b of buyers) {
    if (b.category) tokens.push(b.category);
    for (const subs of Object.values(b.contact_subcategories ?? {})) tokens.push(...subs);
  }
  if (tokens.length === 0) continue;
  const parsed = parseOrgCategories(tokens.join(","));
  declaredTermsByOrg.set(o.id, new Set([...parsed.departments, ...parsed.classes]));
}

const spaces = await circle.listSpaces();
const spacesById = new Map(
  spaces.map((s) => [
    s.id,
    { id: s.id, name: s.name, organizationId: orgIdByName.get(s.name.trim().toLowerCase()) ?? null },
  ])
);

console.log(
  `${spaces.length} spaces · ${actorByMemberId.size} mapping rows · ` +
    `${membersWithUserId} circle members carry a user_id · ` +
    `${actorByCircleUserId.size} resolvable post authors\n`
);

const events: SignalEvent[] = [];
const gaps: import("../lib/signals/circle-backfill").ProfileGap[] = [];
let postCount = 0;
let scanned = 0;

for (const space of spaces) {
  if (scanned >= SPACE_LIMIT) break;
  scanned++;

  const posts: Awaited<ReturnType<typeof circle.listPosts>> = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await circle.listPosts(space.id, { per_page: 100, page });
    if (batch.length === 0) break;
    posts.push(...batch);
    if (batch.length < 100) break;
  }
  if (posts.length === 0) continue;
  postCount += posts.length;

  const opts = { actorByCircleUserId, spacesById, partnersByName, declaredTermsByOrg };
  const spaceEvents = posts.flatMap((p) => postToSignalEvents(p, opts));
  for (const p of posts) gaps.push(...profileGapsFor(p, opts));
  events.push(...spaceEvents);

  const resolved = spaceEvents.filter((e) => e.terms.length > 0).length;
  const attributed = spaceEvents.filter((e) => e.actorOrgId).length;
  console.log(
    `  ${space.name.padEnd(34).slice(0, 34)} ${String(posts.length).padStart(4)} posts · ` +
      `${String(resolved).padStart(4)} resolved · ${String(attributed).padStart(4)} attributed`
  );
}

const report = summarizeBackfill(events, postCount);
console.log(`
── totals ──────────────────────────────────────────
posts fetched      ${report.posts}
events kept        ${report.kept}
attributed to org  ${report.attributed}  (${((100 * report.attributed) / Math.max(report.kept, 1)).toFixed(0)}%)
resolved to terms  ${report.resolved}  (${((100 * report.resolved) / Math.max(report.kept, 1)).toFixed(0)}%)
  via space name   ${report.fromSpaceName}
org affinity edges ${report.orgAffinity}`);

console.log(`\ntop terms:`);
for (const t of report.termCounts.slice(0, 12)) {
  console.log(`  ${String(t.posts).padStart(4)}  ${t.term}`);
}

const demand = unresolvedDemand(events, { minOrgs: 1 }).slice(0, 10);
if (demand.length > 0) {
  console.log(`\nresolved to nothing — demand with no category yet:`);
  for (const d of demand) {
    console.log(`  ${String(d.occurrences).padStart(3)}×  ${d.text.slice(0, 78)}`);
  }
}

// The genuinely useful half of reading an org we already understand.
const gapCounts = new Map<string, { term: string; org: string; n: number; evidence: string }>();
const orgNameById = new Map<string, string>(
  ((orgs ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name])
);
for (const g of gaps) {
  const key = `${g.organizationId}|${g.term}`;
  const found = gapCounts.get(key);
  if (found) found.n++;
  else gapCounts.set(key, { term: g.term, org: orgNameById.get(g.organizationId) ?? g.organizationId, n: 1, evidence: g.evidence });
}
const ranked = [...gapCounts.values()].sort((a, b) => b.n - a.n).slice(0, 12);
if (ranked.length > 0) {
  console.log(`\nprofile gaps — talks about it, has never declared it (${gapCounts.size} total):`);
  for (const g of ranked) {
    console.log(`  ${String(g.n).padStart(3)}×  ${g.org} — ${g.term}`);
  }
}

console.log(`\nnothing written — this is a probe.`);
