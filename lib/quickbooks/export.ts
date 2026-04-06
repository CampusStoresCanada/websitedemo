// QuickBooks export worker — Chunk 21
// Processes qbo_export_queue: creates QB invoices + payments for paid local invoices.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  findOrCreateQBCustomer,
  createQBInvoice,
  createQBPayment,
} from "./client";
import type { QBExportQueueRow } from "./types";
import type { Invoice } from "@/lib/stripe/types";

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const STALE_LEASE_THRESHOLD_MS = 10 * 60 * 1000; // reclaim after 10 minutes

// Fallback item ID keys in app_settings — used for membership/partnership until
// those setup flows are built. Conference invoices use conference_products.qbo_item_id.
const FALLBACK_ITEM_ID_KEYS: Record<string, string> = {
  membership: "qbo_item_id_membership",
  partnership: "qbo_item_id_partnership",
};

// ─────────────────────────────────────────────────────────────────
// Enqueue
// ─────────────────────────────────────────────────────────────────

/**
 * Idempotently enqueue an invoice for QB export.
 * Called from the Stripe webhook handler on invoice paid events.
 */
export async function enqueueQBExport(invoiceId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("qbo_export_queue")
    .insert({ invoice_id: invoiceId, status: "pending" })
    .select()
    .single();

  // Unique constraint on invoice_id means duplicate inserts are silently skipped
  if (error && error.code !== "23505") {
    console.error("[qbo] enqueueQBExport failed:", error);
  }
}

// ─────────────────────────────────────────────────────────────────
// Item ID resolution
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve the QB item ID for an invoice.
 * - Conference invoices: reads qbo_item_id from conference_products via invoice metadata.
 * - Membership/partnership: reads from app_settings (set at setup time).
 * - Unknown types: falls back to qbo_item_id_default in app_settings.
 */
async function resolveQBItemId(
  db: ReturnType<typeof createAdminClient>,
  invoiceType: string,
  invoiceMetadata: Record<string, unknown> | null
): Promise<string> {
  // Conference: look up item ID on the product record
  if (invoiceType === "conference") {
    const productId = invoiceMetadata?.conference_product_id as string | undefined;
    if (productId) {
      const { data: product } = await db
        .from("conference_products")
        .select("qbo_item_id, name")
        .eq("id", productId)
        .single();
      if (product?.qbo_item_id) return product.qbo_item_id;
      throw new Error(
        `Conference product "${product?.name ?? productId}" has no QB item linked. ` +
        `Open the product in the conference admin and select a QuickBooks item.`
      );
    }
    // Conference invoice without product ID — fall through to default
  }

  // Membership / partnership: app_settings
  const settingKey = FALLBACK_ITEM_ID_KEYS[invoiceType] ?? "qbo_item_id_default";
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", settingKey)
    .single();

  if (data?.value) return data.value;

  // Last resort: default item
  const { data: fallback } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "qbo_item_id_default")
    .single();

  if (fallback?.value) return fallback.value;

  throw new Error(
    `No QB item ID configured for invoice type "${invoiceType}". ` +
    `Set '${settingKey}' or 'qbo_item_id_default' in app_settings.`
  );
}

// ─────────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────────

export interface QBExportJobResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export async function quickbooksExportRun(): Promise<QBExportJobResult> {
  const db = createAdminClient();
  const result: QBExportJobResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  const now = new Date();

  // Reclaim stale leases before claiming new rows
  const staleThreshold = new Date(now.getTime() - STALE_LEASE_THRESHOLD_MS).toISOString();
  await db
    .from("qbo_export_queue")
    .update({ status: "retrying", lease_expires_at: null })
    .eq("status", "processing")
    .lt("lease_expires_at", staleThreshold);

  // Claim up to 10 actionable rows
  const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
  const { data: rows, error: claimError } = await db
    .from("qbo_export_queue")
    .update({ status: "processing", lease_expires_at: leaseExpiry })
    .or(
      `status.eq.pending,and(status.eq.retrying,next_retry_at.lte.${now.toISOString()})`
    )
    .select()
    .limit(10)
    .returns<QBExportQueueRow[]>();

  if (claimError) {
    console.error("[qbo] Failed to claim export queue rows:", claimError);
    return result;
  }

  if (!rows || rows.length === 0) return result;

  for (const row of rows) {
    result.processed++;
    try {
      await processExportRow(db, row);
      result.succeeded++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`invoice ${row.invoice_id}: ${message}`);
      await failRow(db, row, message);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Per-row processing
// ─────────────────────────────────────────────────────────────────

async function processExportRow(
  db: ReturnType<typeof createAdminClient>,
  row: QBExportQueueRow
): Promise<void> {
  // Load invoice + organization
  const { data: invoice, error: invErr } = await db
    .from("invoices")
    .select(`
      id, type, description, amount_cents, tax_amount_cents, total_cents,
      currency, status, paid_at, due_date, created_at, metadata,
      organization_id,
      organization:organizations(
        id, name, email, quickbooks_customer_id
      )
    `)
    .eq("id", row.invoice_id)
    .single();

  if (invErr || !invoice) throw new Error(`Invoice not found: ${row.invoice_id}`);

  const org = Array.isArray(invoice.organization)
    ? invoice.organization[0]
    : invoice.organization;
  if (!org) throw new Error(`Organization not found for invoice ${row.invoice_id}`);

  // Find or create QB customer
  const customer = await findOrCreateQBCustomer({
    DisplayName: org.name,
    ...(org.email ? { PrimaryEmailAddr: { Address: org.email } } : {}),
  });

  // Update org with QB customer ID if we just created it
  if (!org.quickbooks_customer_id) {
    await db
      .from("organizations")
      .update({ quickbooks_customer_id: customer.Id, last_synced_qbo_at: new Date().toISOString() })
      .eq("id", org.id);
  }

  // Skip if already has a QB invoice (re-run safety)
  if (row.qbo_invoice_id) {
    await markComplete(db, row, row.qbo_invoice_id, row.qbo_payment_id);
    return;
  }

  // Map and create QB invoice
  const itemId = await resolveQBItemId(db, invoice.type ?? "default", invoice.metadata as Record<string, unknown> | null);
  const invoiceInput = mapToQBInvoice(invoice as unknown as Invoice, customer.Id, itemId);
  const qbInvoice = await createQBInvoice(invoiceInput);

  let qbPaymentId: string | null = null;

  // If invoice is already paid, create the payment record in QB
  if (invoice.status === "paid" && invoice.paid_at) {
    const payment = await createQBPayment({
      CustomerRef: { value: customer.Id },
      TotalAmt: invoice.total_cents / 100,
      Line: [{
        Amount: invoice.total_cents / 100,
        LinkedTxn: [{ TxnId: qbInvoice.Id, TxnType: "Invoice" }],
      }],
      TxnDate: invoice.paid_at.slice(0, 10),
      CurrencyRef: { value: invoice.currency ?? "CAD" },
    });
    qbPaymentId = payment.Id;
  }

  await markComplete(db, row, qbInvoice.Id, qbPaymentId);
}

// ─────────────────────────────────────────────────────────────────
// Invoice mapping
// ─────────────────────────────────────────────────────────────────

function mapToQBInvoice(invoice: Invoice, customerQBId: string, itemId: string) {
  return {
    CustomerRef: { value: customerQBId },
    DocNumber: invoice.id,
    TxnDate: invoice.created_at.slice(0, 10),
    DueDate: invoice.due_date ?? undefined,
    CurrencyRef: { value: invoice.currency ?? "CAD" },
    Line: [
      {
        Amount: invoice.amount_cents / 100,
        Description: invoice.description,
        DetailType: "SalesItemLineDetail" as const,
        SalesItemLineDetail: {
          ItemRef: { value: itemId },
          UnitPrice: invoice.amount_cents / 100,
          Qty: 1,
        },
      },
    ],
    PrivateNote: `CSC Invoice ID: ${invoice.id}`,
  };
}

// ─────────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────────

async function markComplete(
  db: ReturnType<typeof createAdminClient>,
  row: QBExportQueueRow,
  qboInvoiceId: string,
  qboPaymentId: string | null
) {
  await db
    .from("qbo_export_queue")
    .update({
      status: "completed",
      qbo_invoice_id: qboInvoiceId,
      qbo_payment_id: qboPaymentId,
      processed_at: new Date().toISOString(),
      lease_expires_at: null,
      error_message: null,
    })
    .eq("id", row.id);
}

async function failRow(
  db: ReturnType<typeof createAdminClient>,
  row: QBExportQueueRow,
  message: string
) {
  const newRetryCount = row.retry_count + 1;
  const exhausted = newRetryCount >= row.max_retries;

  // Exponential backoff: 5m, 20m, 60m
  const backoffMinutes = [5, 20, 60][Math.min(row.retry_count, 2)];
  const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

  await db
    .from("qbo_export_queue")
    .update({
      status: exhausted ? "failed" : "retrying",
      retry_count: newRetryCount,
      next_retry_at: exhausted ? null : nextRetry,
      error_message: message,
      lease_expires_at: null,
    })
    .eq("id", row.id);
}
