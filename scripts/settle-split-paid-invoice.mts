#!/usr/bin/env npx tsx
/**
 * Settle an invoice that was paid in MORE THAN ONE receipt, and push it to
 * QuickBooks.
 *
 * WHY THIS EXISTS (2026-09-14, KPU):
 * When an assessment is corrected mid-cycle, the Stripe Dashboard revision
 * bills only the REMAINDER. The org has then paid the invoice across two
 * receipts — the original amount and the top-up — and neither our webhook nor
 * markInvoicePaidOutOfBand() can see that: the webhook matches on a Stripe id
 * the revision replaced, and markInvoicePaidOutOfBand() refuses any invoice in
 * a terminal status (`voided` included, which is what the revision leaves
 * behind). The invoice therefore sits `voided` and unpaid while the money is
 * in the bank.
 *
 * Worse, `enqueueQBExport()` has exactly ONE caller — handleInvoicePaid() in
 * lib/stripe/webhook-processing.ts. An invoice the webhook never matched never
 * reaches QuickBooks by any route, so the revenue and the GST are simply
 * absent from the books.
 *
 * ⛔ SAFETY — this script REFUSES to run unless the receipts sum EXACTLY to the
 * target invoice's total_cents. That check is the whole point: it is what
 * distinguishes "these two payments settle this assessment" from a guess. It
 * will not part-pay, over-pay, or round.
 *
 * ⛔ Only the ONE invoice representing the corrected assessment is marked paid.
 * Superseded assessments for the same period stay `voided` — marking those paid
 * too would double-count their cash in QuickBooks.
 *
 * Dry-run by default. Pass --apply to commit.
 *
 *   npx tsx scripts/settle-split-paid-invoice.mts <invoice_id> <receipt_cents,…> --paid-at=<iso> --external-id=<ref> [--apply]
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
const { enqueueQBExport } = await import("@/lib/quickbooks/export");

const APPLY = process.argv.includes("--apply");
const flag = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const [INVOICE_ID, RECEIPTS_RAW] = positional;
const PAID_AT = flag("paid-at");
const EXTERNAL_ID = flag("external-id");

if (!INVOICE_ID || !RECEIPTS_RAW || !PAID_AT || !EXTERNAL_ID) {
  console.error(
    "Usage: settle-split-paid-invoice.mts <invoice_id> <receipt_cents,…> --paid-at=<iso> --external-id=<ref> [--apply]"
  );
  process.exit(1);
}

const receipts = RECEIPTS_RAW.split(",").map((r) => Number(r.trim()));
if (receipts.some((r) => !Number.isInteger(r) || r <= 0)) {
  console.error(`Receipts must be positive integer cents. Got: ${RECEIPTS_RAW}`);
  process.exit(1);
}

const db = createAdminClient();

// Kept as one plain literal with no embedded relation: a concatenated select
// string, or a PostgREST embed, drops supabase-js back to GenericStringError
// and every field read below stops type-checking. The org is a second query.
const { data: invoice, error } = await db
  .from("invoices")
  .select("id, organization_id, type, description, status, amount_cents, tax_amount_cents, total_cents, billing_period_start, billing_period_end, paid_at, payment_source, stripe_invoice_id, metadata")
  .eq("id", INVOICE_ID)
  .maybeSingle();

if (error || !invoice) {
  console.error(`Invoice ${INVOICE_ID} not found: ${error?.message ?? "no row"}`);
  process.exit(1);
}

const received = receipts.reduce((a, b) => a + b, 0);

const { data: org } = await db
  .from("organizations")
  .select("name, quickbooks_customer_id")
  .eq("id", invoice.organization_id ?? "")
  .maybeSingle();

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

console.log(`\n  ${org?.name ?? invoice.organization_id}`);
console.log(`  ─────────────────────────────────────────────`);
console.log(`  invoice           ${invoice.id}`);
console.log(`  description       ${invoice.description}`);
console.log(`  period            ${invoice.billing_period_start} → ${invoice.billing_period_end}`);
console.log(`  status            ${invoice.status}  →  paid`);
console.log(`  net               ${money(invoice.amount_cents)}`);
console.log(`  tax               ${money(invoice.tax_amount_cents ?? 0)}`);
console.log(`  invoice total     ${money(invoice.total_cents)}`);
console.log(`  receipts          ${receipts.map(money).join("  +  ")}  =  ${money(received)}`);
console.log(`  paid_at           ${PAID_AT}`);
console.log(`  qbo customer      ${org?.quickbooks_customer_id ?? "(none — will be resolved on export)"}`);

// ⛔ The gate. Anything other than an exact match is a guess, and a guess here
// posts wrong revenue to QuickBooks.
if (received !== invoice.total_cents) {
  console.error(
    `\n  ⛔ REFUSING: receipts total ${money(received)} but the invoice total is ` +
      `${money(invoice.total_cents)} (out by ${money(Math.abs(received - invoice.total_cents))}).\n`
  );
  process.exit(1);
}
console.log(`  reconciles        ✓ exact`);

if (invoice.status === "paid") {
  console.log(`\n  Already marked paid at ${invoice.paid_at}. Nothing to do.\n`);
  process.exit(0);
}

if (!APPLY) {
  console.log(`\n  DRY RUN — re-run with --apply to commit.\n`);
  process.exit(0);
}

const now = new Date().toISOString();

const { error: updErr } = await db
  .from("invoices")
  .update({
    status: "paid",
    // Settled by hand across two channels rather than by one automatic one.
    // handleInvoicePaymentFailed() also treats "manual" as already-settled, so
    // a stray Stripe failure event can't knock this back out of paid.
    payment_source: "manual",
    external_payment_id: EXTERNAL_ID,
    paid_at: PAID_AT,
    reminder_suppressed_at: now,
    updated_at: now,
    metadata: {
      ...((invoice.metadata as Record<string, unknown>) ?? {}),
      settlement: {
        kind: "split_receipts",
        receipts_cents: receipts,
        total_received_cents: received,
        final_receipt_ref: EXTERNAL_ID,
        settled_by_script: "settle-split-paid-invoice.mts",
        settled_at: now,
      },
    },
  })
  .eq("id", INVOICE_ID);

if (updErr) {
  console.error(`\n  ✗ invoice update failed: ${updErr.message}\n`);
  process.exit(1);
}

// The only route to QuickBooks. handleInvoicePaid() is its sole other caller,
// so without this the revenue and GST never reach the books.
await enqueueQBExport(INVOICE_ID);

const { data: after } = await db
  .from("invoices")
  .select("status, paid_at, payment_source, external_payment_id, total_cents")
  .eq("id", INVOICE_ID)
  .maybeSingle();

const { data: queued } = await db
  .from("qbo_export_queue")
  .select("id, status, created_at")
  .eq("invoice_id", INVOICE_ID)
  .maybeSingle();

console.log(`\n  ✓ settled.`);
console.log(`  invoice           ${after?.status}  ${money(after?.total_cents ?? 0)}  paid_at ${after?.paid_at}`);
console.log(`  payment_source    ${after?.payment_source}  (ref ${after?.external_payment_id})`);
console.log(`  qbo_export_queue  ${queued ? `${queued.status} — queued ${queued.created_at}` : "NOT QUEUED"}\n`);
