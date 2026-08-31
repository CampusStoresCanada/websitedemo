#!/usr/bin/env npx tsx
/**
 * One-time repair of `memberships.expires_at` drift.
 *
 * `memberships.expires_at` was populated by the Phase 4 Stage 0 backfill and
 * then had no continuous writer, so it froze while
 * `organizations.membership_expires_at` advanced on every renewal payment.
 * `activateMembershipRenewal` now mirrors it (2026-08-31), but that only fires
 * on the NEXT payment — orgs that already paid stay drifted until their 2027
 * renewal. This closes the existing gap.
 *
 * Direction: `organizations.membership_expires_at` → `memberships.expires_at`.
 * The org column is what every live consumer reads today (the renewal cron's
 * gate included); `memberships.expires_at` has exactly two readers, both
 * fallbacks in lib/elections/service.ts.
 *
 * ⛔ It does NOT blindly copy. Each org's expiry must be corroborated by a real
 * payment on one of the three paths — dues can arrive as a line item inside a
 * booth checkout, or as a pre-org booth payment that never creates an invoice
 * at all. Anything uncorroborated is reported and left alone for a human.
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
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log(`\n${"=".repeat(86)}`);
console.log(`  memberships.expires_at drift repair  ${APPLY ? "— APPLY" : "— DRY RUN (no writes)"}`);
console.log(`${"=".repeat(86)}\n`);

// ── Every org holding a membership row, drifted or not ────────────────────
const { data: orgs, error: orgErr } = await db
  .from("organizations")
  .select("id, name, type, membership_status, archived_at, is_test, membership_expires_at, memberships(id, program_key, expires_at)")
  .order("name");

if (orgErr) {
  console.error(`Failed to query organizations: ${orgErr.message}`);
  process.exit(1);
}

type MembershipRow = { id: string; program_key: string; expires_at: string | null };
const drifted = (orgs ?? []).flatMap((o) => {
  const rows = ((o.memberships ?? []) as MembershipRow[]).filter(
    (m) => (m.expires_at ?? null) !== (o.membership_expires_at ?? null)
  );
  return rows.map((m) => ({ org: o, membership: m }));
});

if (drifted.length === 0) {
  console.log("  No drift — every memberships.expires_at already matches its organization.\n");
  process.exit(0);
}

const orgIds = [...new Set(drifted.map((d) => d.org.id))];

// ── Corroboration: all three payment paths ────────────────────────────────
const [invRes, ordRes, prosRes] = await Promise.all([
  db.from("invoices")
    .select("organization_id, billing_period_end")
    .in("organization_id", orgIds)
    .eq("status", "paid")
    .in("type", ["membership", "partnership"])
    .not("billing_period_end", "is", null),
  db.from("conference_orders")
    .select("organization_id, paid_at, conference_order_items(entity_purchases(conference_entities(kind)))")
    .in("organization_id", orgIds)
    .not("paid_at", "is", null),
  // Path 2: pre-org booth purchase, split booth/dues, never creates an invoice.
  // Linked to an org only through signup_applications, never by name.
  db.from("prospective_booth_payments")
    .select("membership_amount_cents, paid_at, signup_applications!inner(organization_id)")
    .not("paid_at", "is", null)
    .gt("membership_amount_cents", 0),
]);

const paidThrough = new Map<string, Set<string>>();
for (const i of invRes.data ?? []) {
  const set = paidThrough.get(i.organization_id) ?? new Set<string>();
  set.add(i.billing_period_end as string);
  paidThrough.set(i.organization_id, set);
}

const bundledOrgs = new Set<string>();
for (const o of ordRes.data ?? []) {
  const kinds = (o.conference_order_items ?? []).flatMap((oi: any) =>
    (oi.entity_purchases ?? []).map((ep: any) => ep.conference_entities?.kind)
  );
  if (kinds.includes("membership_renewal")) bundledOrgs.add(o.organization_id);
}

const prospectiveOrgs = new Set<string>();
for (const p of (prosRes.data ?? []) as any[]) {
  const orgId = p.signup_applications?.organization_id;
  if (orgId) prospectiveOrgs.add(orgId);
}

function corroborate(orgId: string, expiry: string | null): string | null {
  if (!expiry) return null; // nothing to justify; see the null-expiry note below
  if (paidThrough.get(orgId)?.has(expiry)) return "paid dues invoice";
  if (bundledOrgs.has(orgId)) return "bundled conference renewal";
  if (prospectiveOrgs.has(orgId)) return "prospective booth payment";
  return null;
}

// ── Report ────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const rows = drifted.map((d) => ({
  ...d,
  evidence: corroborate(d.org.id, d.org.membership_expires_at),
}));
const ok = rows.filter((r) => r.evidence !== null);
const held = rows.filter((r) => r.evidence === null);

console.log(`  ${pad("ORG", 32)}${pad("TYPE", 15)}${pad("ORG EXPIRY", 13)}${pad("MEMBERSHIPS", 13)}EVIDENCE`);
console.log(`  ${"-".repeat(84)}`);
for (const r of [...ok, ...held]) {
  const flags = [
    r.org.archived_at ? "archived" : null,
    r.org.is_test ? "TEST" : null,
    r.org.membership_status === "canceled" ? "canceled" : null,
  ].filter(Boolean);
  console.log(
    `  ${pad(r.org.name, 32)}${pad(String(r.org.type ?? "?"), 15)}` +
      `${pad(r.org.membership_expires_at ?? "NULL", 13)}${pad(r.membership.expires_at ?? "NULL", 13)}` +
      `${r.evidence ?? "⛔ UNCORROBORATED — held"}${flags.length ? `  [${flags.join(", ")}]` : ""}`
  );
}

console.log(`\n  ${rows.length} drifted row(s): ${ok.length} corroborated, ${held.length} held back.`);
if (held.length) {
  console.log(`  ⛔ Held rows are NOT written. An expiry with no payment behind it is not a`);
  console.log(`     sync bug to paper over — resolve it before repairing the mirror.`);
}

if (!APPLY) {
  console.log(`\n  DRY RUN — nothing written. Re-run with --apply to commit.\n`);
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────────────────
console.log(`\n  Applying to ${ok.length} membership row(s)…`);
let updated = 0, failed = 0;
let skipped = 0;
for (const r of ok) {
  // Compare-and-set on the value actually read, so a concurrent write — the
  // new activateMembershipRenewal mirror firing mid-run, say — is skipped
  // rather than clobbered. `.is()` only accepts null/boolean, so a real date
  // has to go through `.eq()`.
  let q = db
    .from("memberships")
    .update({ expires_at: r.org.membership_expires_at, updated_at: new Date().toISOString() })
    .eq("id", r.membership.id);
  q = r.membership.expires_at === null
    ? q.is("expires_at", null)
    : q.eq("expires_at", r.membership.expires_at);

  const { error, data } = await q.select("id");

  if (error) {
    console.error(`     ✗ ${r.org.name}: ${error.message}`);
    failed++;
    continue;
  }
  if (data?.length) updated++;
  else {
    console.log(`     ~ ${r.org.name}: skipped — value changed since it was read`);
    skipped++;
  }
}
console.log(`\n  memberships updated: ${updated}   skipped: ${skipped}   failures: ${failed}\n`);
