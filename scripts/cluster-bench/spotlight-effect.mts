/** What the 90-day spotlight actually does to a member's ranked list. */
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: run } = await db.from("match_runs").select("id")
  .eq("status", "complete").order("started_at", { ascending: false }).limit(1).single();

const { data: spot } = await db.from("membership_state_log")
  .select("organization_id, created_at")
  .eq("to_status", "active")
  .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString());
const spotlight = new Set((spot ?? []).map((s) => s.organization_id as string));

const { data: orgs } = await db.from("organizations").select("id,name,type");
const name = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

// One member with a decent list.
const { data: edges } = await db.from("match_edges")
  .select("subject_org_id, subject_contact_id, candidate_org_id, total")
  .eq("run_id", run!.id).eq("direction", "member_to_partner")
  .not("subject_contact_id", "is", null)
  .order("total", { ascending: false }).limit(400);

const bySubject = new Map<string, { cand: string; total: number }[]>();
for (const e of edges ?? []) {
  const k = e.subject_contact_id as string;
  bySubject.set(k, [...(bySubject.get(k) ?? []), { cand: e.candidate_org_id as string, total: Number(e.total) }]);
}
const [subject, list] = [...bySubject.entries()].sort((a, b) => b[1].length - a[1].length)[0];
const { data: who } = await db.from("contacts").select("name, organizations(name)").eq("id", subject).single();

// How hard does the thumb press?
const spread = [...list].sort((a,b)=>b.total-a.total);
console.log(`top-10 fit scores: ${spread.slice(0,10).map(e=>e.total.toFixed(1)).join(", ")}`);
console.log(`gap between adjacent ranks in the top 10: ${(spread[0].total - spread[9].total).toFixed(1)} points total\n`);
for (const m of [1.02, 1.05, 1.10, 1.25]) {
  const boosted = [...list].map(e => ({...e, p: e.total * (spotlight.has(e.cand) ? m : 1)}))
    .sort((a,b)=>b.p-a.p).slice(0,8);
  const n = boosted.filter(e => spotlight.has(e.cand)).length;
  console.log(`  x${m.toFixed(2)} → ${n} of the top 8 are new partners`);
}
console.log();

const before = [...list].sort((a, b) => b.total - a.total).slice(0, 8);
// Slot reservation, as shipped: 2 slots within the top 10.
const ordered = [...list].sort((a, b) => b.total - a.total);
const head = ordered.slice(0, 10), tail = ordered.slice(10);
const already = head.filter((e) => spotlight.has(e.cand)).length;
const shortBy = Math.min(2 - already, tail.filter((e) => spotlight.has(e.cand)).length);
let arranged = ordered;
if (shortBy > 0) {
  const lifted = tail.filter((e) => spotlight.has(e.cand)).slice(0, shortBy);
  const liftedSet = new Set(lifted);
  const displaced = new Set(head.filter((e) => !spotlight.has(e.cand)).slice(-shortBy));
  arranged = [
    ...head.filter((e) => !displaced.has(e)), ...lifted,
    ...displaced, ...tail.filter((e) => !liftedSet.has(e)),
  ];
}
const after = arranged.slice(0, 8);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.log(`subject: ${(who as any)?.name} (${(who as any)?.organizations?.name})\n`);
console.log("rank  fit only                              →  with the 90-day spotlight");
for (let i = 0; i < 8; i++) {
  const b = before[i], a = after[i];
  const star = a && spotlight.has(a.cand) ? " ★" : "";
  console.log(
    `${String(i + 1).padStart(2)}    ${(name.get(b.cand) ?? "?").slice(0, 34).padEnd(36)}  ${(name.get(a.cand) ?? "?").slice(0, 30)}${star}`
  );
}
const moved = after.filter((a, i) => before[i]?.cand !== a.cand).length;
console.log(`\n${spotlight.size} orgs in the window · ${moved} of the top 8 positions changed`);
