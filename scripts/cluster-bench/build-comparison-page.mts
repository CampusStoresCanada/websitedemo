import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: orgs } = await db.from("organizations").select("id,name,province,type");
const name = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
const prov = new Map((orgs ?? []).map((o) => [o.id as string, (o.province as string | null) ?? ""]));

async function lists(runId: string) {
  const rows: { s: string; c: string; rank: number; total: number; sim: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("match_edges")
      .select("subject_org_id,candidate_org_id,rank,total,breakdown")
      .eq("run_id", runId).eq("direction", "member_to_partner").is("subject_contact_id", null)
      .order("subject_org_id").order("candidate_org_id").range(from, from + 999);
    if (!data?.length) break;
    rows.push(...data.map((d) => ({
      s: d.subject_org_id as string, c: d.candidate_org_id as string,
      rank: Number(d.rank), total: Number(d.total),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sim: Number((d.breakdown as any)?.similarity ?? NaN),
    })));
    if (data.length < 1000) break;
  }
  const by = new Map<string, { name: string; total: number; sim: number }[]>();
  for (const [s, list] of Object.entries(Object.groupBy(rows, (r) => r.s))) {
    by.set(s, (list ?? [])
      .sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.total - a.total)
      .slice(0, 6)
      .map((r) => ({ name: name.get(r.c) ?? "?", total: r.total, sim: r.sim })));
  }
  return by;
}

const { data: runs } = await db.from("match_runs").select("id,status,resolver_version,started_at").order("started_at", { ascending: false });
const oldRun = (runs ?? []).find((r) => r.status === "promoted")!;
const newRun = (runs ?? []).find((r) => r.resolver_version === "space-v1")!;
const [A, B] = [await lists(oldRun.id as string), await lists(newRun.id as string)];

const counts = new Map<string, number>();
for (const l of A.values()) counts.set(l.slice(0, 5).map((x) => x.name).join("|"), (counts.get(l.slice(0, 5).map((x) => x.name).join("|")) ?? 0) + 1);

const members = [...new Set([...A.keys(), ...B.keys()])]
  .sort((x, y) => (name.get(x) ?? "").localeCompare(name.get(y) ?? ""));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rowsHtml = members.map((m) => {
  const a = A.get(m) ?? [], b = B.get(m) ?? [];
  const key = a.slice(0, 5).map((x) => x.name).join("|");
  const isDefault = (counts.get(key) ?? 0) > 5;
  const cell = (list: { name: string; sim: number }[], showSim: boolean) =>
    list.length === 0 ? '<span class="none">no list</span>'
    : `<ol>${list.slice(0, 5).map((x) =>
        `<li>${esc(x.name)}${showSim && Number.isFinite(x.sim) ? `<em>${x.sim.toFixed(3)}</em>` : ""}</li>`).join("")}</ol>`;
  return `<tr>
    <th scope="row"><span class="m">${esc(name.get(m) ?? "?")}</span><span class="p">${esc(prov.get(m) ?? "")}</span></th>
    <td class="${isDefault ? "dup" : ""}">${cell(a, false)}${isDefault ? '<span class="tag">same list as 44 others</span>' : ""}</td>
    <td>${cell(b, true)}</td>
  </tr>`;
}).join("\n");

const html = `<title>Match Lists — Live vs Embedding</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
*,*::before,*::after{box-sizing:border-box}
:root{--bg:#F7F8FA;--panel:#fff;--ink:#16202B;--muted:#5C6B7A;--faint:#8797A6;--line:#DDE3EA;--accent:#0E7C86;--warn:#B4432B;--warn-bg:#FBF0ED;
--sans:"IBM Plex Sans",system-ui,sans-serif;--mono:"IBM Plex Mono",monospace}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#10151A;--panel:#171E26;--ink:#E6EDF3;--muted:#93A2B1;--faint:#6E7E8D;--line:#26313D;--accent:#35B4BE;--warn:#E08469;--warn-bg:#33201A}}
:root[data-theme=dark]{--bg:#10151A;--panel:#171E26;--ink:#E6EDF3;--muted:#93A2B1;--faint:#6E7E8D;--line:#26313D;--accent:#35B4BE;--warn:#E08469;--warn-bg:#33201A}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.5}
.wrap{max-width:1100px;margin:0 auto;padding:32px 24px 80px}
h1{font-size:28px;font-weight:600;letter-spacing:-.02em;margin:0 0 10px}
.sub{color:var(--muted);max-width:66ch;margin:0 0 6px}
.stats{display:flex;gap:0;margin:22px 0 26px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel);flex-wrap:wrap}
.stat{padding:12px 18px;flex:1 1 auto;min-width:150px;border-right:1px solid var(--line)}
.stat:last-child{border-right:0}
.stat b{display:block;font-family:var(--mono);font-size:20px;font-variant-numeric:tabular-nums}
.stat span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);margin-top:3px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:760px}
thead th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);font-weight:500;padding:12px 16px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--panel)}
tbody th{text-align:left;font-weight:500;padding:14px 16px;vertical-align:top;border-bottom:1px solid var(--line);white-space:nowrap}
tbody td{padding:14px 16px;vertical-align:top;border-bottom:1px solid var(--line);width:38%}
.m{display:block}.p{display:block;font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:2px}
ol{margin:0;padding-left:20px}
li{margin:2px 0}
li em{font-family:var(--mono);font-style:normal;font-size:11px;color:var(--faint);margin-left:7px}
.dup{background:var(--warn-bg)}
.tag{display:inline-block;margin-top:8px;font-size:11px;color:var(--warn);font-family:var(--mono)}
.none{color:var(--faint);font-style:italic}
.foot{margin-top:24px;color:var(--muted);font-size:13.5px;max-width:70ch}
</style>
<div class="wrap">
<h1>Who each member is told to talk to</h1>
<p class="sub">Left is what the site serves right now. Right is the embedding engine, unpromoted. Numbers on the right are the cosine — the actual closeness.</p>
<p class="sub">The shaded rows are the ones getting an identical list.</p>
<div class="stats">
<div class="stat"><b>${A.size}</b><span>members, live engine</span></div>
<div class="stat"><b>${counts.size}</b><span>distinct lists</span></div>
<div class="stat"><b>${Math.max(...counts.values())}</b><span>get the same one</span></div>
<div class="stat"><b>${B.size}</b><span>members, new engine</span></div>
<div class="stat"><b>${B.size}</b><span>distinct lists</span></div>
</div>
<div class="scroll"><table>
<thead><tr><th>Member</th><th>Live engine</th><th>Embedding space</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table></div>
<p class="foot">68 distinct lists proves the engine can say something specific — not that it is saying something true. A shuffle would score the same. What no metric can tell you: whether these read like the stores you know. The ones that look obviously <em>wrong</em> are the most useful thing you can point at.</p>
</div>`;

writeFileSync("/Users/Work/Desktop/match-comparison.html", `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n${html}\n</html>`);
console.log(`wrote Desktop/match-comparison.html — ${members.length} members`);
