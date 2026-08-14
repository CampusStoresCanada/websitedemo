// QuickBooks export worker — Chunk 21
// Processes qbo_export_queue: creates QB invoices + payments for paid local invoices.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveQBCustomer,
  createQBInvoice,
  createQBPayment,
  createQBRefundReceipt,
  qboDocNumber,
} from "./client";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { resolveOrgAdminEmails, resolveOrgPrimaryContactEmail } from "@/lib/supabase/user-lookup";
import { isFeatureEnabled } from "@/lib/data";
import type { QBExportQueueRow, QBMembershipRefundQueueRow } from "./types";
import type { Invoice } from "@/lib/stripe/types";

/**
 * Same fallback chain as ensureStripeCustomer (lib/stripe/billing.ts):
 * org_admin's login email, then a real contacts-table person, then
 * organizations.email as a last resort. QBO customer creation isn't even
 * gated on having an email at all (unlike Stripe, which errors loudly) —
 * it'll silently create a customer with a blank PrimaryEmailAddr, which is
 * how the org_admin bug went unnoticed there longer than it did in Stripe.
 */
async function resolveQBBillingEmail(
  db: ReturnType<typeof createAdminClient>,
  orgId: string,
  fallbackEmail: string | null
): Promise<string | null> {
  const adminEmails = await resolveOrgAdminEmails(db, orgId);
  if (adminEmails.length) return adminEmails[0];
  if (fallbackEmail) return fallbackEmail;
  return resolveOrgPrimaryContactEmail(db, orgId);
}

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const STALE_LEASE_THRESHOLD_MS = 10 * 60 * 1000; // reclaim after 10 minutes

// Fallback item ID keys in app_settings — used for membership/partnership until
// those setup flows are built. Conference invoice → QB item mapping is parked
// (not yet wired to the v3 catalog); conference invoices fall back to the default.
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

const MEMBERSHIP_PRICE_BANDS_KEY = "qbo_membership_price_bands";

interface MembershipPriceBand {
  maxAmountCents: number;
  itemId: string;
}

/**
 * Membership dues are priced per org by FTE (see lib/membership/pricing.ts),
 * not a fixed per-type price, so a single flat QB item can't represent it —
 * QB has a separate dues item per price tier. Configured in
 * /admin/settings/quickbooks as an ascending list of {maxAmountCents, itemId};
 * an invoice matches the first tier whose ceiling covers its amount, or the
 * top tier if it exceeds all configured ceilings. Returns null (falls through
 * to the flat qbo_item_id_membership) if no bands are configured.
 */
async function resolveMembershipTierItemId(
  db: ReturnType<typeof createAdminClient>,
  amountCents: number
): Promise<string | null> {
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", MEMBERSHIP_PRICE_BANDS_KEY)
    .single();

  if (!data?.value) return null;

  let bands: MembershipPriceBand[];
  try {
    bands = JSON.parse(data.value);
  } catch {
    return null;
  }
  if (!Array.isArray(bands) || bands.length === 0) return null;

  const sorted = [...bands].sort((a, b) => a.maxAmountCents - b.maxAmountCents);
  const match = sorted.find((band) => amountCents <= band.maxAmountCents);
  return (match ?? sorted[sorted.length - 1]).itemId || null;
}

/**
 * Resolve the QB item ID for an invoice.
 * - Membership: price-tier match first (see resolveMembershipTierItemId), then
 *   the flat qbo_item_id_membership, then qbo_item_id_default.
 * - Partnership: reads qbo_item_id_partnership from app_settings.
 * - Conference invoices: not yet wired to the v3 catalog (parked) — falls back to
 *   qbo_item_id_default like any other type.
 * - Unknown types: falls back to qbo_item_id_default in app_settings.
 */
async function resolveQBItemId(
  db: ReturnType<typeof createAdminClient>,
  invoiceType: string,
  amountCents: number
): Promise<string> {
  if (invoiceType === "membership") {
    const tierItemId = await resolveMembershipTierItemId(db, amountCents);
    if (tierItemId) return tierItemId;
  }

  // Membership (flat fallback) / partnership: app_settings
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
// Tax code resolution — membership/partnership are taxed by the member
// organization's own location (unlike conference commerce, which is one
// flat code per conference — see lib/quickbooks/conference-export.ts).
// ─────────────────────────────────────────────────────────────────

const MEMBERSHIP_TAX_CODES_KEY = "qbo_membership_tax_codes";
const OUTSIDE_CANADA_TAX_CODE_KEY = "qbo_tax_code_outside_canada";

interface MembershipTaxCodeMapping {
  province: string;
  taxCodeId: string;
}

/**
 * Resolve the GST/HST tax code for a membership/partnership invoice, from
 * the org's own province (or a single "outside Canada" fallback). Configured
 * in /admin/settings/quickbooks as a province → tax code list. No silent
 * guessing: an org whose province isn't in the mapping (and whose country
 * isn't clearly non-Canadian) throws, since misclassifying real revenue is
 * worse than a clear config error a human can fix.
 */
export async function resolveMembershipTaxCode(
  db: ReturnType<typeof createAdminClient>,
  org: { name: string; province: string | null; country: string | null }
): Promise<string> {
  // "Out of Canada" is a literal province value the partner application form
  // (app/apply/partner/PartnerApplicationForm.tsx) offers for non-Canadian
  // orgs — country isn't collected on that form and defaults to 'Canada' at
  // the DB level, so it can't be relied on here to detect these orgs.
  const isOutsideCanada =
    org.province?.trim().toLowerCase() === "out of canada" ||
    (!!org.country && org.country.trim().toLowerCase() !== "canada");

  if (org.province && !isOutsideCanada) {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", MEMBERSHIP_TAX_CODES_KEY)
      .single();

    if (data?.value) {
      try {
        const mappings: MembershipTaxCodeMapping[] = JSON.parse(data.value);
        const match = mappings.find(
          (m) => m.province.trim().toLowerCase() === org.province!.trim().toLowerCase()
        );
        if (match?.taxCodeId) return match.taxCodeId;
      } catch {
        // fall through to error below
      }
    }
  }

  if (isOutsideCanada) {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", OUTSIDE_CANADA_TAX_CODE_KEY)
      .single();
    if (data?.value) return data.value;
  }

  throw new Error(
    `"${org.name}" has no mapped QuickBooks tax code — ` +
    `${org.province ? `province "${org.province}" isn't in the mapping` : "the org has no province on file"}. ` +
    `Set it in /admin/settings/quickbooks.`
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
  const result: QBExportJobResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  if (!(await isFeatureEnabled("quickbooks"))) return result;

  const db = createAdminClient();
  const now = new Date();

  // Reclaim stale leases before claiming new rows. next_retry_at must be set
  // here (not left null) — the claim query below only picks up "retrying"
  // rows whose next_retry_at has passed, and next_retry_at.lte.<now> never
  // matches NULL, so a reclaimed row with no retry time would be stuck
  // forever instead of being picked back up.
  const staleThreshold = new Date(now.getTime() - STALE_LEASE_THRESHOLD_MS).toISOString();
  await db
    .from("qbo_export_queue")
    .update({ status: "retrying", lease_expires_at: null, next_retry_at: now.toISOString() })
    .eq("status", "processing")
    .lt("lease_expires_at", staleThreshold);

  // Claim up to 10 actionable rows. Two-step select-then-update-by-id rather
  // than update().or().select() in one call — that combination silently
  // returns an empty RETURNING set from PostgREST even though the UPDATE
  // itself applies correctly, which would make every claimed row invisible
  // to the worker (found while building the sibling conference-export
  // workers, which share this exact claim shape).
  const { data: candidates, error: findError } = await db
    .from("qbo_export_queue")
    .select("id")
    .or(
      `status.eq.pending,and(status.eq.retrying,next_retry_at.lte.${now.toISOString()})`
    )
    .limit(10);

  if (findError) {
    console.error("[qbo] Failed to find claimable export queue rows:", findError);
    return result;
  }
  if (!candidates || candidates.length === 0) return result;

  const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
  const { data: rows, error: claimError } = await db
    .from("qbo_export_queue")
    .update({ status: "processing", lease_expires_at: leaseExpiry })
    .in("id", candidates.map((c) => c.id))
    .select()
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
        id, name, email, quickbooks_customer_id, province, country
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
  const billingEmail = await resolveQBBillingEmail(db, org.id, org.email);
  const customer = await resolveQBCustomer(
    {
      DisplayName: org.name,
      ...(billingEmail ? { PrimaryEmailAddr: { Address: billingEmail } } : {}),
    },
    org.quickbooks_customer_id
  );

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
  const itemId = await resolveQBItemId(db, invoice.type ?? "default", invoice.amount_cents);
  const taxCodeRef = await resolveMembershipTaxCode(db, org);
  const invoiceInput = mapToQBInvoice(invoice as unknown as Invoice, customer.Id, itemId, taxCodeRef);
  const qbInvoice = await createQBInvoice(invoiceInput);

  let qbPaymentId: string | null = null;

  // If invoice is already paid, create the payment record in QB
  if (invoice.status === "paid" && invoice.paid_at) {
    const depositAccountId = await resolveStripeDepositAccountId(db);
    const payment = await createQBPayment({
      CustomerRef: { value: customer.Id },
      TotalAmt: invoice.total_cents / 100,
      Line: [{
        Amount: invoice.total_cents / 100,
        LinkedTxn: [{ TxnId: qbInvoice.Id, TxnType: "Invoice" }],
      }],
      TxnDate: invoice.paid_at.slice(0, 10),
      CurrencyRef: { value: invoice.currency ?? "CAD" },
      DepositToAccountRef: { value: depositAccountId },
    });
    qbPaymentId = payment.Id;
  }

  await markComplete(db, row, qbInvoice.Id, qbPaymentId);
}

// ─────────────────────────────────────────────────────────────────
// Invoice mapping
// ─────────────────────────────────────────────────────────────────

function mapToQBInvoice(invoice: Invoice, customerQBId: string, itemId: string, taxCodeRef: string) {
  return {
    CustomerRef: { value: customerQBId },
    DocNumber: qboDocNumber(invoice.id),
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
          TaxCodeRef: { value: taxCodeRef },
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

// ─────────────────────────────────────────────────────────────────
// Refund worker — membership/partnership invoice refunds never had a QBO
// counterpart (processRefund / processRefundUpdate only flip the local
// invoice status). This posts a Refund Receipt using the exact same
// customer/item/tax resolution as the original export, mirroring
// lib/quickbooks/conference-export.ts's receipt/refund pair.
// ─────────────────────────────────────────────────────────────────

/** Same app_settings key conference commerce reads — one Stripe deposit
 * account shared across every revenue type. Duplicated here (rather than
 * imported from conference-export.ts) to avoid a circular import between
 * the two export workers. */
async function resolveStripeDepositAccountId(
  db: ReturnType<typeof createAdminClient>
): Promise<string> {
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "qbo_stripe_deposit_account_id")
    .single();

  if (data?.value) return data.value;

  throw new Error(
    "No QB deposit account configured. Set 'qbo_stripe_deposit_account_id' in /admin/settings/quickbooks."
  );
}

/**
 * Idempotently enqueue an invoice refund for QB export. Called from both
 * processRefund (lib/stripe/billing.ts, admin-triggered) and
 * processRefundUpdate (lib/stripe/webhook-processing.ts, charge.refunded) —
 * the unique constraint on stripe_refund_id means whichever call site
 * reaches this first wins and the other is a silent no-op.
 */
export async function enqueueQBExportRefund(
  invoiceId: string,
  stripeRefundId: string,
  refundAmountCents: number
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("qbo_membership_refund_queue")
    .insert({
      invoice_id: invoiceId,
      stripe_refund_id: stripeRefundId,
      refund_amount_cents: refundAmountCents,
      status: "pending",
    })
    .select()
    .single();

  if (error && error.code !== "23505") {
    console.error("[qbo] enqueueQBExportRefund failed:", error);
  }
}

export async function quickbooksExportRefundRun(): Promise<QBExportJobResult> {
  const result: QBExportJobResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  if (!(await isFeatureEnabled("quickbooks"))) return result;

  const db = createAdminClient();
  const now = new Date();

  const staleThreshold = new Date(now.getTime() - STALE_LEASE_THRESHOLD_MS).toISOString();
  await db
    .from("qbo_membership_refund_queue")
    .update({ status: "retrying", lease_expires_at: null, next_retry_at: now.toISOString() })
    .eq("status", "processing")
    .lt("lease_expires_at", staleThreshold);

  // Two-step select-then-update-by-id — see quickbooksExportRun() above for
  // why update().or().select() in one call is avoided.
  const { data: candidates, error: findError } = await db
    .from("qbo_membership_refund_queue")
    .select("id")
    .or(`status.eq.pending,and(status.eq.retrying,next_retry_at.lte.${now.toISOString()})`)
    .limit(10);

  if (findError) {
    console.error("[qbo] Failed to find claimable membership refund queue rows:", findError);
    return result;
  }
  if (!candidates || candidates.length === 0) return result;

  const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
  const { data: rows, error: claimError } = await db
    .from("qbo_membership_refund_queue")
    .update({ status: "processing", lease_expires_at: leaseExpiry })
    .in("id", candidates.map((c) => c.id))
    .select()
    .returns<QBMembershipRefundQueueRow[]>();

  if (claimError) {
    console.error("[qbo] Failed to claim membership refund queue rows:", claimError);
    return result;
  }
  if (!rows || rows.length === 0) return result;

  for (const row of rows) {
    result.processed++;
    try {
      const { data: invoice, error: invErr } = await db
        .from("invoices")
        .select(`
          id, type, amount_cents, currency,
          organization_id,
          organization:organizations(id, name, email, quickbooks_customer_id, province, country)
        `)
        .eq("id", row.invoice_id)
        .single();

      if (invErr || !invoice) throw new Error(`Invoice not found: ${row.invoice_id}`);

      const org = Array.isArray(invoice.organization) ? invoice.organization[0] : invoice.organization;
      if (!org) throw new Error(`Organization not found for invoice ${row.invoice_id}`);

      const billingEmail = await resolveQBBillingEmail(db, org.id, org.email);
      const customer = await resolveQBCustomer(
        {
          DisplayName: org.name,
          ...(billingEmail ? { PrimaryEmailAddr: { Address: billingEmail } } : {}),
        },
        org.quickbooks_customer_id
      );

      // Refund reuses the item the ORIGINAL invoice was posted under — tier
      // resolution runs against invoice.amount_cents (the invoice's own
      // amount), not refund_amount_cents, so a partial refund doesn't get
      // misresolved into a lower price tier's item.
      const itemId = await resolveQBItemId(db, invoice.type ?? "default", invoice.amount_cents);
      const taxCodeRef = await resolveMembershipTaxCode(db, org);
      const depositAccountId = await resolveStripeDepositAccountId(db);

      const refundReceipt = await createQBRefundReceipt({
        CustomerRef: { value: customer.Id },
        Line: [
          {
            Amount: row.refund_amount_cents / 100,
            Description: `Refund — invoice ${row.invoice_id}`,
            DetailType: "SalesItemLineDetail",
            SalesItemLineDetail: {
              ItemRef: { value: itemId },
              Qty: 1,
              TaxCodeRef: { value: taxCodeRef },
            },
          },
        ],
        TxnDate: new Date().toISOString().slice(0, 10),
        DocNumber: qboDocNumber(row.invoice_id),
        PrivateNote: `CSC Invoice ID: ${row.invoice_id} — refund ${row.stripe_refund_id}`,
        CurrencyRef: { value: invoice.currency ?? "CAD" },
        DepositToAccountRef: { value: depositAccountId },
      });

      await db
        .from("qbo_membership_refund_queue")
        .update({
          status: "completed",
          qbo_refund_receipt_id: refundReceipt.Id,
          processed_at: new Date().toISOString(),
          lease_expires_at: null,
          error_message: null,
        })
        .eq("id", row.id);

      result.succeeded++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`invoice ${row.invoice_id}: ${message}`);
      await failRefundRow(db, row, message);
    }
  }

  return result;
}

async function failRefundRow(
  db: ReturnType<typeof createAdminClient>,
  row: QBMembershipRefundQueueRow,
  message: string
): Promise<void> {
  const newRetryCount = row.retry_count + 1;
  const exhausted = newRetryCount >= row.max_retries;
  const backoffMinutes = [5, 20, 60][Math.min(row.retry_count, 2)];
  const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

  await db
    .from("qbo_membership_refund_queue")
    .update({
      status: exhausted ? "failed" : "retrying",
      retry_count: newRetryCount,
      next_retry_at: exhausted ? null : nextRetry,
      error_message: message,
      lease_expires_at: null,
    })
    .eq("id", row.id);

  if (exhausted) {
    await raiseAlertIfNotOpen({
      ruleKey: `qbo_membership_refund_failed:${row.invoice_id}`,
      severity: "critical",
      message: `QuickBooks Refund Receipt export failed for invoice ${row.invoice_id}: ${message}`,
      details: { invoiceId: row.invoice_id, stripeRefundId: row.stripe_refund_id, error: message },
    });
  }
}
