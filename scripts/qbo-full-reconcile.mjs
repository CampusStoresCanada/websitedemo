#!/usr/bin/env node
/**
 * READ-ONLY full QBO ↔ Supabase reconciliation.
 *
 * For every non-test org: every QBO customer record that plausibly belongs to
 * it, with transaction history per record, so a survivor can be chosen.
 * Writes nothing except the rotated OAuth refresh token (as the app does).
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: tok } = await db.from("app_settings").select("value").eq("key", "qbo_refresh_token").single();
const cred = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64");
const tr = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
  method: "POST",
  headers: { Authorization: `Basic ${cred}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.value }).toString(),
});
if (!tr.ok) { console.error(await tr.text()); process.exit(1); }
const t = await tr.json();
if (t.refresh_token && t.refresh_token !== tok.value)
  await db.from("app_settings").upsert({ key: "qbo_refresh_token", value: t.refresh_token }, { onConflict: "key" });

const Q = async (q) => {
  const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${process.env.QUICKBOOKS_REALM_ID}/query?query=${encodeURIComponent(q)}&minorversion=65`,
    { headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).QueryResponse ?? {};
};
const pageAll = async (entity) => {
  const out = [];
  for (let s = 1; ; s += 1000) {
    const p = (await Q(`SELECT * FROM ${entity} ORDERBY Id STARTPOSITION ${s} MAXRESULTS 1000`))[entity] ?? [];
    out.push(...p);
    if (p.length < 1000) break;
  }
  return out;
};

console.log("Fetching QBO customers + full transaction history…");
const [customers, invoices, receipts, payments] = await Promise.all([
  pageAll("Customer"), pageAll("Invoice"), pageAll("SalesReceipt"), pageAll("Payment"),
]);
console.log(`  ${customers.length} customers · ${invoices.length} invoices · ${receipts.length} sales receipts · ${payments.length} payments\n`);

// transaction rollup per customer id
const hist = new Map();
const bump = (cid, kind, amt, date) => {
  if (!cid) return;
  const h = hist.get(cid) ?? { inv: 0, rcpt: 0, pay: 0, total: 0, last: "" };
  h[kind]++; h.total += Number(amt ?? 0);
  if (date && date > h.last) h.last = date;
  hist.set(cid, h);
};
for (const i of invoices) bump(i.CustomerRef?.value, "inv", i.TotalAmt, i.TxnDate);
for (const r of receipts) bump(r.CustomerRef?.value, "rcpt", r.TotalAmt, r.TxnDate);
for (const p of payments) bump(p.CustomerRef?.value, "pay", p.TotalAmt, p.TxnDate);

const norm = (x) => (x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const NOISE = new Set(["inc", "ltd", "limited", "llc", "llp", "corp", "corporation", "co", "company",
  "incorporated", "canada", "usa", "america", "intl", "international", "bookstore", "bookstores",
  "store", "stores", "university", "college", "the", "of", "and", "at", "for"]);
const keyOf = (x) => norm(x).split(" ").filter((w) => w && !NOISE.has(w)).sort().join(" ");

// every QBO record indexed by both of its name keys
const byKey = new Map();
for (const c of customers) {
  for (const k of new Set([keyOf(c.DisplayName), keyOf(c.CompanyName)].filter(Boolean))) {
    if (!byKey.has(k)) byKey.set(k, []);
    if (!byKey.get(k).some((x) => x.Id === c.Id)) byKey.get(k).push(c);
  }
}

const { data: orgs } = await db.from("organizations")
  .select("id, name, type, membership_status, quickbooks_customer_id, is_test")
  .eq("is_test", false).order("type").order("name");

const fmt = (c) => {
  const h = hist.get(String(c.Id));
  const activity = h ? `${h.inv}inv/${h.rcpt}rcpt/${h.pay}pay $${h.total.toFixed(2)} last ${h.last}` : "no transactions";
  return { id: String(c.Id), disp: c.DisplayName ?? "—", comp: c.CompanyName ?? "", created: (c.MetaData?.CreateTime ?? "?").slice(0, 10), bal: Number(c.Balance ?? 0), active: c.Active !== false, activity, txns: h ? h.inv + h.rcpt + h.pay : 0 };
};
// survivor heuristic: most transactions, then non-zero balance, then oldest record
const rank = (a, b) => b.txns - a.txns || (b.bal !== 0) - (a.bal !== 0) || (a.created < b.created ? -1 : 1);

const rows = [], noMatch = [], claimed = new Set();
for (const o of orgs ?? []) {
  const cands = new Map();
  for (const c of byKey.get(keyOf(o.name)) ?? []) cands.set(String(c.Id), c);
  if (o.quickbooks_customer_id) {
    const cur = customers.find((c) => String(c.Id) === String(o.quickbooks_customer_id));
    if (cur) cands.set(String(cur.Id), cur);
  }
  const list = [...cands.values()].map(fmt).sort(rank);
  list.forEach((c) => claimed.add(c.id));
  if (!list.length) { noMatch.push(o); continue; }
  rows.push({ org: o, list, current: o.quickbooks_customer_id ? String(o.quickbooks_customer_id) : null, survivor: list[0].id });
}

let md = `# QBO ↔ DB full reconciliation\n\nGenerated ${new Date().toISOString()} · ${customers.length} QBO customers · ${orgs.length} non-test orgs · read-only\n\n`;
md += `Survivor = most transactions, then non-zero balance, then oldest record.\n\n`;

const multi = rows.filter((r) => r.list.length > 1);
md += `## A. Orgs with MORE THAN ONE QBO record — ${multi.length}\n\n`;
console.log("=".repeat(118));
console.log(`ORGS WITH MULTIPLE QBO RECORDS — ${multi.length}`);
console.log("=".repeat(118));
for (const r of multi.sort((a, b) => a.org.name.localeCompare(b.org.name))) {
  const needsRepoint = r.current && r.current !== r.survivor;
  console.log(`\n${r.org.name}   [${r.org.type}/${r.org.membership_status}]   currently → ${r.current ?? "UNLINKED"}${needsRepoint ? `   ⚠ REPOINT to ${r.survivor}` : ""}`);
  md += `\n### ${r.org.name} — *${r.org.type} / ${r.org.membership_status}*\n\nCurrently linked to **${r.current ?? "UNLINKED"}**${needsRepoint ? ` · ⚠ **repoint to ${r.survivor}**` : r.current ? " ✓" : ""}\n\n| | QBO Id | DisplayName | CompanyName | Created | Balance | Activity |\n|---|---|---|---|---|---|---|\n`;
  for (const c of r.list) {
    const mark = c.id === r.survivor ? "KEEP" : "dup ";
    const cur = c.id === r.current ? " ←linked" : "";
    console.log(`   ${mark} ${c.id.padEnd(5)} ${c.created}  bal $${c.bal.toFixed(2).padStart(9)}  ${c.disp.slice(0, 32).padEnd(33)} ${c.activity}${cur}`);
    md += `| ${c.id === r.survivor ? "**KEEP**" : "dup"}${cur ? " ←linked" : ""} | ${c.id} | ${c.disp} | ${c.comp || "—"} | ${c.created} | $${c.bal.toFixed(2)} | ${c.activity} |\n`;
  }
}

const single = rows.filter((r) => r.list.length === 1);
const mismatch = single.filter((r) => r.current !== r.survivor);
md += `\n## B. Single-record orgs whose link is missing or wrong — ${mismatch.length}\n\n| Org | Type | Currently | Should be | QBO DisplayName | Activity |\n|---|---|---|---|---|---|\n`;
console.log("\n" + "=".repeat(118));
console.log(`SINGLE-RECORD ORGS, LINK MISSING OR WRONG — ${mismatch.length}`);
console.log("=".repeat(118));
for (const r of mismatch.sort((a, b) => a.org.name.localeCompare(b.org.name))) {
  console.log(`   ${r.org.name.slice(0, 40).padEnd(41)} ${String(r.current ?? "NULL").padEnd(6)} → ${r.survivor.padEnd(5)}  ${r.list[0].disp.slice(0, 30)}`);
  md += `| ${r.org.name} | ${r.org.type} | ${r.current ?? "NULL"} | **${r.survivor}** | ${r.list[0].disp} | ${r.list[0].activity} |\n`;
}

md += `\n## C. Orgs with NO QBO record at all — ${noMatch.length}\n\n| Org | Type | Status |\n|---|---|---|\n`;
console.log("\n" + "=".repeat(118));
console.log(`ORGS WITH NO QBO RECORD — ${noMatch.length}`);
console.log("=".repeat(118));
for (const o of noMatch) {
  console.log(`   ${o.name.slice(0, 46).padEnd(47)} ${o.type} / ${o.membership_status}`);
  md += `| ${o.name} | ${o.type} | ${o.membership_status ?? "—"} |\n`;
}

const orphans = customers.filter((c) => !claimed.has(String(c.Id))).map(fmt).filter((c) => c.txns > 0 || c.bal !== 0);
md += `\n## D. QBO customers matching no org, that have activity — ${orphans.length}\n\n| QBO Id | DisplayName | CompanyName | Created | Balance | Activity |\n|---|---|---|---|---|---|\n`;
console.log("\n" + "=".repeat(118));
console.log(`QBO CUSTOMERS MATCHING NO ORG, WITH ACTIVITY — ${orphans.length}`);
console.log("=".repeat(118));
for (const c of orphans.sort((a, b) => b.txns - a.txns)) {
  console.log(`   ${c.id.padEnd(5)} ${c.disp.slice(0, 38).padEnd(39)} ${c.activity}`);
  md += `| ${c.id} | ${c.disp} | ${c.comp || "—"} | ${c.created} | $${c.bal.toFixed(2)} | ${c.activity} |\n`;
}

const path = new URL("./qbo-full-reconcile.md", import.meta.url).pathname;
writeFileSync(path, md);
console.log(`\n\nReport → ${path}`);
console.log(`\nSUMMARY: ${multi.length} orgs with duplicates · ${mismatch.length} single-record links to fix · ${noMatch.length} orgs with no QBO record · ${orphans.length} active orphans`);
