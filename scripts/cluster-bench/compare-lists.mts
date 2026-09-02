/** Ten members' supplier lists, old engine vs the embedding space. */
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: orgs } = await db.from("organizations").select("id,name,type");
const name = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

async function lists(runId: string) {
  const rows: { s: string; c: string; rank: number; total: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("match_edges")
      .select("subject_org_id,candidate_org_id,rank,total")
      .eq("run_id", runId).eq("direction", "member_to_partner").is("subject_contact_id", null)
      .order("subject_org_id").order("candidate_org_id").range(from, from + 999);
    if (!data?.length) break;
    rows.push(...data.map((d) => ({ s: d.subject_org_id as string, c: d.candidate_org_id as string, rank: Number(d.rank), total: Number(d.total) })));
    if (data.length < 1000) break;
  }
  const by = new Map<string, string[]>();
  for (const [s, list] of Object.entries(Object.groupBy(rows, (r) => r.s))) {
    by.set(s, (list ?? []).sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.total - a.total).slice(0, 5).map((r) => name.get(r.c) ?? "?"));
  }
  return by;
}

const { data: runs } = await db.from("match_runs").select("id,status,resolver_version").order("started_at", { ascending: false });
const oldRun = (runs ?? []).find((r) => r.status === "promoted")!;
const newRun = (runs ?? []).find((r) => r.resolver_version === "space-v1")!;

const [a, b] = [await lists(oldRun.id as string), await lists(newRun.id as string)];
const shared = [...b.keys()].filter((k) => a.has(k)).sort((x, y) => (name.get(x) ?? "").localeCompare(name.get(y) ?? ""));

console.log("MEMBER".padEnd(30) + "LIVE ENGINE (top 3)".padEnd(46) + "EMBEDDING SPACE (top 3)");
console.log("─".repeat(120));
for (const org of shared.slice(0, 10)) {
  const oldL = a.get(org) ?? [], newL = b.get(org) ?? [];
  console.log(
    (name.get(org) ?? "?").slice(0, 28).padEnd(30) +
    oldL.slice(0, 3).join(", ").slice(0, 44).padEnd(46) +
    newL.slice(0, 3).join(", ").slice(0, 44)
  );
}
