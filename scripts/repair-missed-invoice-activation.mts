#!/usr/bin/env npx tsx
/**
 * Repair a membership activation the `invoice.paid` webhook took but could
 * not complete.
 *
 * WHY THIS EXISTS (2026-09-14, KPU):
 * Editing a finalized invoice in the Stripe Dashboard creates a BRAND NEW
 * Stripe invoice with a NEW id (linked back by `from_invoice.action =
 * "revision"`) and voids the original. handleInvoicePaid()
 * (lib/stripe/webhook-processing.ts:856) looks the payment up with
 * `.eq("stripe_invoice_id", <new id>)` — which matches nothing, because our
 * `invoices` row still holds the OLD id. With no local invoice there is no
 * billing period, so settlePaidInvoiceMembership() takes its "no period buys
 * no time" branch: the org is lifted grace→active and the expiry is never
 * advanced. The org then reads `active` with a lapsed
 * `membership_expires_at`, and fails every membershipCoversConference()
 * gate — conference bursary CTA, booth purchase, registration.
 *
 * This is a DATA repair, not a code change. It re-runs the activation the
 * webhook would have run, through the one canonical writer
 * (activateMembershipRenewal), so the org expiry, the memberships mirror and
 * the `charge_succeeded` renewal_event all land exactly as a clean payment
 * would have produced them.
 *
 * SAFETY:
 * - Keyed on the REAL Stripe invoice id that was paid, which is the same key
 *   handleInvoicePaid() passes. If that event is ever replayed or swept by
 *   lib/stripe/reconcile.ts, the idempotency guard sees the charge_succeeded
 *   event and no-ops instead of double-activating.
 * - activateMembershipRenewal only ever writes a FORWARD expiry.
 * - Touches membership state only. It does NOT mark any invoice paid and
 *   does NOT enqueue a QuickBooks receipt — settling the books is a separate,
 *   human decision about amounts.
 *
 * Dry-run by default. Pass --apply to commit.
 *
 *   npx tsx scripts/repair-missed-invoice-activation.mts <org_id> <stripe_invoice_id> [--apply]
 */
import { readFileSync } from "node:fs";

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

const { createAdminClient } = await import("@/lib/supabase/admin");
const { activateMembershipRenewal } = await import("@/lib/membership/renewal-activation");

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const APPLY = process.argv.includes("--apply");
const [ORG_ID, STRIPE_INVOICE_ID] = args;

if (!ORG_ID || !STRIPE_INVOICE_ID) {
  console.error("Usage: repair-missed-invoice-activation.mts <org_id> <stripe_invoice_id> [--apply]");
  process.exit(1);
}

const db = createAdminClient();

// 1. The org as it stands.
const { data: org, error: orgErr } = await db
  .from("organizations")
  .select("id, name, type, membership_status, membership_expires_at")
  .eq("id", ORG_ID)
  .maybeSingle();

if (orgErr || !org) {
  console.error(`Organization ${ORG_ID} not found: ${orgErr?.message ?? "no row"}`);
  process.exit(1);
}

// 2. The payment itself — read from the stored webhook event, so the amount
//    and the billing period come from what Stripe actually said, never from
//    a value typed on the command line.
const { data: event } = await db
  .from("stripe_webhook_events")
  .select("id, type, processed_at, payload")
  .eq("type", "invoice.paid")
  .filter("payload->>id", "eq", STRIPE_INVOICE_ID)
  .maybeSingle();

if (!event) {
  console.error(`No stored invoice.paid webhook event for Stripe invoice ${STRIPE_INVOICE_ID}.`);
  console.error("Refusing to activate a payment this database has no record of.");
  process.exit(1);
}

const payload = event.payload as Record<string, unknown>;
const amountPaid = Number(payload.amount_paid ?? 0);
const revisionOf = (payload.from_invoice as { invoice?: string } | null)?.invoice ?? null;

if (amountPaid <= 0) {
  console.error(`Stored event ${event.id} shows amount_paid=${amountPaid}. Refusing.`);
  process.exit(1);
}

// 3. The period that payment bought. The revision's own period fields are
//    unreliable (Stripe copies the line-item stamp), so take the period from
//    the local invoice row the revision descends from — the row
//    createProgramInvoice wrote, which is where the real renewal period lives.
const { data: sourceInvoice } = await db
  .from("invoices")
  .select("id, status, billing_period_start, billing_period_end, total_cents")
  .eq("stripe_invoice_id", revisionOf ?? STRIPE_INVOICE_ID)
  .maybeSingle();

if (!sourceInvoice?.billing_period_end) {
  console.error(
    `No local invoice with a billing period found for ${revisionOf ?? STRIPE_INVOICE_ID}. ` +
      "Without a period this payment buys no time — nothing to repair."
  );
  process.exit(1);
}

const newExpiresAt = sourceInvoice.billing_period_end;
const billingPeriodStart = sourceInvoice.billing_period_start ?? newExpiresAt;

// 4. Has this already been repaired (or settled normally)?
const { data: existing } = await db
  .from("renewal_events")
  .select("id, created_at")
  .eq("organization_id", ORG_ID)
  .eq("event_type", "charge_succeeded")
  .contains("metadata", { idempotency_key: STRIPE_INVOICE_ID })
  .limit(1)
  .maybeSingle();

console.log(`\n  ${org.name}  (${org.type})`);
console.log(`  ─────────────────────────────────────────────`);
console.log(`  status                ${org.membership_status}`);
console.log(`  expires_at            ${org.membership_expires_at}  →  ${newExpiresAt}`);
console.log(`  period                ${billingPeriodStart} → ${newExpiresAt}`);
console.log(`  stripe invoice        ${STRIPE_INVOICE_ID}`);
console.log(`  revision of           ${revisionOf ?? "(none)"}`);
console.log(`  amount paid           $${(amountPaid / 100).toFixed(2)}`);
console.log(`  paid at               ${event.processed_at}`);
console.log(`  local invoice row     ${sourceInvoice.id} (status: ${sourceInvoice.status})`);
console.log(`  already activated     ${existing ? `YES — ${existing.created_at}` : "no"}`);

if (existing) {
  console.log(`\n  Nothing to do; activation already recorded.\n`);
  process.exit(0);
}

if (newExpiresAt <= (org.membership_expires_at ?? "")) {
  console.error(
    `\n  REFUSING: ${newExpiresAt} is not forward of the current expiry ${org.membership_expires_at}.\n`
  );
  process.exit(1);
}

if (!APPLY) {
  console.log(`\n  DRY RUN — re-run with --apply to commit.\n`);
  process.exit(0);
}

const result = await activateMembershipRenewal({
  organizationId: ORG_ID,
  newExpiresAt,
  billingPeriodStart,
  triggeredBy: "stripe_webhook",
  // The key handleInvoicePaid() would have used, so a replay or a
  // reconcile sweep dedupes against this repair instead of re-activating.
  idempotencyKey: STRIPE_INVOICE_ID,
  invoiceId: null,
  metadata: {
    repair: "missed_activation_stripe_invoice_revision",
    stripe_invoice_id: STRIPE_INVOICE_ID,
    stripe_invoice_revision_of: revisionOf,
    stripe_webhook_event_id: event.id,
    amount_paid_cents: amountPaid,
  },
});

if (!result.success) {
  console.error(`\n  ✗ activation failed: ${result.error}\n`);
  process.exit(1);
}

const { data: after } = await db
  .from("organizations")
  .select("membership_status, membership_expires_at")
  .eq("id", ORG_ID)
  .maybeSingle();

const { data: mirrored } = await db
  .from("memberships")
  .select("expires_at, status")
  .eq("organization_id", ORG_ID)
  .maybeSingle();

console.log(
  result.alreadyProcessed
    ? `\n  ✓ already processed — no change.`
    : `\n  ✓ activated.`
);
console.log(`  organizations.membership_expires_at   ${after?.membership_expires_at}  (status: ${after?.membership_status})`);
console.log(`  memberships.expires_at                ${mirrored?.expires_at}  (status: ${mirrored?.status})\n`);
