#!/usr/bin/env npx tsx
/**
 * Finish the renewal-expiry backfill for Vendor Partners.
 *
 * The member cohort was seeded with membership_expires_at = <cycle start - 1
 * day> so the renewal cron could see them at rollover. The partner cohort was
 * left NULL, and renewalChargeRun (lib/renewal/jobs.ts:546) filters
 * `.not("membership_expires_at","is",null)` before its loop — so those orgs are
 * invisible to the gate no matter how overdue they are.
 *
 * This is a DATA repair, not a code change. activateRenewal
 * (lib/membership/renewal-activation.ts:220) only ever writes a FORWARD expiry,
 * so nothing in the app can produce the cycle-just-ending date on its own.
 *
 * Writes organizations.membership_expires_at AND memberships.expires_at (the
 * Phase-4 authoritative mirror), both guarded to `is null` so the script is
 * idempotent and can never overwrite a real date.
 *
 * Dry-run by default. Pass --apply to commit.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

const APPLY = process.argv.includes("--apply");
const ORG_TYPE = "Vendor Partner";
const INVOICE_TYPES = ["membership", "partnership"];
// Mirrors DRAFT_PREVIEW_ORG_IDS (lib/conference/draft-preview.ts) — the charge
// run excludes these, so the simulation must too.
const DRAFT_PREVIEW_ORG_IDS = [
  "032862cf-1b39-4911-93cc-e1fdc13df741",
  "1a5e240b-bf97-4534-93d5-b9b4cfe15bb3",
  "f7b3fee0-339f-404a-b77d-ec95f40e8f89",
];

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Target date, derived from policy rather than hardcoded ────────────────
const { data: policyRow } = await db
  .from("policy_values")
  .select("value_json, policy_sets!inner(is_active)")
  .eq("key", "renewal.cycle_start_month_day")
  .eq("policy_sets.is_active", true)
  .single();

const cycleStartMonthDay = String(policyRow?.value_json ?? "").replace(/"/g, "");
if (!/^\d{2}-\d{2}$/.test(cycleStartMonthDay)) {
  console.error(`Could not resolve renewal.cycle_start_month_day (got ${JSON.stringify(policyRow?.value_json)})`);
  process.exit(1);
}

const today = new Date();
const isoToday = today.toISOString().slice(0, 10);
/** Next cycle start on or after today, then step back one day. */
function nextCycleStart(from: string, monthDay: string): string {
  const year = Number(from.slice(0, 4));
  const candidate = `${year}-${monthDay}`;
  return candidate >= from ? candidate : `${year + 1}-${monthDay}`;
}
const cycleStart = nextCycleStart(isoToday, cycleStartMonthDay);
const TARGET_EXPIRY = new Date(new Date(`${cycleStart}T00:00:00Z`).getTime() - 86_400_000)
  .toISOString()
  .slice(0, 10);

console.log(`\n${"=".repeat(78)}`);
console.log(`  Partner renewal-expiry backfill  ${APPLY ? "— APPLY" : "— DRY RUN (no writes)"}`);
console.log(`${"=".repeat(78)}`);
console.log(`  today            ${isoToday}`);
console.log(`  cycle start      ${cycleStart}  (policy renewal.cycle_start_month_day = ${cycleStartMonthDay})`);
console.log(`  target expiry    ${TARGET_EXPIRY}\n`);

// ── Cohort ────────────────────────────────────────────────────────────────
const { data: orgs, error: orgErr } = await db
  .from("organizations")
  .select("id, name, membership_status, membership_expires_at, created_at, is_test, archived_at, type")
  .eq("type", ORG_TYPE)
  .eq("is_test", false)
  .is("archived_at", null)
  .is("membership_expires_at", null)
  .not("membership_status", "in", "(canceled,applied)")
  .order("name");

if (orgErr) {
  console.error(`Failed to query organizations: ${orgErr.message}`);
  process.exit(1);
}
if (!orgs?.length) {
  console.log("  Nothing to do — no partner org has a NULL membership_expires_at.\n");
  process.exit(0);
}

const orgIds = orgs.map((o) => o.id);

// ── Evidence of payment on every known path (see the "check all three
//    paths" rule — an org can be fully paid with zero invoice rows) ────────
const [invoicesRes, membershipsRes, ordersRes, prospectiveRes] = await Promise.all([
  db.from("invoices")
    .select("organization_id, status, amount_cents, billing_period_start, billing_period_end, paid_at, paid_out_of_band_at, type")
    .in("organization_id", orgIds)
    .in("type", INVOICE_TYPES),
  db.from("memberships").select("id, organization_id, program_key, expires_at").in("organization_id", orgIds),
  db.from("conference_orders")
    .select("organization_id, paid_at, conference_order_items(entity_purchases(conference_entities(kind)))")
    .in("organization_id", orgIds)
    .not("paid_at", "is", null),
  db.from("prospective_booth_payments")
    .select("company_name, membership_amount_cents, paid_at, linked_application_id")
    .not("paid_at", "is", null),
]);

const invoicesByOrg = new Map<string, NonNullable<typeof invoicesRes.data>>();
for (const inv of invoicesRes.data ?? []) {
  const list = invoicesByOrg.get(inv.organization_id) ?? [];
  list.push(inv);
  invoicesByOrg.set(inv.organization_id, list);
}
const membershipByOrg = new Map((membershipsRes.data ?? []).map((m) => [m.organization_id, m]));

const bundledRenewalOrgs = new Set<string>();
for (const order of ordersRes.data ?? []) {
  const kinds = (order.conference_order_items ?? []).flatMap((oi: any) =>
    (oi.entity_purchases ?? []).map((ep: any) => ep.conference_entities?.kind)
  );
  if (kinds.includes("membership_renewal")) bundledRenewalOrgs.add(order.organization_id);
}
const prospectiveNames = new Set(
  (prospectiveRes.data ?? [])
    .filter((p) => (p.membership_amount_cents ?? 0) > 0)
    .map((p) => (p.company_name ?? "").trim().toLowerCase())
);

// ── Classify ──────────────────────────────────────────────────────────────
type Row = {
  org: (typeof orgs)[number];
  openInvoice: { start: string | null; end: string | null; amount: number } | null;
  blockers: string[];
  memExpiry: string | null | undefined;
};

const rows: Row[] = orgs.map((org) => {
  const invs = invoicesByOrg.get(org.id) ?? [];
  const blockers: string[] = [];

  const paid = invs.filter((i) => i.status === "paid" || i.paid_at || i.paid_out_of_band_at);
  if (paid.length) blockers.push(`${paid.length} PAID dues invoice(s)`);
  if (bundledRenewalOrgs.has(org.id)) blockers.push("paid bundled conference renewal");
  if (prospectiveNames.has(org.name.trim().toLowerCase())) blockers.push("prospective booth payment incl. dues");

  const open = invs
    .filter((i) => i.status === "invoiced" || i.status === "pending_settlement")
    .sort((a, b) => (b.billing_period_start ?? "").localeCompare(a.billing_period_start ?? ""))[0];

  return {
    org,
    openInvoice: open
      ? { start: open.billing_period_start, end: open.billing_period_end, amount: open.amount_cents }
      : null,
    blockers,
    memExpiry: membershipByOrg.get(org.id)?.expires_at,
  };
});

const safe = rows.filter((r) => r.blockers.length === 0);
const blocked = rows.filter((r) => r.blockers.length > 0);

// ── Report ────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
console.log(`  ${pad("ORG", 34)}${pad("STATUS", 11)}${pad("OPEN INVOICE PERIOD", 25)}${pad("AMT", 8)}MEMBERSHIPS.expires_at`);
console.log(`  ${"-".repeat(94)}`);
for (const r of rows) {
  const period = r.openInvoice
    ? `${r.openInvoice.start ?? "?"} → ${r.openInvoice.end ?? "?"}`
    : "(no open invoice)";
  const amt = r.openInvoice ? `$${(r.openInvoice.amount / 100).toFixed(0)}` : "—";
  const mem = r.memExpiry === null ? "NULL" : r.memExpiry === undefined ? "(no row)" : String(r.memExpiry);
  const flag = r.blockers.length ? "  ⛔ " + r.blockers.join("; ") : "";
  console.log(`  ${pad(r.org.name, 34)}${pad(r.org.membership_status ?? "?", 11)}${pad(period, 25)}${pad(amt, 8)}${mem}${flag}`);
}

console.log(`\n  ${rows.length} partner org(s) with NULL expiry — ${safe.length} to backfill, ${blocked.length} skipped.`);

const mismatched = safe.filter((r) => r.openInvoice?.start && r.openInvoice.start !== TARGET_EXPIRY);
if (mismatched.length) {
  console.log(`\n  ⚠  ${mismatched.length} org(s) whose open invoice period start ≠ ${TARGET_EXPIRY}:`);
  for (const r of mismatched) console.log(`       ${r.org.name}: invoice starts ${r.openInvoice!.start}`);
}

// ── What the next charge run would do, given this change ──────────────────
const nextRun = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
const wouldTransition = safe.filter(
  (r) =>
    ["active", "reactivated"].includes(r.org.membership_status ?? "") &&
    !DRAFT_PREVIEW_ORG_IDS.includes(r.org.id) &&
    TARGET_EXPIRY <= nextRun &&
    r.openInvoice !== null
);
const notSelected = safe.filter((r) => !wouldTransition.includes(r));

console.log(`\n  ${"-".repeat(94)}`);
console.log(`  Simulated renewalChargeRun on ${nextRun} (status active/reactivated + expiry due + open invoice):`);
console.log(`     ${wouldTransition.length} org(s) would transition to grace`);
for (const r of notSelected) {
  const why = !["active", "reactivated"].includes(r.org.membership_status ?? "")
    ? `status is "${r.org.membership_status}"`
    : r.openInvoice === null
      ? "no open invoice"
      : "excluded";
  console.log(`     not selected: ${r.org.name} — ${why}`);
}

// ── Apply ─────────────────────────────────────────────────────────────────
if (!APPLY) {
  console.log(`\n  DRY RUN — nothing written. Re-run with --apply to commit.\n`);
  process.exit(0);
}

console.log(`\n  Applying to ${safe.length} org(s)…`);
let orgOk = 0, memOk = 0, failed = 0;
for (const r of safe) {
  const { error: e1, data: d1 } = await db
    .from("organizations")
    .update({ membership_expires_at: TARGET_EXPIRY })
    .eq("id", r.org.id)
    .is("membership_expires_at", null) // idempotent: never overwrite a real date
    .select("id");
  if (e1) { console.error(`     ✗ ${r.org.name} (organizations): ${e1.message}`); failed++; continue; }
  if (d1?.length) orgOk++;

  const mem = membershipByOrg.get(r.org.id);
  if (mem) {
    const { error: e2, data: d2 } = await db
      .from("memberships")
      .update({ expires_at: TARGET_EXPIRY })
      .eq("id", mem.id)
      .is("expires_at", null)
      .select("id");
    if (e2) { console.error(`     ✗ ${r.org.name} (memberships): ${e2.message}`); failed++; continue; }
    if (d2?.length) memOk++;
  }
}
console.log(`\n  organizations updated: ${orgOk}   memberships mirrored: ${memOk}   failures: ${failed}\n`);
