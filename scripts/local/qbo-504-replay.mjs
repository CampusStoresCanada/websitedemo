#!/usr/bin/env node
/**
 * READ-ONLY. Replays the exact query that 504'd on 2026-09-01, to tell a
 * transient Intuit outage apart from a request that is systematically bad.
 * Also sizes the Customer table, since the failing call was `SELECT *`.
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const realmId = process.env.QUICKBOOKS_REALM_ID;
const apiBase =
  (process.env.QUICKBOOKS_ENVIRONMENT ?? "sandbox") === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

const { data: row } = await db.from("app_settings").select("value").eq("key", "qbo_refresh_token").single();
const credentials = Buffer.from(
  `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`
).toString("base64");
const tr = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
  method: "POST",
  headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.value }).toString(),
});
const tokens = await tr.json();
if (tokens.refresh_token && tokens.refresh_token !== row.value) {
  await db.from("app_settings").upsert({ key: "qbo_refresh_token", value: tokens.refresh_token }, { onConflict: "key" });
}
const AT = tokens.access_token;

async function timed(label, q) {
  const url = `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=65`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AT}`, Accept: "application/json" } });
    const ms = Date.now() - t0;
    const body = await res.text();
    console.log(`${label}: HTTP ${res.status} in ${ms}ms  (${body.length} bytes)`);
    return res.ok ? JSON.parse(body).QueryResponse ?? {} : null;
  } catch (e) {
    console.log(`${label}: THREW after ${Date.now() - t0}ms — ${e.message}`);
    return null;
  }
}

// The exact query from the error message, run 5x to catch intermittency.
const EXACT = "SELECT * FROM Customer WHERE DisplayName = 'JVCKENWOOD Canada Inc.'";
console.log(`replaying: ${EXACT}\n`);
for (let i = 1; i <= 5; i++) await timed(`  attempt ${i}`, EXACT);

console.log();
await timed("CompanyName leg (2nd query findQBCustomer makes)",
  "SELECT * FROM Customer WHERE CompanyName = 'JVCKENWOOD Canada Inc.'");

console.log();
const c = await timed("customer count", "SELECT COUNT(*) FROM Customer");
console.log("  ->", JSON.stringify(c));
const all = await timed("SELECT * FROM Customer (unfiltered, 1000 max — the expensive shape)",
  "SELECT * FROM Customer ORDERBY Id STARTPOSITION 1 MAXRESULTS 1000");
console.log("  -> rows:", (all?.Customer ?? []).length);
