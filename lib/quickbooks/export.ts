// QuickBooks export worker — Chunk 21
// Processes qbo_export_queue: an invoice goes to QuickBooks when it is issued,
// dated the day Stripe issued it, and its payment follows when it is paid.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveQBCustomer,
  createQBInvoice,
  createQBPayment,
  createQBRefundReceipt,
  qboDocNumber,
  findQBDocumentByDocNumber,
  fetchQBBookCloseDate,
  getQBInvoice,
} from "./client";
import { openBooksDay, stripeAccountDay } from "./fiscal";
import { parseSupabaseTimestamp } from "@/lib/time/supabase-timestamp";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { resolveOrgAdminEmails, resolveOrgPrimaryContactEmail } from "@/lib/supabase/user-lookup";
import { isFeatureEnabled } from "@/lib/data";
import { adoptExistingReceipt, failQueueRow, releaseUnprocessedRows, startRunBudget } from "./queue";
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

// Manual conference invoices (booths sold by hand outside the v3 checkout —
// e.g. sponsor-benefit or pre-sale deals) have no catalog entity to resolve
// an item from, only a free-text description. Every one so far has been
// written as "... (Connected Exhibitor)" or "... (Exhibitor)", so route on
// that word rather than collapsing both booth types into one item.
const CONFERENCE_CONNECTED_ITEM_KEY = "qbo_item_id_conference_connected_booth";
const CONFERENCE_EXHIBITOR_ITEM_KEY = "qbo_item_id_conference_exhibitor_booth";

async function resolveManualConferenceInvoiceItemId(
  db: ReturnType<typeof createAdminClient>,
  description: string | null
): Promise<string | null> {
  if (!description) return null;
  const key = /connected/i.test(description)
    ? CONFERENCE_CONNECTED_ITEM_KEY
    : CONFERENCE_EXHIBITOR_ITEM_KEY;
  const { data } = await db.from("app_settings").select("value").eq("key", key).single();
  return data?.value || null;
}

// ─────────────────────────────────────────────────────────────────
// Enqueue
// ─────────────────────────────────────────────────────────────────

/**
 * Idempotently enqueue an invoice for QB export.
 * Called when an invoice is issued (finalizeAndSendInvoice), so QuickBooks
 * records it the day it goes out to the customer, and again from the Stripe
 * webhook when it is paid. The bookkeeper's rule (Ewa, 2026-11-03): an invoice
 * is recorded on the date it goes out, and its tax is reported then, paid or
 * not. Invoices issued before this rule shipped reach QuickBooks on the paid
 * event or in the Dec 1 sweep (sweepPreRuleInvoices), dated the day they post.
 * Anything dated into a quarter already filed moves to the first open day.
 *
 * An invoice already posted unpaid is opened again when it is paid, so the
 * worker posts its payment. Without that, the paid event's insert hits the
 * unique invoice_id, is skipped as a duplicate, and the payment never reaches
 * QuickBooks.
 */
export async function enqueueQBExport(invoiceId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("qbo_export_queue")
    .insert({ invoice_id: invoiceId, status: "pending" })
    .select()
    .single();

  if (error?.code === "23505") {
    const { error: reopenError } = await db
      .from("qbo_export_queue")
      .update({ status: "pending", retry_count: 0, next_retry_at: null, error_message: null })
      .eq("invoice_id", invoiceId)
      .eq("status", "completed")
      .is("qbo_payment_id", null);
    if (reopenError) console.error("[qbo] enqueueQBExport reopen failed:", reopenError);
    return;
  }
  if (error) {
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
export async function resolveMembershipTierItemId(
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
 * - Conference invoices: not wired to the v3 catalog (these are hand-created,
 *   off-checkout booth invoices with no catalog entity) — routed by the
 *   "Connected"/"Exhibitor" wording in the description, see
 *   resolveManualConferenceInvoiceItemId. Falls back to qbo_item_id_default
 *   if neither is configured.
 * - Unknown types: falls back to qbo_item_id_default in app_settings.
 */
async function resolveQBItemId(
  db: ReturnType<typeof createAdminClient>,
  invoiceType: string,
  amountCents: number,
  description: string | null = null
): Promise<string> {
  if (invoiceType === "membership") {
    const tierItemId = await resolveMembershipTierItemId(db, amountCents);
    if (tierItemId) return tierItemId;
  }

  if (invoiceType === "conference") {
    const manualItemId = await resolveManualConferenceInvoiceItemId(db, description);
    if (manualItemId) return manualItemId;
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
  await sweepPreRuleInvoices(db, stripeAccountDay(now));

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

  // Stop starting rows once the run's budget is spent. qbRequest now
  // retries, so a slow Intuit day costs real wall-clock, and overrunning
  // the 5-minute lease would let another worker reclaim a row still being
  // processed and post it twice. Unstarted rows go back on the queue and
  // wait for the next tick.
  const isOutOfBudget = startRunBudget();
  for (const [rowIndex, row] of rows.entries()) {
    if (isOutOfBudget()) {
      await releaseUnprocessedRows(
        db,
        "qbo_export_queue",
        rows.slice(rowIndex).map((r) => r.id)
      );
      break;
    }
    result.processed++;
    try {
      const held = await processExportRow(db, row);
      if (held) {
        result.failed++;
        result.errors.push(`invoice ${row.invoice_id}: ${held}`);
      } else {
        result.succeeded++;
      }
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`invoice ${row.invoice_id}: ${message}`);
      await failRow(db, row, err);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Per-row processing
// ─────────────────────────────────────────────────────────────────

/**
 * Invoices issued before invoices went to QuickBooks at issue reach it later,
 * dated the day they post: on payment, or in the sweep below. Dated by issue,
 * they would land in August, in a quarter already filed.
 */
export const POST_AT_ISSUE_SINCE = "2026-11-10";

/**
 * The day every pre-rule invoice still open goes to QuickBooks, dated that day
 * (agreed with Ewa, 2026-11-06). Void the ones that won't be paid before it.
 */
export const PRE_RULE_SWEEP_ON = "2026-12-01";
const PRE_RULE_SWEEP_DONE_KEY = "qbo_pre_rule_sweep_done";

/**
 * Queue every membership or partnership invoice issued before the rule that is
 * still open, once, on PRE_RULE_SWEEP_ON. Voided ones are not open, so they are
 * left out (and one voided in Stripe alone is skipped by the worker); the
 * worker posts the rest dated the day it runs.
 */
async function sweepPreRuleInvoices(db: ReturnType<typeof createAdminClient>, today: string): Promise<void> {
  if (today < PRE_RULE_SWEEP_ON) return;
  const { data: done } = await db.from("app_settings").select("value").eq("key", PRE_RULE_SWEEP_DONE_KEY).maybeSingle();
  if (done?.value) return;

  const { data: open, error } = await db
    .from("invoices")
    .select("id")
    .eq("status", "invoiced")
    .in("type", ["membership", "partnership"])
    .lt("created_at", POST_AT_ISSUE_SINCE);
  if (error) {
    console.error("[qbo] pre-rule sweep: could not list open invoices:", error);
    return;
  }
  for (const inv of open ?? []) await enqueueQBExport(inv.id);
  await db.from("app_settings").upsert(
    { key: PRE_RULE_SWEEP_DONE_KEY, value: JSON.stringify({ on: today, queued: (open ?? []).map((i) => i.id) }) },
    { onConflict: "key" }
  );
}

/** Returns the reason when the row was held for the bookkeeper, else null. */
async function processExportRow(
  db: ReturnType<typeof createAdminClient>,
  row: QBExportQueueRow
): Promise<string | null> {
  // Load invoice + organization
  const { data: invoice, error: invErr } = await db
    .from("invoices")
    .select(`
      id, type, description, amount_cents, tax_amount_cents, total_cents,
      currency, status, paid_at, due_date, created_at, metadata,
      organization_id, stripe_invoice_id,
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

  // Voided (or never issued) before it reached QuickBooks: nothing to record.
  if (!row.qbo_invoice_id && (invoice.status === "voided" || invoice.status === "draft")) {
    await markSkipped(db, row, `Not posted: the invoice is ${invoice.status}.`);
    return null;
  }

  // The day each document is recorded on. An invoice carries the day Stripe
  // issued it; one issued before the rule, the day it posts. Anything on or
  // before the bookkeeper's closing date moves to the first day after it.
  const { issueDate, stripeStatus } = await invoiceIssueDate(invoice);
  const needsInvoice = !row.qbo_invoice_id;
  // Voided in Stripe though our row never heard: still nothing to record.
  if (needsInvoice && (stripeStatus === "void" || stripeStatus === "uncollectible")) {
    await markSkipped(db, row, `Not posted: the invoice is ${stripeStatus} in Stripe.`);
    return null;
  }
  const needsPayment = !row.qbo_payment_id && invoice.status === "paid" && !!invoice.paid_at;
  const paidDay = needsPayment ? stripeAccountDay(parseSupabaseTimestamp(invoice.paid_at!)) : null;
  const closeDate = needsInvoice || needsPayment ? await fetchQBBookCloseDate() : null;
  const postsOn = issueDate < POST_AT_ISSUE_SINCE ? (paidDay ?? stripeAccountDay(new Date())) : issueDate;
  const invoiceDate = openBooksDay(postsOn, closeDate);
  const paymentDate = paidDay ? openBooksDay(paidDay, closeDate) : null;

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

  const meta = (invoice.metadata as Record<string, unknown> | null) ?? {};
  if (meta.correction_type === "tax_only" && typeof meta.corrects_invoice_id === "string") {
    return postTaxCorrection(db, row, invoice, meta.corrects_invoice_id, customer.Id, paymentDate);
  }

  // Already posted? The stored id covers a retry after the write-back landed.
  // If QBO created the invoice and we crashed before recording it, the row
  // still looks unposted and a retry would post a second one, so ask QBO
  // directly, by the DocNumber derived from this invoice's own id.
  let qbInvoiceId =
    row.qbo_invoice_id ?? (await findQBDocumentByDocNumber("Invoice", qboDocNumber(invoice.id)))?.Id ?? null;

  if (!qbInvoiceId) {
    // An invoice may name its own item and tax code (the CANCOLL invoice: the
    // registration's item at the conference's HST). Otherwise the type's item
    // and the buyer's province, as before.
    const itemId =
      typeof meta.qbo_item_id === "string" && meta.qbo_item_id
        ? meta.qbo_item_id
        : await resolveQBItemId(db, invoice.type ?? "default", invoice.amount_cents, invoice.description);
    const taxCodeRef =
      typeof meta.qbo_tax_code_ref === "string" && meta.qbo_tax_code_ref
        ? meta.qbo_tax_code_ref
        : await resolveMembershipTaxCode(db, org);
    const contact = await resolveInvoiceContactName(db, org.id, billingEmail);
    const invoiceInput = mapToQBInvoice(invoice as unknown as Invoice, customer.Id, itemId, taxCodeRef, invoiceDate, {
      issuedOn: issueDate,
      contact,
    });
    qbInvoiceId = (await createQBInvoice(invoiceInput)).Id;
  }

  // Posted when it was issued, unpaid at the time: now the payment, once,
  // dated the day it was paid.
  let qbPaymentId: string | null = row.qbo_payment_id;
  if (needsPayment && paymentDate) {
    qbPaymentId = await postPayment(db, customer.Id, qbInvoiceId, invoice.total_cents, invoice.currency, paymentDate);
  }

  await markComplete(db, row, qbInvoiceId, qbPaymentId);
  return null;
}

async function postPayment(
  db: ReturnType<typeof createAdminClient>,
  customerId: string,
  qbInvoiceId: string,
  totalCents: number,
  currency: string | null,
  txnDate: string
): Promise<string> {
  const depositAccountId = await resolveStripeDepositAccountId(db);
  const payment = await createQBPayment({
    CustomerRef: { value: customerId },
    TotalAmt: totalCents / 100,
    Line: [{
      Amount: totalCents / 100,
      LinkedTxn: [{ TxnId: qbInvoiceId, TxnType: "Invoice" }],
    }],
    TxnDate: txnDate,
    CurrencyRef: { value: currency ?? "CAD" },
    DepositToAccountRef: { value: depositAccountId },
  });
  return payment.Id;
}

/**
 * A tax-only correction (the August GST/HST fix: dues invoiced without tax,
 * then the tax invoiced on its own) is not a sale. The original QuickBooks
 * invoice already carries the tax as owing, so the correction posts no invoice
 * of its own: its payment pays down the original. Posted as an invoice it
 * came through as membership income with tax charged on the tax (Ewa,
 * 2026-11-06), which she then zeroed out by hand.
 *
 * The row records the original's QuickBooks id, so the paid event reopens it
 * for the payment like any other invoice posted unpaid.
 */
async function postTaxCorrection(
  db: ReturnType<typeof createAdminClient>,
  row: QBExportQueueRow,
  invoice: { id: string; total_cents: number; currency: string | null },
  correctsInvoiceId: string,
  customerId: string,
  paymentDate: string | null
): Promise<string | null> {
  const { data: original } = await db
    .from("qbo_export_queue")
    .select("qbo_invoice_id")
    .eq("invoice_id", correctsInvoiceId)
    .maybeSingle();
  if (!original?.qbo_invoice_id) {
    throw new Error(`The invoice this tax correction is for (${correctsInvoiceId}) is not in QuickBooks yet.`);
  }

  if (!row.qbo_payment_id && paymentDate) {
    const posted = await getQBInvoice(original.qbo_invoice_id);
    const owing = Math.round(posted.Balance * 100);
    if (owing < invoice.total_cents) {
      const reason =
        `Held for the bookkeeper: this tax correction is $${(invoice.total_cents / 100).toFixed(2)} but QuickBooks ` +
        `invoice ${original.qbo_invoice_id} has $${(owing / 100).toFixed(2)} open. Add the tax to that invoice in ` +
        `QuickBooks and Retry, or record the payment there and Skip.`;
      await holdRow(db, row, reason);
      return reason;
    }
    const paymentId = await postPayment(db, customerId, original.qbo_invoice_id, invoice.total_cents, invoice.currency, paymentDate);
    await markComplete(db, row, original.qbo_invoice_id, paymentId);
    return null;
  }

  await markComplete(db, row, original.qbo_invoice_id, row.qbo_payment_id);
  return null;
}

/**
 * The person an invoice is for, written into its memo so a search in
 * QuickBooks still finds them: the customer is the institution, because that
 * is the name on the cheque or the Stripe payout (Ewa, 2026-11-06).
 */
async function resolveInvoiceContactName(
  db: ReturnType<typeof createAdminClient>,
  orgId: string,
  email: string | null
): Promise<string | null> {
  const { data: contacts } = await db
    .from("contacts")
    .select("name, first_name, last_name, email, work_email, is_primary")
    .eq("organization_id", orgId)
    .is("archived_at", null);
  const lower = email?.toLowerCase() ?? null;
  const person =
    (lower && contacts?.find((c) => c.email?.toLowerCase() === lower || c.work_email?.toLowerCase() === lower)) ||
    contacts?.find((c) => c.is_primary);
  if (!person) return null;
  return [person.first_name, person.last_name].filter(Boolean).join(" ") || person.name || null;
}

/**
 * The day the invoice went out: when Stripe finalized it, which is the date
 * printed on the customer's invoice. An invoice with no Stripe invoice (or one
 * Stripe has no finalize time for) falls back to when we created it.
 */
async function invoiceIssueDate(
  invoice: { stripe_invoice_id: string | null; created_at: string }
): Promise<{ issueDate: string; stripeStatus: string | null }> {
  if (invoice.stripe_invoice_id) {
    // Loaded here, not at the top: the Stripe client throws at import without
    // its key, and much of the app imports this file only to enqueue.
    const { stripe } = await import("@/lib/stripe/client");
    const stripeInvoice = await stripe.invoices.retrieve(invoice.stripe_invoice_id);
    const finalizedAt = stripeInvoice.status_transitions?.finalized_at;
    const stripeStatus = stripeInvoice.status ?? null;
    if (finalizedAt) return { issueDate: stripeAccountDay(new Date(finalizedAt * 1000)), stripeStatus };
    return { issueDate: stripeAccountDay(parseSupabaseTimestamp(invoice.created_at)), stripeStatus };
  }
  return { issueDate: stripeAccountDay(parseSupabaseTimestamp(invoice.created_at)), stripeStatus: null };
}

// ─────────────────────────────────────────────────────────────────
// Invoice mapping
// ─────────────────────────────────────────────────────────────────

function mapToQBInvoice(
  invoice: Invoice,
  customerQBId: string,
  itemId: string,
  taxCodeRef: string,
  txnDate: string,
  note: { issuedOn: string; contact: string | null }
) {
  // A quantity and unit price when the invoice carries them (CANCOLL: N
  // registrations at $299.00), else one unit of the whole amount.
  const meta = ((invoice as { metadata?: unknown }).metadata as Record<string, unknown> | null) ?? {};
  const qty = typeof meta.qbo_qty === "number" && meta.qbo_qty > 0 ? meta.qbo_qty : 1;
  const unitCents =
    typeof meta.qbo_unit_cents === "number" && meta.qbo_unit_cents * qty === invoice.amount_cents
      ? meta.qbo_unit_cents
      : invoice.amount_cents;
  return {
    CustomerRef: { value: customerQBId },
    DocNumber: qboDocNumber(invoice.id),
    TxnDate: txnDate,
    DueDate: invoice.due_date ?? undefined,
    CurrencyRef: { value: invoice.currency ?? "CAD" },
    Line: [
      {
        Amount: invoice.amount_cents / 100,
        Description: invoice.description,
        DetailType: "SalesItemLineDetail" as const,
        SalesItemLineDetail: {
          ItemRef: { value: itemId },
          UnitPrice: unitCents / 100,
          Qty: unitCents === invoice.amount_cents ? 1 : qty,
          TaxCodeRef: { value: taxCodeRef },
        },
      },
    ],
    PrivateNote: [
      `CSC Invoice ID: ${invoice.id}`,
      note.contact ? `For: ${note.contact}` : null,
      note.issuedOn !== txnDate ? `Issued in Stripe ${note.issuedOn}; recorded ${txnDate}` : null,
    ].filter(Boolean).join(". "),
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

/** Closed on purpose without posting: the reason is the row's message. */
async function markSkipped(db: ReturnType<typeof createAdminClient>, row: QBExportQueueRow, reason: string) {
  await db
    .from("qbo_export_queue")
    .update({
      status: "skipped",
      processed_at: new Date().toISOString(),
      lease_expires_at: null,
      next_retry_at: null,
      error_message: reason,
    })
    .eq("id", row.id);
}

/**
 * Stop, without retrying, and wait for a person. The row shows as failed on
 * /admin/ops with the reason, where Skip (she entered it herself) and Retry
 * (she moved the closing date) are the two ways out.
 */
async function holdRow(db: ReturnType<typeof createAdminClient>, row: QBExportQueueRow, reason: string) {
  await db
    .from("qbo_export_queue")
    .update({
      status: "failed",
      retry_count: row.max_retries,
      next_retry_at: null,
      lease_expires_at: null,
      error_message: reason,
    })
    .eq("id", row.id);
}

// Backoff and exhaustion now live in lib/quickbooks/queue.ts, which picks the
// ladder from the failure's kind — a transient Intuit fault gets ~40 hours,
// anything unclassified keeps this queue's original three attempts. No alert
// is raised here: /admin/ops surfaces this queue's failed rows directly.
async function failRow(
  db: ReturnType<typeof createAdminClient>,
  row: QBExportQueueRow,
  err: unknown
) {
  await failQueueRow(db, "qbo_export_queue", row, err);
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

  // Stop starting rows once the run's budget is spent. qbRequest now
  // retries, so a slow Intuit day costs real wall-clock, and overrunning
  // the 5-minute lease would let another worker reclaim a row still being
  // processed and post it twice. Unstarted rows go back on the queue and
  // wait for the next tick.
  const isOutOfBudget = startRunBudget();
  for (const [rowIndex, row] of rows.entries()) {
    if (isOutOfBudget()) {
      await releaseUnprocessedRows(
        db,
        "qbo_membership_refund_queue",
        rows.slice(rowIndex).map((r) => r.id)
      );
      break;
    }
    result.processed++;
    try {
      // Refunds get the stored-id guard only, NOT the DocNumber pre-flight:
      // this path derives DocNumber from the parent invoice, so two partial
      // refunds of one invoice share it and adopting the first would silently
      // swallow the second. A refund whose write-back was lost therefore still
      // needs a human to check QBO — /admin/ops flags exactly that case.
      if (row.qbo_refund_receipt_id) {
        await adoptExistingReceipt(
          db,
          "qbo_membership_refund_queue",
          row.id,
          row.qbo_refund_receipt_id
        );
        result.succeeded++;
        continue;
      }

      const { data: invoice, error: invErr } = await db
        .from("invoices")
        .select(`
          id, type, description, amount_cents, currency,
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
      const itemId = await resolveQBItemId(db, invoice.type ?? "default", invoice.amount_cents, invoice.description);
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
      await failRefundRow(db, row, err);
    }
  }

  return result;
}

async function failRefundRow(
  db: ReturnType<typeof createAdminClient>,
  row: QBMembershipRefundQueueRow,
  err: unknown
): Promise<void> {
  const { exhausted, message } = await failQueueRow(
    db,
    "qbo_membership_refund_queue",
    row,
    err
  );

  if (exhausted) {
    await raiseAlertIfNotOpen({
      ruleKey: `qbo_membership_refund_failed:${row.invoice_id}`,
      severity: "critical",
      message: `QuickBooks Refund Receipt export failed for invoice ${row.invoice_id}: ${message}`,
      details: { invoiceId: row.invoice_id, stripeRefundId: row.stripe_refund_id, error: message },
    });
  }
}
