#!/usr/bin/env node
/**
 * READ-ONLY verification: is every org's quickbooks_customer_id pointing at a
 * live QBO customer, and are there any duplicates left?
 *
 * Fetches inactive records too (QBO's default query hides them), so records
 * merged away are visible rather than silently missing.
 *
 * --apply repoints orgs whose stored id is a merged-away record, to the
 * survivor, but ONLY when the survivor is unambiguous.
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: tok } = await db.from("app_settings").select("value").eq("key", "qbo_refresh_token").single();
const cred = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64");
const tr = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", { method: "POST",
  headers: { Authorization: `Basic ${cred}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.value }).toString() });
const t = await tr.json();
if (t.refresh_token && t.refresh_token !== tok.value)
  await db.from("app_settings").upsert({ key: "qbo_refresh_token", value: t.refresh_token }, { onConflict: "key" });

const Q = async (q) => {
  const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${process.env.QUICKBOOKS_REALM_ID}/query?query=${encodeURIComponent(q)}&minorversion=65`,
    { headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).QueryResponse ?? {};
};

// include inactive — merged-away records are Active=false
const customers = [];
for (let s = 1; ; s += 1000) {
  const p = (await Q(`SELECT * FROM Customer WHERE Active IN (true, false) ORDERBY Id STARTPOSITION ${s} MAXRESULTS 1000`)).Customer ?? [];
  customers.push(...p); if (p.length < 1000) break;
}
const byId = new Map(customers.map((c) => [String(c.Id), c]));
const live = customers.filter((c) => c.Active !== false);
console.log(`${customers.length} QBO customers (${live.length} active, ${customers.length - live.length} inactive/merged)\n`);

const norm = (x) => (x ?? "").replace(/\s*\(deleted\)\s*$/i, "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const NOISE = new Set(["inc","ltd","limited","llc","llp","corp","corporation","co","company","incorporated",
  "canada","usa","america","intl","international","bookstore","bookstores","store","stores","university","college","the","of","and","at","for"]);
const keyOf = (x) => norm(x).split(" ").filter((w) => w && !NOISE.has(w)).sort().join(" ");

const liveByKey = new Map();
for (const c of live) for (const k of new Set([keyOf(c.DisplayName), keyOf(c.CompanyName)].filter(Boolean))) {
  if (!liveByKey.has(k)) liveByKey.set(k, []);
  if (!liveByKey.get(k).some((x) => x.Id === c.Id)) liveByKey.get(k).push(c);
}

const { data: orgs } = await db.from("organizations")
  .select("id, name, type, membership_status, quickbooks_customer_id")
  .eq("is_test", false).in("membership_status", ["active", "approved"]).order("name");

const stale = [], missing = [], dupes = [], noId = [], ok = [];
for (const o of orgs ?? []) {
  const cur = o.quickbooks_customer_id ? String(o.quickbooks_customer_id) : null;
  if (!cur) { noId.push(o); continue; }
  const rec = byId.get(cur);
  if (!rec) { missing.push({ o, cur }); continue; }
  if (rec.Active === false) {
    // find the survivor by name among live records
    const cands = new Set([...(liveByKey.get(keyOf(rec.DisplayName)) ?? []), ...(liveByKey.get(keyOf(rec.CompanyName)) ?? []),
                           ...(liveByKey.get(keyOf(o.name)) ?? [])].map((c) => String(c.Id)));
    stale.push({ o, cur, rec, survivors: [...cands] });
    continue;
  }
  const cluster = [...new Set([...(liveByKey.get(keyOf(o.name)) ?? []).map((c) => String(c.Id)), cur])];
  if (cluster.length > 1) dupes.push({ o, cur, cluster });
  else ok.push(o);
}

console.log("=".repeat(100));
console.log(`STALE — stored id was merged away (${stale.length})`);
console.log("=".repeat(100));
for (const s of stale) console.log(`   ${s.o.name.slice(0,38).padEnd(39)} ${s.cur} "${s.rec.DisplayName}"  → survivor(s): ${s.survivors.join(", ") || "NONE FOUND"}`);

console.log(`\nBROKEN — stored id not found in QBO at all (${missing.length})`);
for (const m of missing) console.log(`   ${m.o.name.slice(0,38).padEnd(39)} ${m.cur}`);

console.log(`\nDUPLICATES REMAINING — more than one live record (${dupes.length})`);
for (const d of dupes) {
  console.log(`   ${d.o.name.slice(0,38).padEnd(39)} linked ${d.cur}`);
  for (const id of d.cluster) { const c = byId.get(id);
    console.log(`        ${id === d.cur ? "→" : " "} ${id.padEnd(5)} ${String(c?.DisplayName??"?").slice(0,34).padEnd(35)} bal $${Number(c?.Balance??0).toFixed(2)}`); }
}

console.log(`\nNO QBO ID (${noId.length}): ${noId.map((o) => o.name).join(", ") || "none"}`);
console.log(`\nCLEAN: ${ok.length} of ${orgs.length} active orgs`);

if (APPLY) {
  let n = 0;
  for (const s of stale) {
    if (s.survivors.length !== 1) { console.log(`   SKIP ${s.o.name} — ${s.survivors.length} candidate survivors`); continue; }
    const { error } = await db.from("organizations")
      .update({ quickbooks_customer_id: s.survivors[0], last_synced_qbo_at: new Date().toISOString() })
      .eq("id", s.o.id);
    if (error) console.log(`   FAILED ${s.o.name}: ${error.message}`);
    else { console.log(`   repointed ${s.o.name}: ${s.cur} → ${s.survivors[0]}`); n++; }
  }
  console.log(`\nAPPLIED: ${n}`);
} else if (stale.length) {
  console.log(`\n(dry run — re-run with --apply to repoint the ${stale.length} stale link(s))`);
}
