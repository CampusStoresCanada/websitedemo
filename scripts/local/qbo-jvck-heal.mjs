#!/usr/bin/env node
/**
 * One-off: post the single consolidated QBO Sales Receipt for JVCKENWOOD.
 *
 * Stripe collected this sale in two parts (the Sep 1 checkout at the wrong
 * dues price, plus the Sep 2 correction invoice paid Sep 8). The books get
 * ONE document for the whole sale, at the prices that should always have
 * applied. The Stripe split stays in Stripe, where it actually happened.
 *
 * Lines mirror resolveMiscReceiptDetails()'s prospective_booth branch exactly,
 * with membership at $600 rather than the $150 that was charged.
 *
 * Default is a DRY RUN. Pass --post to actually create the receipt.
 * The only write in dry-run mode is persisting a rotated OAuth refresh
 * token, exactly as lib/quickbooks/client.ts does.
 */
import { createClient } from "@supabase/supabase-js";

const POST = process.argv.includes("--post");
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const realmId = process.env.QUICKBOOKS_REALM_ID;
const apiBase =
  (process.env.QUICKBOOKS_ENVIRONMENT ?? "sandbox") === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

console.log(`mode: ${POST ? "POST (will create the receipt)" : "DRY RUN"}`);
console.log(`env: ${process.env.QUICKBOOKS_ENVIRONMENT}  realm: ${realmId}\n`);

// ── auth (mirrors lib/quickbooks/client.ts) ──────────────────────
const { data: tokenRow } = await db
  .from("app_settings")
  .select("value")
  .eq("key", "qbo_refresh_token")
  .single();
const refreshToken = tokenRow?.value ?? process.env.QUICKBOOKS_REFRESH_TOKEN;
if (!refreshToken) throw new Error("No QBO refresh token");

const credentials = Buffer.from(
  `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`
).toString("base64");
const tokenRes = await fetch(TOKEN_URL, {
  method: "POST",
  headers: {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString(),
});
if (!tokenRes.ok) {
  console.error(`token refresh failed (${tokenRes.status}):`, await tokenRes.text());
  process.exit(1);
}
const tokens = await tokenRes.json();
if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
  await db
    .from("app_settings")
    .upsert({ key: "qbo_refresh_token", value: tokens.refresh_token }, { onConflict: "key" });
  console.log("(rotated refresh token persisted, as the app does)\n");
}
const AT = tokens.access_token;

async function qb(method, path, body) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${apiBase}/v3/company/${realmId}${path}${sep}minorversion=65`, {
    method,
    headers: {
      Authorization: `Bearer ${AT}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`QB ${method} ${path} (${res.status}): ${await res.text()}`);
  return res.json();
}
const query = async (q) =>
  (await qb("GET", `/query?query=${encodeURIComponent(q)}`)).QueryResponse ?? {};

// ── 1. Who is this in QBO already? ───────────────────────────────
const NAME = "JVCKENWOOD Canada Inc.";
const DOC = "47fa5355-2a37-4261-8d"; // qboDocNumber(payment_id)

console.log("── existing QBO customers matching JVC / Kenwood ──");
const seen = new Map();
for (const term of ["JVC", "Kenwood"]) {
  for (const field of ["DisplayName", "CompanyName"]) {
    const qr = await query(
      `SELECT Id, DisplayName, CompanyName, PrimaryEmailAddr, Active FROM Customer WHERE ${field} LIKE '%${term}%'`
    );
    for (const c of qr.Customer ?? []) seen.set(c.Id, c);
  }
}
if (seen.size === 0) console.log("  (none — a new customer would be created)");
for (const c of seen.values()) {
  console.log(
    `  Id=${c.Id}  DisplayName=${JSON.stringify(c.DisplayName)}  CompanyName=${JSON.stringify(
      c.CompanyName ?? null
    )}  Active=${c.Active}  email=${c.PrimaryEmailAddr?.Address ?? "-"}`
  );
}

// ── 2. Is anything already posted for this sale? ─────────────────
console.log("\n── existing documents on this DocNumber / this customer ──");
for (const entity of ["SalesReceipt", "Invoice"]) {
  const qr = await query(
    `SELECT Id, DocNumber, TxnDate, TotalAmt FROM ${entity} WHERE DocNumber = '${DOC}'`
  );
  const rows = qr[entity] ?? [];
  console.log(`  ${entity} DocNumber=${DOC}: ${rows.length ? JSON.stringify(rows) : "none"}`);
}
for (const c of seen.values()) {
  const qr = await query(
    `SELECT Id, DocNumber, TxnDate, TotalAmt FROM SalesReceipt WHERE CustomerRef = '${c.Id}'`
  );
  console.log(`  SalesReceipts for customer ${c.Id}: ${JSON.stringify(qr.SalesReceipt ?? [])}`);
}

// ── 3. The payload ───────────────────────────────────────────────
const customerId = [...seen.values()].find(
  (c) => c.DisplayName === NAME || c.CompanyName === NAME
)?.Id;

const payload = {
  CustomerRef: { value: customerId ?? "<<NEW CUSTOMER — would be created>>" },
  Line: [
    {
      Amount: 4000.0,
      Description: "716",
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ItemRef: { value: "71" }, Qty: 1, TaxCodeRef: { value: "13" } },
    },
    {
      Amount: 600.0,
      Description: "CSC Partnership membership",
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ItemRef: { value: "33" }, Qty: 1, TaxCodeRef: { value: "13" } },
    },
  ],
  TxnDate: "2026-09-01",
  DocNumber: DOC,
  PrivateNote:
    "CSC prospective_booth payment ID: 47fa5355-2a37-4261-8dc2-4994310fd9d2. " +
    "Consolidated entry: Stripe collected this sale in two parts — $4,689.50 on 2026-09-01 " +
    "(checkout, dues underpriced at $150 by the proration defect fixed 2026-09-02) and $508.50 " +
    "on 2026-09-08 (correction invoice 3903F4E7-20624, Stripe in_1UBKbDCZmKhS0SHGrt9aCUGn). " +
    "Booked once at the correct prices; total $5,198.00 matches the two Stripe receipts. " +
    "The automated export failed on 2026-09-01 with an Intuit 504 on customer lookup.",
  CurrencyRef: { value: "CAD" },
  DepositToAccountRef: { value: "1150040001" },
};

console.log("\n── payload ──");
console.log(JSON.stringify(payload, null, 2));
console.log(
  "\nexpected: subtotal $4,600.00 + HST 13% $598.00 = $5,198.00" +
    "  (Stripe collected $4,689.50 + $508.50 = $5,198.00)"
);

if (!POST) {
  console.log("\nDRY RUN — nothing written to QuickBooks. Re-run with --post to create it.");
  process.exit(0);
}

// ── 4. Post ──────────────────────────────────────────────────────
if (!customerId) {
  const created = await qb("POST", "/customer", {
    DisplayName: NAME,
    CompanyName: NAME,
    PrimaryEmailAddr: { Address: "dklobucar@ca.jvckenwood.com" },
  });
  payload.CustomerRef = { value: created.Customer.Id };
  console.log(`\ncreated customer Id=${created.Customer.Id}`);
}

const result = await qb("POST", "/salesreceipt", payload);
const sr = result.SalesReceipt;
console.log(
  `\nPOSTED SalesReceipt Id=${sr.Id} DocNumber=${sr.DocNumber} TxnDate=${sr.TxnDate} TotalAmt=${sr.TotalAmt}`
);
console.log(JSON.stringify(sr, null, 2));
