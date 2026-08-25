#!/usr/bin/env npx tsx
/**
 * Repair a paid membership/partnership invoice whose activation never ran.
 *
 * Class of failure this fixes: the local invoice row reads "paid" and carries
 * a billing period, but no `charge_succeeded` renewal event exists and the
 * org's membership_expires_at was never advanced — i.e. handleInvoicePaid()
 * never ran for it. (Root case: invoices settled during the 2026-08-05
 * wrong-host webhook window whose local row was marked paid out-of-band
 * afterwards. lib/stripe/reconcile.ts cannot catch these because it only
 * sweeps invoiced/pending_settlement/draft, and these already read "paid".)
 *
 * Calls the same activateMembershipRenewal() the webhook does, keyed on the
 * Stripe invoice id, so it is idempotent and records the renewal event and
 * status transition exactly as a real delivery would have.
 *
 *   npx tsx scripts/repair-missed-invoice-activation.mts <invoice_id> [--apply]
 *
 * Without --apply it prints the current state and the intended change only.
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may already be set */
}

const invoiceId = process.argv[2];
const apply = process.argv.includes("--apply");
if (!invoiceId) {
  console.error("usage: repair-missed-invoice-activation.mts <invoice_id> [--apply]");
  process.exit(1);
}

const { createAdminClient } = await import("../lib/supabase/admin");
const { activateMembershipRenewal } = await import("../lib/membership/renewal-activation");

const db = createAdminClient() as any;

const { data: inv, error: invErr } = await db
  .from("invoices")
  .select("id, organization_id, type, status, total_cents, billing_period_start, billing_period_end, paid_at, stripe_invoice_id")
  .eq("id", invoiceId)
  .single();

if (invErr || !inv) {
  console.error(`Invoice ${invoiceId} not found: ${invErr?.message}`);
  process.exit(1);
}

const { data: org } = await db
  .from("organizations")
  .select("id, name, type, membership_status, membership_expires_at")
  .eq("id", inv.organization_id)
  .single();

const { data: existingEvents } = await db
  .from("renewal_events")
  .select("id, event_type, created_at")
  .eq("organization_id", inv.organization_id)
  .eq("event_type", "charge_succeeded");

console.log("── BEFORE ─────────────────────────────────────────");
console.log(`org           : ${org?.name} (${org?.type})`);
console.log(`status        : ${org?.membership_status}`);
console.log(`expires_at    : ${org?.membership_expires_at ?? "NULL"}`);
console.log(`invoice       : ${inv.type} ${inv.status} $${(inv.total_cents / 100).toFixed(2)}`);
console.log(`billing period: ${inv.billing_period_start} → ${inv.billing_period_end}`);
console.log(`stripe invoice: ${inv.stripe_invoice_id}`);
console.log(`charge_succeeded events: ${existingEvents?.length ?? 0}`);

if (inv.status !== "paid") {
  console.error(`\nABORT: invoice status is "${inv.status}", not "paid".`);
  process.exit(1);
}
if (!inv.billing_period_end) {
  console.error("\nABORT: invoice has no billing_period_end — nothing to activate.");
  process.exit(1);
}
if (!inv.stripe_invoice_id) {
  console.error("\nABORT: no stripe_invoice_id to use as the idempotency key.");
  process.exit(1);
}

console.log("\n── INTENDED CHANGE ────────────────────────────────");
console.log(`set organizations.membership_expires_at = ${inv.billing_period_end}`);
console.log(`record renewal_events charge_succeeded (idempotency_key = ${inv.stripe_invoice_id})`);
console.log(`status transition: only if current status is grace/locked/approved (currently "${org?.membership_status}")`);

if (!apply) {
  console.log("\nDry run — re-run with --apply to write.");
  process.exit(0);
}

const result = await activateMembershipRenewal({
  organizationId: inv.organization_id,
  newExpiresAt: inv.billing_period_end,
  billingPeriodStart: inv.billing_period_start ?? inv.billing_period_end,
  triggeredBy: "stripe_webhook",
  idempotencyKey: inv.stripe_invoice_id,
  invoiceId: inv.id,
  metadata: {
    repair: "missed_webhook_activation",
    repaired_via: "scripts/repair-missed-invoice-activation.mts",
  },
});

console.log("\n── RESULT ─────────────────────────────────────────");
console.log(JSON.stringify(result, null, 2));

const { data: after } = await db
  .from("organizations")
  .select("membership_status, membership_expires_at")
  .eq("id", inv.organization_id)
  .single();

console.log("\n── AFTER ──────────────────────────────────────────");
console.log(`status     : ${after?.membership_status}`);
console.log(`expires_at : ${after?.membership_expires_at ?? "NULL"}`);
