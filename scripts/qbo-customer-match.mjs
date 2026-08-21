#!/usr/bin/env node
/**
 * READ-ONLY QBO ↔ Supabase customer-match report.
 *
 * Reads: every QBO Customer (GET /query), the unlinked orgs in Supabase.
 * Writes: NOTHING, with one unavoidable exception — refreshing the OAuth
 * access token rotates the refresh token, and we persist it back to
 * app_settings exactly as lib/quickbooks/client.ts does. Skipping that
 * persist would leave production holding a superseded token.
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const APP_SETTINGS_KEY = "qbo_refresh_token";

for (const k of ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REALM_ID",
                 "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`Missing env: ${k}`); process.exit(1); }
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const realmId = process.env.QUICKBOOKS_REALM_ID;
const apiBase = (process.env.QUICKBOOKS_ENVIRONMENT ?? "sandbox") === "production"
  ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";

// ── auth (mirrors lib/quickbooks/client.ts) ──────────────────────
async function getAccessToken() {
  const { data } = await db.from("app_settings").select("value").eq("key", APP_SETTINGS_KEY).single();
  const refreshToken = data?.value ?? process.env.QUICKBOOKS_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("No QBO refresh token in app_settings or env");

  const credentials = Buffer.from(
    `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });
  if (!res.ok) throw new Error(`QB token refresh failed (${res.status}): ${await res.text()}`);
  const tokens = await res.json();

  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    await db.from("app_settings").upsert({ key: APP_SETTINGS_KEY, value: tokens.refresh_token }, { onConflict: "key" });
    console.log("  (rotated refresh token persisted to app_settings, as the app does)");
  }
  return tokens.access_token;
}

let ACCESS_TOKEN;
async function qbQuery(query) {
  const url = `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QB query failed (${res.status}): ${await res.text()}`);
  return (await res.json()).QueryResponse ?? {};
}

async function listAllCustomers() {
  const pageSize = 1000, all = [];
  for (let start = 1; ; start += pageSize) {
    const qr = await qbQuery(`SELECT * FROM Customer ORDERBY Id STARTPOSITION ${start} MAXRESULTS ${pageSize}`);
    const page = qr.Customer ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

// ── name normalisation + scoring ─────────────────────────────────
const SUFFIXES = new Set(["inc", "ltd", "limited", "llc", "llp", "corp", "corporation",
  "co", "company", "incorporated", "canada", "usa", "america", "intl", "international"]);
const STOP = new Set(["of", "the", "at", "and", "for"]);

const norm = (s) => (s ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/['’`]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim().replace(/\s+/g, " ");

const tokens = (s) => norm(s).split(" ").filter((t) => t && !STOP.has(t));
const core = (s) => tokens(s).filter((t) => !SUFFIXES.has(t));

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function score(orgName, qboName) {
  const nO = norm(orgName), nQ = norm(qboName);
  if (nO === nQ) return 1.0;
  const cO = core(orgName), cQ = core(qboName);
  if (cO.length && cQ.length && cO.slice().sort().join(" ") === cQ.slice().sort().join(" ")) return 0.95;
  let s = jaccard(cO, cQ);
  const jO = cO.join(" "), jQ = cQ.join(" ");
  if (jO && jQ && (jO.includes(jQ) || jQ.includes(jO))) s = Math.max(s, 0.8);
  // distinctive-token bonus: rare long words matching (e.g. "lakehead")
  const rare = cO.filter((t) => t.length >= 6 && cQ.includes(t));
  if (rare.length) s = Math.max(s, 0.55 + 0.1 * rare.length);
  return s;
}

// Steve's hints + known institutional renames.
const ALIASES = {
  "Agency 1008": ["Thread Wallets"],
  "Toronto Metropolitan University": ["Ryerson University", "Ryerson"],
};
const EXPECTED_NEW = new Set(["RAINS Sales Canada Inc.", "Sock Rocket"]);

// ── main ─────────────────────────────────────────────────────────
console.log("Authenticating with QuickBooks (production)…");
ACCESS_TOKEN = await getAccessToken();

console.log("Fetching every QBO customer…");
const customers = await listAllCustomers();
console.log(`  ${customers.length} customers in QBO\n`);

const { data: unlinked } = await db.from("organizations")
  .select("id, name, type, membership_status")
  .is("quickbooks_customer_id", null).eq("is_test", false)
  .in("membership_status", ["active", "approved"]).order("type").order("name");

const { data: linked } = await db.from("organizations")
  .select("name, quickbooks_customer_id").not("quickbooks_customer_id", "is", null);
const claimedBy = new Map((linked ?? []).map((o) => [String(o.quickbooks_customer_id), o.name]));

const rows = [];
for (const org of unlinked ?? []) {
  const probes = [org.name, ...(ALIASES[org.name] ?? [])];
  const scored = customers.map((c) => {
    let best = 0, via = null;
    for (const p of probes) {
      const s = score(p, c.DisplayName ?? "");
      if (s > best) { best = s; via = p === org.name ? null : p; }
    }
    // also try QBO's CompanyName, which often holds the legal/billing name
    if (c.CompanyName && c.CompanyName !== c.DisplayName) {
      for (const p of probes) {
        const s = score(p, c.CompanyName) * 0.98;
        if (s > best) { best = s; via = `${p} ~ CompanyName`; }
      }
    }
    return { c, s: best, via };
  }).filter((x) => x.s >= 0.35).sort((a, b) => b.s - a.s).slice(0, 3);

  const top = scored[0];
  let verdict;
  if (!top) verdict = EXPECTED_NEW.has(org.name) ? "NEW (expected)" : "NO MATCH";
  else if (top.s >= 0.999) verdict = "EXACT";
  else if (top.s >= 0.85) verdict = "STRONG";
  else if (top.s >= 0.55) verdict = "FUZZY — confirm";
  else verdict = EXPECTED_NEW.has(org.name) ? "NEW (expected)" : "WEAK — confirm";

  rows.push({ org, verdict, candidates: scored });
}

// ── output ───────────────────────────────────────────────────────
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
console.log("=".repeat(120));
console.log(pad("OUR ORG", 34) + pad("VERDICT", 16) + pad("QBO DisplayName", 38) + pad("Id", 6) + pad("Bal", 10) + "Score");
console.log("=".repeat(120));

let out = "# QBO customer match — unlinked active orgs\n\n";
out += `Generated ${new Date().toISOString()} · ${customers.length} QBO customers scanned · read-only\n\n`;

for (const t of ["Member", "Vendor Partner"]) {
  const group = rows.filter((r) => r.org.type === t);
  if (!group.length) continue;
  console.log(`\n--- ${t} (${group.length}) ---`);
  out += `\n## ${t} (${group.length})\n\n| Our org | Verdict | Best QBO match | QBO Id | Balance | Score | Notes |\n|---|---|---|---|---|---|---|\n`;
  for (const r of group) {
    const c = r.candidates[0];
    const claimed = c && claimedBy.has(String(c.c.Id)) ? `⚠ already linked to ${claimedBy.get(String(c.c.Id))}` : "";
    const notes = [c?.via ? `via "${c.via}"` : "", c && c.c.Active === false ? "INACTIVE in QBO" : "", claimed]
      .filter(Boolean).join("; ");
    console.log(
      pad(r.org.name, 34) + pad(r.verdict, 16) +
      pad(c ? c.c.DisplayName : "—", 38) + pad(c ? c.c.Id : "—", 6) +
      pad(c && c.c.Balance != null ? `$${Number(c.c.Balance).toFixed(2)}` : "—", 10) +
      (c ? c.s.toFixed(2) : "—") + (notes ? `   ${notes}` : "")
    );
    for (const alt of r.candidates.slice(1)) {
      console.log(pad("", 34) + pad("  alt →", 16) + pad(alt.c.DisplayName, 38) + pad(alt.c.Id, 6) + pad("", 10) + alt.s.toFixed(2));
    }
    const alts = r.candidates.slice(1).map((a) => `${a.c.DisplayName} (${a.c.Id}, ${a.s.toFixed(2)})`).join("<br>") || "—";
    out += `| ${r.org.name} | ${r.verdict} | ${c ? c.c.DisplayName : "—"} | ${c ? c.c.Id : "—"} | ${c && c.c.Balance != null ? "$" + Number(c.c.Balance).toFixed(2) : "—"} | ${c ? c.s.toFixed(2) : "—"} | ${notes || "—"} |\n`;
    if (r.candidates.length > 1) out += `| ↳ other candidates | | ${alts} | | | | |\n`;
  }
}

// ── phase 2: last membership transaction for the 6 Member orgs ───
console.log("\n\n" + "=".repeat(120));
console.log("MEMBER ORGS — most recent QBO invoices (does 'paid through Aug 31 2026' hold?)");
console.log("=".repeat(120));
out += `\n## Member orgs — recent QBO invoice history\n\n| Our org | QBO customer | Last invoices (TxnDate · DocNumber · Total · Balance) |\n|---|---|---|\n`;

for (const r of rows.filter((x) => x.org.type === "Member" && x.candidates[0]?.s >= 0.55)) {
  const cust = r.candidates[0].c;
  let inv = [];
  try {
    const qr = await qbQuery(`SELECT * FROM Invoice WHERE CustomerRef = '${cust.Id}' ORDERBY TxnDate DESC MAXRESULTS 6`);
    inv = qr.Invoice ?? [];
  } catch (e) { console.log(`  ${r.org.name}: query failed — ${e.message}`); }
  console.log(`\n${r.org.name}  →  ${cust.DisplayName} (Id ${cust.Id})`);
  if (!inv.length) console.log("  no invoices found");
  const cells = [];
  for (const i of inv) {
    const line = `${i.TxnDate} · #${i.DocNumber ?? "—"} · $${Number(i.TotalAmt).toFixed(2)} · bal $${Number(i.Balance).toFixed(2)}`;
    console.log("  " + line);
    cells.push(line);
  }
  out += `| ${r.org.name} | ${cust.DisplayName} (${cust.Id}) | ${cells.join("<br>") || "no invoices found"} |\n`;
}

const path = new URL("./qbo-match-report.md", import.meta.url).pathname;
writeFileSync(path, out);
console.log(`\n\nReport written to ${path}`);
