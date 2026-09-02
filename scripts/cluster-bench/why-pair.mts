/** Which of a member's own acts sit nearest a given partner. The "why". */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { normalize, dot } from "@/lib/signals/embedding";
import { redactContactDetails } from "@/lib/signals/redact";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const MEMBER = process.argv[2] ?? "Waterloo";
const PARTNER = process.argv[3] ?? "RAINS";

async function embed(texts: string[]) {
  const r = await fetch("http://localhost:11434/api/embed", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", input: texts }),
  });
  return ((await r.json()).embeddings as number[][]).map(normalize);
}

const { data: partner } = await db.from("organizations")
  .select("id,name,company_description,website_summary,primary_category")
  .ilike("name", `${PARTNER}%`).limit(1).single();
const partnerText = [partner!.company_description, partner!.website_summary, partner!.primary_category]
  .filter(Boolean).join(". ");
console.log(`${partner!.name}:\n  "${partnerText.slice(0, 260)}"\n`);

const { data: member } = await db.from("organizations").select("id,name").ilike("name", `%${MEMBER}%`).limit(1).single();
const { data: contacts } = await db.from("contacts").select("id,name").eq("organization_id", member!.id);
const names = new Set((contacts ?? []).map((c) => `${c.name} · ${member!.name}`));
const contactNames = new Set((contacts ?? []).map((c) => c.name as string));

const { data: maps } = await db.from("circle_member_mapping").select("circle_member_id,contact_id").not("contact_id","is",null);
const contactIds = new Set((contacts ?? []).map((c) => c.id as string));
const theirMemberIds = new Set((maps ?? []).filter((m) => contactIds.has(m.contact_id as string)).map((m) => Number(m.circle_member_id)));

const acts: { who: string; text: string }[] = [];
for (const d of JSON.parse(readFileSync(".cache/circle-corpus.json","utf8")) as any[]) {
  if (d.kind === "post" && d.author && names.has(d.author)) acts.push({ who: d.author.split(" · ")[0], text: d.text });
}
for (const c of JSON.parse(readFileSync(".cache/circle-comments.json","utf8")) as any[]) {
  if (c.userName && contactNames.has(c.userName)) acts.push({ who: c.userName, text: c.body });
}
const usable = acts.filter((a) => a.text.length > 25).map((a) => ({ ...a, text: redactContactDetails(a.text) }));
console.log(`${member!.name}: ${usable.length} acts by ${new Set(usable.map(u=>u.who)).size} people\n`);
if (!usable.length) process.exit(0);

const [pv] = await embed([partnerText]);
const vs: number[][] = [];
for (let i = 0; i < usable.length; i += 32) vs.push(...(await embed(usable.slice(i, i + 32).map((u) => u.text))));

const ranked = usable.map((u, i) => ({ ...u, sim: dot(pv, vs[i]) })).sort((a, b) => b.sim - a.sim);
console.log(`nearest acts to ${partner!.name}:\n`);
for (const r of ranked.slice(0, 6)) {
  console.log(`  ${r.sim.toFixed(3)}  ${r.who}: ${r.text.replace(/\s+/g," ").slice(0, 150)}`);
}
