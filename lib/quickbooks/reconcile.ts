// QuickBooks inbound reconciliation worker — Chunk 21
// Pulls QB payments and matches them to local invoices.
// Handles cheque/manual payments recorded in QB that Stripe doesn't know about.

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchQBPaymentsSince, type QBPaymentRecord } from "./client";
import { markInvoicePaidOutOfBand } from "@/lib/stripe/billing";

const LAST_RUN_KEY = "qbo_reconciliation_last_run";
const AMOUNT_TOLERANCE_CENTS = 0; // exact match required
const DATE_TOLERANCE_DAYS = 3;    // heuristic: paid_at within 3 days of QB txn date

export interface QBReconcileJobResult {
  fetched: number;
  matched: number;
  unmatched: number;
  skipped: number;  // already settled
  errors: string[];
}

export async function quickbooksInboundReconcileRun(): Promise<QBReconcileJobResult> {
  const db = createAdminClient();
  const result: QBReconcileJobResult = { fetched: 0, matched: 0, unmatched: 0, skipped: 0, errors: [] };

  // Determine fetch window — default to 30 days back on first run
  const { data: lastRunRow } = await db
    .from("app_settings")
    .select("value")
    .eq("key", LAST_RUN_KEY)
    .single();

  const since = lastRunRow?.value
    ? lastRunRow.value.slice(0, 10)  // YYYY-MM-DD
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Fetch QB payments
  let payments: QBPaymentRecord[];
  try {
    payments = await fetchQBPaymentsSince(since);
  } catch (err) {
    result.errors.push(`Failed to fetch QB payments: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  result.fetched = payments.length;

  for (const payment of payments) {
    try {
      await processInboundPayment(db, payment, result);
    } catch (err) {
      result.errors.push(
        `QB payment ${payment.Id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Update last-run timestamp
  await db
    .from("app_settings")
    .upsert({ key: LAST_RUN_KEY, value: new Date().toISOString() }, { onConflict: "key" });

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Per-payment processing
// ─────────────────────────────────────────────────────────────────

async function processInboundPayment(
  db: ReturnType<typeof createAdminClient>,
  payment: QBPaymentRecord,
  result: QBReconcileJobResult
): Promise<void> {
  // Idempotency: skip if already in reconciliation queue (any status)
  const { data: existing } = await db
    .from("qbo_reconciliation_queue")
    .select("id, status")
    .eq("qbo_payment_id", payment.Id)
    .maybeSingle();

  if (existing) {
    result.skipped++;
    return;
  }

  const amountCents = Math.round(payment.TotalAmt * 100);
  const paidAt = new Date(payment.TxnDate).toISOString();

  // Try to match to a local invoice
  const match = await findMatchingInvoice(db, payment, amountCents);

  if (match) {
    const { invoiceId, strategy, invoiceStatus } = match;

    // Skip if already settled — don't double-count
    if (["paid", "refunded_full", "refunded_partial", "voided"].includes(invoiceStatus)) {
      await db.from("qbo_reconciliation_queue").insert({
        qbo_payment_id: payment.Id,
        qbo_customer_id: payment.CustomerRef.value,
        amount_cents: amountCents,
        paid_at: paidAt,
        status: "ignored",
        matched_invoice_id: invoiceId,
        match_strategy: strategy,
        notes: `Invoice already in terminal status: ${invoiceStatus}`,
        resolved_at: new Date().toISOString(),
      });
      result.skipped++;
      return;
    }

    // Mark invoice paid out-of-band
    const settleResult = await markInvoicePaidOutOfBand(
      invoiceId,
      "quickbooks",
      payment.Id,
      paidAt
    );

    if (!settleResult.success) {
      throw new Error(`markInvoicePaidOutOfBand failed: ${settleResult.error}`);
    }

    // Record in reconciliation queue as matched
    await db.from("qbo_reconciliation_queue").insert({
      qbo_payment_id: payment.Id,
      qbo_customer_id: payment.CustomerRef.value,
      amount_cents: amountCents,
      paid_at: paidAt,
      status: "matched",
      matched_invoice_id: invoiceId,
      match_strategy: strategy,
      resolved_at: new Date().toISOString(),
    });

    result.matched++;
  } else {
    // No match — enqueue for manual review
    await db.from("qbo_reconciliation_queue").insert({
      qbo_payment_id: payment.Id,
      qbo_customer_id: payment.CustomerRef.value,
      amount_cents: amountCents,
      paid_at: paidAt,
      status: "pending_review",
    });

    result.unmatched++;
  }
}

// ─────────────────────────────────────────────────────────────────
// Matching logic — deterministic priority order
// ─────────────────────────────────────────────────────────────────

interface MatchResult {
  invoiceId: string;
  invoiceStatus: string;
  strategy: string;
}

async function findMatchingInvoice(
  db: ReturnType<typeof createAdminClient>,
  payment: QBPaymentRecord,
  amountCents: number
): Promise<MatchResult | null> {

  // Strategy 1: Payment links to a QB invoice we exported — look up via qbo_export_queue
  const linkedQBInvoiceIds = (payment.Line ?? [])
    .flatMap((line) => line.LinkedTxn ?? [])
    .filter((txn) => txn.TxnType === "Invoice")
    .map((txn) => txn.TxnId);

  if (linkedQBInvoiceIds.length > 0) {
    const { data: exportRows } = await db
      .from("qbo_export_queue")
      .select("invoice_id, invoices!inner(status)")
      .in("qbo_invoice_id", linkedQBInvoiceIds)
      .limit(1);

    if (exportRows && exportRows.length === 1) {
      const row = exportRows[0];
      const inv = Array.isArray(row.invoices) ? row.invoices[0] : row.invoices;
      return {
        invoiceId: row.invoice_id,
        invoiceStatus: (inv as { status: string }).status,
        strategy: "linked_qbo_invoice",
      };
    }

    // Multiple candidates via linked invoice — don't auto-settle
    if (exportRows && exportRows.length > 1) return null;
  }

  // Strategy 2: QB payment's DocNumber matches a local invoice ID (uuid format)
  // (some accountants enter the invoice reference manually)
  // We don't use this today but the field is stored if available

  // Strategy 3: Heuristic — QB customer → org → invoice with matching amount + date window
  const { data: orgRow } = await db
    .from("organizations")
    .select("id")
    .eq("quickbooks_customer_id", payment.CustomerRef.value)
    .maybeSingle();

  if (!orgRow) return null;

  const txnDate = new Date(payment.TxnDate);
  const windowStart = new Date(txnDate.getTime() - DATE_TOLERANCE_DAYS * 86400000).toISOString();
  const windowEnd = new Date(txnDate.getTime() + DATE_TOLERANCE_DAYS * 86400000).toISOString();

  const { data: candidates } = await db
    .from("invoices")
    .select("id, status, total_cents, due_date")
    .eq("organization_id", orgRow.id)
    .gte("due_date", windowStart.slice(0, 10))
    .lte("due_date", windowEnd.slice(0, 10))
    .not("status", "in", '("paid","refunded_full","refunded_partial","voided")');

  if (!candidates || candidates.length === 0) return null;

  const amountMatches = candidates.filter(
    (inv) => Math.abs(inv.total_cents - amountCents) <= AMOUNT_TOLERANCE_CENTS
  );

  // Only auto-settle if exactly one candidate matches — ambiguity goes to manual review
  if (amountMatches.length === 1) {
    return {
      invoiceId: amountMatches[0].id,
      invoiceStatus: amountMatches[0].status,
      strategy: "heuristic_customer_amount_date",
    };
  }

  return null;
}
