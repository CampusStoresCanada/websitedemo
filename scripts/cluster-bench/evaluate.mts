/**
 * A held-out check with no outcomes: 13 members DECLARED what they buy, and the
 * embedding never saw those declarations as a label. If the top matches sell
 * what a member says they buy, the space found something real.
 *
 * ⚠️ Not proof the engine is good — it is one weak signal on 13 stores. But it
 * is the only check available before anyone acts on a recommendation, and a
 * random baseline says whether it beats chance at all.
 */
import { createClient } from "@supabase/supabase-js";
import { parseOrgCategories } from "@/lib/publication/categories";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: orgs } = await db.from("organizations")
  .select("id,name,type,primary_category,procurement_info")
  .in("type", ["Member", "Vendor Partner"]).is("archived_at", null).neq("is_test", true);

const partnerCats = new Map<string, Set<string>>();
const memberWants = new Map<string, Set<string>>();
const name = new Map<string, string>();
for (const o of orgs ?? []) {
  name.set(o.id as string, o.name as string);
  if (o.type === "Vendor Partner") {
    // ⛔ SUBCATEGORIES only. Departments are the coarse layer — "Apparel" covers
    // half the roster, which is why a random partner satisfied a member 76% of
    // the time and the test could not discriminate at all.
    const p = parseOrgCategories(o.primary_category as string | null);
    partnerCats.set(o.id as string, new Set(p.classes));
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = ((o.procurement_info as any)?.category_buyers ?? []) as any[];
    const tokens = cb.flatMap((e) => [e?.category, ...Object.values(e?.contact_subcategories ?? {}).flat()]).filter(Boolean);
    if (tokens.length) {
      const p = parseOrgCategories(tokens.join(","));
      if (p.classes.length) memberWants.set(o.id as string, new Set(p.classes));
    }
  }
}

async function hitRate(runId: string, topN: number) {
  // ⛔ PAGE IT. PostgREST caps a select at 1,000 rows and says nothing — the new
  // run has 1,700 org-level edges, so an unpaged read silently evaluated half
  // the members and produced a confident, wrong answer. Same silent truncation
  // as an over-long `.in()` list.
  const edges: { subject_org_id: string; candidate_org_id: string; rank: number; total: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await db.from("match_edges")
      .select("subject_org_id, candidate_org_id, rank, total")
      .eq("run_id", runId).eq("direction", "member_to_partner").is("subject_contact_id", null)
      // ⛔ A stable ORDER BY is mandatory when paging. Without one Postgres gives
      // no guaranteed order, so pages OVERLAP and SKIP: this fetched 1,700 rows
      // and saw only 51 of 68 subjects among them — half the members silently
      // missing from an evaluation that then reported a confident number.
      .order("subject_org_id", { ascending: true })
      .order("candidate_org_id", { ascending: true })
      .range(from, from + 999);
    if (!page?.length) break;
    edges.push(...(page as typeof edges));
    if (page.length < 1000) break;
  }

  const bySubject = new Map<string, { cand: string; rank: number; total: number }[]>();
  for (const e of edges ?? []) {
    const k = e.subject_org_id as string;
    bySubject.set(k, [...(bySubject.get(k) ?? []), { cand: e.candidate_org_id as string, rank: Number(e.rank), total: Number(e.total) }]);
  }

  if (topN === 3) {
    console.log(`  [debug] run ${runId.slice(0,8)}: ${edges.length} edges fetched, ${bySubject.size} subjects`);
    const missing = [...memberWants.keys()].filter((o) => !bySubject.has(o));
    console.log(`  [debug] declared members with no list: ${missing.map((m) => name.get(m)).join(", ") || "none"}`);
  }
  let evaluated = 0, hits = 0, listed = 0;
  for (const [org, wants] of memberWants) {
    const list = bySubject.get(org);
    if (!list?.length) continue;
    evaluated++;
    // rank is 0 on older runs — fall back to total so both engines are comparable.
    const top = [...list].sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.total - a.total).slice(0, topN);
    for (const t of top) {
      listed++;
      const sells = partnerCats.get(t.cand);
      if (sells && [...wants].some((w) => sells.has(w))) hits++;
    }
  }
  return { evaluated, rate: listed ? hits / listed : 0 };
}

// Chance: what fraction of ALL partners would satisfy a given member anyway?
let baselineHits = 0, baselinePairs = 0;
for (const wants of memberWants.values()) {
  for (const sells of partnerCats.values()) {
    baselinePairs++;
    if ([...wants].some((w) => sells.has(w))) baselineHits++;
  }
}

const { data: runs } = await db.from("match_runs")
  .select("id,status,resolver_version,started_at").order("started_at", { ascending: false });
const newest = (runs ?? []).find((r) => r.resolver_version === "space-v1")!;
const old = (runs ?? []).find((r) => r.status === "promoted")!;

const withSubs = [...partnerCats.values()].filter((v) => v.size > 0).length;
console.log(`${memberWants.size} members declared SUBCATEGORIES · ${withSubs} of ${partnerCats.size} partners declared subcategories\n`);
console.log(`random partner satisfies a member   ${(baselineHits / baselinePairs * 100).toFixed(1)}%   ← chance`);
for (const n of [3, 5, 10]) {
  const a = await hitRate(old.id as string, n);
  const b = await hitRate(newest.id as string, n);
  console.log(
    `top ${String(n).padStart(2)}   old engine ${(a.rate * 100).toFixed(1)}% (${a.evaluated} members)` +
    `   embedding space ${(b.rate * 100).toFixed(1)}% (${b.evaluated} members)`
  );
}
