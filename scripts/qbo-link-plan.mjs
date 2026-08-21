#!/usr/bin/env node
/**
 * READ-ONLY. Classifies every active non-test org by how its QBO records sit:
 *
 *   SAFE   — exactly one QBO record carries any transactions/balance.
 *            The DB can point at it now; merging the empty twin later is cosmetic.
 *   SPLIT  — two or more records carry real history. The DB CANNOT be made
 *            correct by picking one; QBO has to be merged first.
 *   SINGLE — one record, no ambiguity.
 *   NONE   — no QBO record at all.
 *
 * Pass --apply to write quickbooks_customer_id for SAFE + SINGLE only.
 * SPLIT is never written automatically.
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

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
const pageAll = async (e) => { const o = []; for (let s = 1; ; s += 1000) { const p = (await Q(`SELECT * FROM ${e} ORDERBY Id STARTPOSITION ${s} MAXRESULTS 1000`))[e] ?? []; o.push(...p); if (p.length < 1000) break; } return o; };

const [customers, invoices, receipts, payments] = await Promise.all([
  pageAll("Customer"), pageAll("Invoice"), pageAll("SalesReceipt"), pageAll("Payment")]);

const hist = new Map();
const bump = (cid, k, amt, d) => { if (!cid) return;
  const h = hist.get(cid) ?? { inv: 0, rcpt: 0, pay: 0, total: 0, last: "" };
  h[k]++; h.total += Number(amt ?? 0); if (d && d > h.last) h.last = d; hist.set(cid, h); };
for (const i of invoices) bump(i.CustomerRef?.value, "inv", i.TotalAmt, i.TxnDate);
for (const r of receipts) bump(r.CustomerRef?.value, "rcpt", r.TotalAmt, r.TxnDate);
for (const p of payments) bump(p.CustomerRef?.value, "pay", p.TotalAmt, p.TxnDate);

const norm = (x) => (x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const NOISE = new Set(["inc","ltd","limited","llc","llp","corp","corporation","co","company","incorporated",
  "canada","usa","america","intl","international","bookstore","bookstores","store","stores","university","college","the","of","and","at","for"]);
const keyOf = (x) => norm(x).split(" ").filter((w) => w && !NOISE.has(w)).sort().join(" ");

const byKey = new Map();
for (const c of customers) for (const k of new Set([keyOf(c.DisplayName), keyOf(c.CompanyName)].filter(Boolean))) {
  if (!byKey.has(k)) byKey.set(k, []);
  if (!byKey.get(k).some((x) => x.Id === c.Id)) byKey.get(k).push(c);
}

const { data: orgs } = await db.from("organizations")
  .select("id, name, type, membership_status, quickbooks_customer_id")
  .eq("is_test", false).in("membership_status", ["active", "approved"]).order("name");

const info = (c) => { const h = hist.get(String(c.Id)) ?? { inv: 0, rcpt: 0, pay: 0, total: 0, last: "" };
  return { id: String(c.Id), disp: c.DisplayName ?? "—", comp: c.CompanyName ?? "", created: (c.MetaData?.CreateTime ?? "?").slice(0, 10),
           bal: Number(c.Balance ?? 0), txns: h.inv + h.rcpt + h.pay, total: h.total, last: h.last,
           desc: `${h.inv}inv/${h.rcpt}rcpt/${h.pay}pay $${h.total.toFixed(2)}${h.last ? " last " + h.last : ""}` }; };
const hasBusiness = (c) => c.txns > 0 || c.bal !== 0;

const buckets = { SAFE: [], SPLIT: [], SINGLE: [], NONE: [] };
for (const o of orgs ?? []) {
  const m = new Map();
  for (const c of byKey.get(keyOf(o.name)) ?? []) m.set(String(c.Id), c);
  if (o.quickbooks_customer_id) { const cur = customers.find((c) => String(c.Id) === String(o.quickbooks_customer_id)); if (cur) m.set(String(cur.Id), cur); }
  const list = [...m.values()].map(info).sort((a, b) => b.txns - a.txns || b.bal - a.bal);
  const cur = o.quickbooks_customer_id ? String(o.quickbooks_customer_id) : null;
  if (!list.length) { buckets.NONE.push({ o }); continue; }
  if (list.length === 1) { buckets.SINGLE.push({ o, cur, pick: list[0].id, list }); continue; }
  const withBusiness = list.filter(hasBusiness);
  if (withBusiness.length <= 1) buckets.SAFE.push({ o, cur, pick: (withBusiness[0] ?? list[0]).id, list });
  else buckets.SPLIT.push({ o, cur, list, withBusiness });
}

let md = `# QBO link plan — active orgs\n\nGenerated ${new Date().toISOString()} · read-only${APPLY ? " (APPLY MODE)" : ""}\n\n`;
const line = (c, cur, pick) => `| ${c.id === pick ? "**LINK**" : "dup"}${c.id === cur ? " ←current" : ""} | ${c.id} | ${c.disp} | ${c.comp || "—"} | ${c.created} | $${c.bal.toFixed(2)} | ${c.desc} |`;
const HDR = `| | QBO Id | DisplayName | CompanyName | Created | Balance | Activity |\n|---|---|---|---|---|---|---|`;

md += `## SPLIT — history on more than one record; MERGE IN QBO FIRST (${buckets.SPLIT.length})\n\n`;
md += `The DB cannot be made correct by picking one of these. Each has real transactions on two or more records.\n`;
for (const b of buckets.SPLIT) {
  md += `\n### ${b.o.name} — *${b.o.type}* · currently **${b.cur ?? "UNLINKED"}**\n\n${HDR}\n`;
  for (const c of b.list) md += line(c, b.cur, null) + "\n";
}
md += `\n## SAFE — only one record has any business (${buckets.SAFE.length})\n\n${HDR}\n`;
for (const b of buckets.SAFE) { md += `| **${b.o.name}** | | | | | | currently ${b.cur ?? "NULL"} → **${b.pick}** |\n`;
  for (const c of b.list) md += line(c, b.cur, b.pick) + "\n"; }
md += `\n## SINGLE — one record (${buckets.SINGLE.length})\n\n| Org | Currently | Link to | QBO DisplayName | Activity |\n|---|---|---|---|---|\n`;
for (const b of buckets.SINGLE) md += `| ${b.o.name} | ${b.cur ?? "NULL"} | ${b.pick} | ${b.list[0].disp} | ${b.list[0].desc} |\n`;
md += `\n## NONE — no QBO record (${buckets.NONE.length})\n\n`;
for (const b of buckets.NONE) md += `- ${b.o.name} (${b.o.type})\n`;

writeFileSync(new URL("./qbo-link-plan.md", import.meta.url).pathname, md);

console.log(`SPLIT (merge in QBO first): ${buckets.SPLIT.length}`);
for (const b of buckets.SPLIT) console.log(`   ${b.o.name.slice(0,38).padEnd(39)} cur=${String(b.cur).padEnd(5)} ${b.withBusiness.map(c=>`${c.id}[${c.desc}${c.bal?` BAL $${c.bal.toFixed(2)}`:""}]`).join("  +  ")}`);
console.log(`\nSAFE (auto-linkable): ${buckets.SAFE.length}`);
for (const b of buckets.SAFE) if (b.cur !== b.pick) console.log(`   ${b.o.name.slice(0,38).padEnd(39)} ${String(b.cur).padEnd(5)} → ${b.pick}`);
console.log(`\nSINGLE needing a write: ${buckets.SINGLE.filter(b=>b.cur!==b.pick).length}`);
for (const b of buckets.SINGLE) if (b.cur !== b.pick) console.log(`   ${b.o.name.slice(0,38).padEnd(39)} ${String(b.cur).padEnd(5)} → ${b.pick}`);
console.log(`\nNONE: ${buckets.NONE.length}  ${buckets.NONE.map(b=>b.o.name).join(", ")}`);

if (APPLY) {
  let n = 0;
  for (const b of [...buckets.SAFE, ...buckets.SINGLE]) {
    if (b.cur === b.pick) continue;
    const { error } = await db.from("organizations")
      .update({ quickbooks_customer_id: b.pick, last_synced_qbo_at: new Date().toISOString() })
      .eq("id", b.o.id);
    if (error) console.log(`   FAILED ${b.o.name}: ${error.message}`); else n++;
  }
  console.log(`\nAPPLIED: ${n} org(s) repointed. SPLIT left untouched.`);
} else {
  console.log(`\n(dry run — re-run with --apply to write SAFE + SINGLE)`);
}
