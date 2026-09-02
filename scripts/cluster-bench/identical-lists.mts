import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: orgs } = await db.from("organizations").select("id,name");
const name = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

async function topFives(runId: string) {
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
  const out = new Map<string, string>();
  for (const [s, list] of Object.entries(Object.groupBy(rows, (r) => r.s))) {
    out.set(s, (list ?? []).sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.total - a.total)
      .slice(0, 5).map((r) => name.get(r.c) ?? "?").join(" | "));
  }
  return out;
}

const { data: runs } = await db.from("match_runs").select("id,status,resolver_version").order("started_at", { ascending: false });
for (const [label, run] of [
  ["live engine   ", (runs ?? []).find((r) => r.status === "promoted")!],
  ["embedding space", (runs ?? []).find((r) => r.resolver_version === "space-v1")!],
] as const) {
  const lists = await topFives(run.id as string);
  const counts = new Map<string, number>();
  for (const l of lists.values()) counts.set(l, (counts.get(l) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${label}  ${lists.size} members · ${counts.size} DISTINCT top-5 lists`);
  console.log(`                 most common list appears ${ranked[0][1]}x  →  ${ranked[0][0].slice(0, 70)}`);
}
