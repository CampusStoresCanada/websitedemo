// QuickBooks conference commerce export worker.
// Conference orders (booths/registration/sponsorship) never touch the
// `invoices` table — process_conference_order_paid() settles entirely inside
// conference_orders/conference_order_items/entity_purchases — so they're
// invisible to lib/quickbooks/export.ts's qbo_export_queue pipeline, which is
// Invoice+Payment and fed exclusively from paid `invoices` rows. This is a
// parallel path: a paid conference order posts as a QuickBooks Sales Receipt
// (money's already collected via Stripe — no AR, no Invoice object), and a
// refund posts a matching Refund Receipt.

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveQBCustomer, createQBSalesReceipt, createQBRefundReceipt, qboDocNumber } from "./client";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { resolveOrgAdminEmails, resolveOrgPrimaryContactEmail } from "@/lib/supabase/user-lookup";
import { resolveMembershipTaxCode } from "./export";
import type {
  QBLineItem,
  QBConferenceReceiptQueueRow,
  QBConferenceRefundQueueRow,
  QBMiscReceiptKind,
  QBMiscReceiptQueueRow,
} from "./types";

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const STALE_LEASE_THRESHOLD_MS = 10 * 60 * 1000; // reclaim after 10 minutes

type Db = ReturnType<typeof createAdminClient>;

// ─────────────────────────────────────────────────────────────────
// Enqueue
// ─────────────────────────────────────────────────────────────────

export async function enqueueQBConferenceReceipt(conferenceOrderId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("qbo_conference_receipt_queue")
    .insert({ conference_order_id: conferenceOrderId, status: "pending" })
    .select()
    .single();

  // Unique constraint on conference_order_id means duplicate inserts are silently skipped
  if (error && error.code !== "23505") {
    console.error("[qbo] enqueueQBConferenceReceipt failed:", error);
  }
}

export async function enqueueQBConferenceRefund(
  conferenceOrderId: string,
  stripeRefundId: string,
  refundAmountCents: number
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("qbo_conference_refund_queue")
    .insert({
      conference_order_id: conferenceOrderId,
      stripe_refund_id: stripeRefundId,
      refund_amount_cents: refundAmountCents,
      status: "pending",
    })
    .select()
    .single();

  // Unique constraint on stripe_refund_id means duplicate inserts (e.g. the
  // admin action AND the subsequent webhook for the same refund) are silently
  // skipped — the row is only ever created once per Stripe refund.
  if (error && error.code !== "23505") {
    console.error("[qbo] enqueueQBConferenceRefund failed:", error);
  }
}

// ─────────────────────────────────────────────────────────────────
// Shared: resolve a conference order's line items → QB line items
// ─────────────────────────────────────────────────────────────────

interface ResolvedOrder {
  organizationId: string;
  conferenceId: string;
  currency: string;
  paidAt: string | null;
}

async function loadOrder(db: Db, conferenceOrderId: string): Promise<ResolvedOrder> {
  const { data: order, error } = await db
    .from("conference_orders")
    .select("organization_id, conference_id, currency, paid_at")
    .eq("id", conferenceOrderId)
    .single();

  if (error || !order) throw new Error(`Conference order not found: ${conferenceOrderId}`);
  return {
    organizationId: order.organization_id,
    conferenceId: order.conference_id,
    currency: order.currency,
    paidAt: order.paid_at,
  };
}

/**
 * Conference commerce tax is one flat GST/HST code per conference — taxed by
 * where the conference is held, uniformly across every booth/registration/
 * sponsorship sale, never per item. Set on the conference's own "Tax"
 * fieldset (components/admin/conference/ConferenceForm.tsx), alongside
 * tax_jurisdiction/tax_rate_pct (the Stripe-side equivalent).
 */
async function resolveConferenceTaxCode(db: Db, conferenceId: string): Promise<string> {
  const { data: conference, error } = await db
    .from("conference_instances")
    .select("name, qbo_tax_code_ref")
    .eq("id", conferenceId)
    .single();

  if (error || !conference) throw new Error(`Conference not found: ${conferenceId}`);
  if (!conference.qbo_tax_code_ref) {
    throw new Error(
      `"${conference.name}" has no QuickBooks tax code set — set it on the conference's Tax fieldset (Edit tab).`
    );
  }
  return conference.qbo_tax_code_ref;
}

async function resolveQBCustomerId(db: Db, organizationId: string): Promise<string> {
  const { data: org, error } = await db
    .from("organizations")
    .select("id, name, email, quickbooks_customer_id")
    .eq("id", organizationId)
    .single();

  if (error || !org) throw new Error(`Organization not found: ${organizationId}`);

  // Same fallback chain as ensureStripeCustomer (lib/stripe/billing.ts):
  // org_admin's login email, then a contacts-table person, then
  // organizations.email as a last resort. QBO doesn't gate customer
  // creation on having an email at all, unlike Stripe — it silently
  // creates one with a blank PrimaryEmailAddr.
  const adminEmails = await resolveOrgAdminEmails(db, org.id);
  const billingEmail =
    adminEmails[0] ?? org.email ?? (await resolveOrgPrimaryContactEmail(db, org.id));

  const customer = await resolveQBCustomer(
    {
      DisplayName: org.name,
      ...(billingEmail ? { PrimaryEmailAddr: { Address: billingEmail } } : {}),
    },
    org.quickbooks_customer_id
  );

  if (!org.quickbooks_customer_id) {
    await db
      .from("organizations")
      .update({ quickbooks_customer_id: customer.Id, last_synced_qbo_at: new Date().toISOString() })
      .eq("id", org.id);
  }

  return customer.Id;
}

/**
 * An entity's QBO item is normally set once on its *type* and inherited by
 * every instance (mirrors effectiveAttributes() in lib/conference/entity-graph.ts,
 * reimplemented here against raw rows since this runs outside the Build UI's
 * in-memory graph) — so "Booth" gets one item and all booth instances inherit
 * it. An instance's own qbo_item_id, if set, wins.
 */
async function resolveEntityQBItemId(
  db: Db,
  entity: { id: string; qbo_item_id: string | null }
): Promise<string | null> {
  if (entity.qbo_item_id) return entity.qbo_item_id;

  const { data: ref } = await db
    .from("conference_entity_refs")
    .select("to_entity_id")
    .eq("from_entity_id", entity.id)
    .eq("role", "instance_of")
    .maybeSingle();

  if (!ref?.to_entity_id) return null;

  const { data: type } = await db
    .from("conference_entities")
    .select("qbo_item_id")
    .eq("id", ref.to_entity_id)
    .single();

  return type?.qbo_item_id ?? null;
}

/** Builds the QB line items for a conference order — shared by the receipt
 * worker and the full-refund path (a full refund mirrors these exactly).
 * taxCodeRef is resolved once per conference (see resolveConferenceTaxCode)
 * and applied to every line — conference tax doesn't vary by item. */
async function resolveConferenceLineItems(
  db: Db,
  conferenceOrderId: string,
  taxCodeRef: string
): Promise<QBLineItem[]> {
  const { data: items, error } = await db
    .from("conference_order_items")
    .select("id, offer_entity_id, quantity, total_cents")
    .eq("order_id", conferenceOrderId);

  if (error) throw new Error(`Failed to load order items: ${error.message}`);
  if (!items || items.length === 0) throw new Error(`Conference order has no line items: ${conferenceOrderId}`);

  const lines: QBLineItem[] = [];
  for (const item of items) {
    if (!item.offer_entity_id) {
      throw new Error(`Order item ${item.id} has no catalog entity (offer_entity_id) — cannot resolve a QB item.`);
    }

    const { data: entity, error: entityError } = await db
      .from("conference_entities")
      .select("id, name, qbo_item_id")
      .eq("id", item.offer_entity_id)
      .single();

    if (entityError || !entity) throw new Error(`Entity not found for order item ${item.id}`);

    const itemId = await resolveEntityQBItemId(db, entity);
    if (!itemId) {
      throw new Error(
        `"${entity.name}" has no QuickBooks item mapped — set it on its type in the Build tab.`
      );
    }

    lines.push({
      Amount: item.total_cents / 100,
      Description: entity.name,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: item.quantity,
        TaxCodeRef: { value: taxCodeRef },
      },
    });
  }

  return lines;
}

async function resolvePartialRefundItemId(db: Db): Promise<string> {
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "qbo_item_id_conference_partial_refund")
    .single();

  if (data?.value) return data.value;

  const { data: fallback } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "qbo_item_id_default")
    .single();

  if (fallback?.value) return fallback.value;

  throw new Error(
    "No QB item configured for partial conference refunds. Set 'qbo_item_id_conference_partial_refund' or 'qbo_item_id_default' in /admin/settings/quickbooks."
  );
}

/**
 * Which QBO bank/asset account Stripe-collected conference money lands in —
 * used on BOTH the Sales Receipt (the original sale) and its Refund Receipt,
 * so they land in the same account and net against each other correctly.
 */
async function resolveStripeDepositAccountId(db: Db): Promise<string> {
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "qbo_stripe_deposit_account_id")
    .single();

  if (data?.value) return data.value;

  throw new Error(
    "No QB deposit account configured for conference commerce. Set 'qbo_stripe_deposit_account_id' in /admin/settings/quickbooks."
  );
}

/**
 * Flat fallback tax code for event ticket buyers with no org on file — a
 * real, supported checkout path (public/non-member registration), not a
 * misconfiguration, so unlike resolveMembershipTaxCode this never throws for
 * "no province" — there's nowhere on a public buyer's profile to read a
 * province from in the first place.
 */
async function resolvePublicTicketTaxCode(db: Db): Promise<string> {
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "qbo_tax_code_public_ticket")
    .single();

  if (data?.value) return data.value;

  throw new Error(
    "No QB tax code configured for public (non-member) event ticket buyers. Set 'qbo_tax_code_public_ticket' in /admin/settings/quickbooks."
  );
}

// ─────────────────────────────────────────────────────────────────
// Receipt worker
// ─────────────────────────────────────────────────────────────────

export interface QBConferenceExportJobResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export async function quickbooksConferenceReceiptExportRun(): Promise<QBConferenceExportJobResult> {
  const db = createAdminClient();
  const result: QBConferenceExportJobResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  const now = new Date();

  const staleThreshold = new Date(now.getTime() - STALE_LEASE_THRESHOLD_MS).toISOString();
  await db
    .from("qbo_conference_receipt_queue")
    .update({ status: "retrying", lease_expires_at: null, next_retry_at: now.toISOString() })
    .eq("status", "processing")
    .lt("lease_expires_at", staleThreshold);

  // Two-step select-then-update-by-id — see lib/quickbooks/export.ts for why
  // update().or().select() in one call is avoided (silently empty RETURNING).
  const { data: candidates, error: findError } = await db
    .from("qbo_conference_receipt_queue")
    .select("id")
    .or(`status.eq.pending,and(status.eq.retrying,next_retry_at.lte.${now.toISOString()})`)
    .limit(10);

  if (findError) {
    console.error("[qbo] Failed to find claimable conference receipt queue rows:", findError);
    return result;
  }
  if (!candidates || candidates.length === 0) return result;

  const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
  const { data: rows, error: claimError } = await db
    .from("qbo_conference_receipt_queue")
    .update({ status: "processing", lease_expires_at: leaseExpiry })
    .in("id", candidates.map((c) => c.id))
    .select()
    .returns<QBConferenceReceiptQueueRow[]>();

  if (claimError) {
    console.error("[qbo] Failed to claim conference receipt queue rows:", claimError);
    return result;
  }
  if (!rows || rows.length === 0) return result;

  for (const row of rows) {
    result.processed++;
    try {
      const order = await loadOrder(db, row.conference_order_id);
      const customerId = await resolveQBCustomerId(db, order.organizationId);
      const taxCodeRef = await resolveConferenceTaxCode(db, order.conferenceId);
      const lines = await resolveConferenceLineItems(db, row.conference_order_id, taxCodeRef);
      const depositAccountId = await resolveStripeDepositAccountId(db);

      const receipt = await createQBSalesReceipt({
        CustomerRef: { value: customerId },
        Line: lines,
        TxnDate: (order.paidAt ?? new Date().toISOString()).slice(0, 10),
        DocNumber: qboDocNumber(row.conference_order_id),
        PrivateNote: `CSC Conference Order ID: ${row.conference_order_id}`,
        CurrencyRef: { value: order.currency ?? "CAD" },
        DepositToAccountRef: { value: depositAccountId },
      });

      await db
        .from("qbo_conference_receipt_queue")
        .update({
          status: "completed",
          qbo_sales_receipt_id: receipt.Id,
          processed_at: new Date().toISOString(),
          lease_expires_at: null,
          error_message: null,
        })
        .eq("id", row.id);

      result.succeeded++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`order ${row.conference_order_id}: ${message}`);
      await failReceiptRow(db, row, message);
    }
  }

  return result;
}

async function failReceiptRow(db: Db, row: QBConferenceReceiptQueueRow, message: string): Promise<void> {
  const newRetryCount = row.retry_count + 1;
  const exhausted = newRetryCount >= row.max_retries;
  const backoffMinutes = [5, 20, 60][Math.min(row.retry_count, 2)];
  const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

  await db
    .from("qbo_conference_receipt_queue")
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
      ruleKey: `qbo_conference_receipt_failed:${row.conference_order_id}`,
      severity: "critical",
      message: `QuickBooks Sales Receipt export failed for conference order ${row.conference_order_id}: ${message}`,
      details: { conferenceOrderId: row.conference_order_id, error: message },
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Refund worker
// ─────────────────────────────────────────────────────────────────

export async function quickbooksConferenceRefundExportRun(): Promise<QBConferenceExportJobResult> {
  const db = createAdminClient();
  const result: QBConferenceExportJobResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  const now = new Date();

  const staleThreshold = new Date(now.getTime() - STALE_LEASE_THRESHOLD_MS).toISOString();
  await db
    .from("qbo_conference_refund_queue")
    .update({ status: "retrying", lease_expires_at: null, next_retry_at: now.toISOString() })
    .eq("status", "processing")
    .lt("lease_expires_at", staleThreshold);

  // Two-step select-then-update-by-id — see lib/quickbooks/export.ts for why
  // update().or().select() in one call is avoided (silently empty RETURNING).
  const { data: candidates, error: findError } = await db
    .from("qbo_conference_refund_queue")
    .select("id")
    .or(`status.eq.pending,and(status.eq.retrying,next_retry_at.lte.${now.toISOString()})`)
    .limit(10);

  if (findError) {
    console.error("[qbo] Failed to find claimable conference refund queue rows:", findError);
    return result;
  }
  if (!candidates || candidates.length === 0) return result;

  const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
  const { data: rows, error: claimError } = await db
    .from("qbo_conference_refund_queue")
    .update({ status: "processing", lease_expires_at: leaseExpiry })
    .in("id", candidates.map((c) => c.id))
    .select()
    .returns<QBConferenceRefundQueueRow[]>();

  if (claimError) {
    console.error("[qbo] Failed to claim conference refund queue rows:", claimError);
    return result;
  }
  if (!rows || rows.length === 0) return result;

  for (const row of rows) {
    result.processed++;
    try {
      const order = await loadOrder(db, row.conference_order_id);
      const customerId = await resolveQBCustomerId(db, order.organizationId);
      const taxCodeRef = await resolveConferenceTaxCode(db, order.conferenceId);

      const { data: orderRow, error: orderError } = await db
        .from("conference_orders")
        .select("total_cents")
        .eq("id", row.conference_order_id)
        .single();
      if (orderError || !orderRow) throw new Error(`Conference order not found: ${row.conference_order_id}`);

      // A refund event covering the order's full amount mirrors the original
      // receipt's lines exactly (clean 1:1 reversal). A partial refund posts a
      // single generic line — proportionally re-splitting the original lines
      // for a partial is genuinely ambiguous when only part of a multi-item
      // order is refunded.
      const isFullRefundEvent = row.refund_amount_cents >= orderRow.total_cents;
      let lines: QBLineItem[];
      if (isFullRefundEvent) {
        lines = await resolveConferenceLineItems(db, row.conference_order_id, taxCodeRef);
      } else {
        const partialItemId = await resolvePartialRefundItemId(db);
        lines = [
          {
            Amount: row.refund_amount_cents / 100,
            Description: `Partial refund — conference order ${row.conference_order_id}`,
            DetailType: "SalesItemLineDetail",
            SalesItemLineDetail: {
              ItemRef: { value: partialItemId },
              Qty: 1,
              TaxCodeRef: { value: taxCodeRef },
            },
          },
        ];
      }

      const depositAccountId = await resolveStripeDepositAccountId(db);
      const refundReceipt = await createQBRefundReceipt({
        CustomerRef: { value: customerId },
        Line: lines,
        TxnDate: new Date().toISOString().slice(0, 10),
        DocNumber: qboDocNumber(row.conference_order_id),
        PrivateNote: `CSC Conference Order ID: ${row.conference_order_id} — refund ${row.stripe_refund_id}`,
        CurrencyRef: { value: order.currency ?? "CAD" },
        DepositToAccountRef: { value: depositAccountId },
      });

      await db
        .from("qbo_conference_refund_queue")
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
      result.errors.push(`order ${row.conference_order_id}: ${message}`);
      await failRefundRow(db, row, message);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Misc receipt worker — prospective booth payments, prospective (non-member)
// Day Pass registration payments, and event ticket purchases are all the
// same shape: money already collected via Stripe, no conference_orders/
// invoices row backing them, one line, needs one Sales Receipt. One queue,
// one worker, branching by payment_kind, reusing the resolvers above.
// ─────────────────────────────────────────────────────────────────

/**
 * Idempotently enqueue a one-off payment for QB export. Unique constraint on
 * (payment_kind, payment_id) means duplicate inserts are silently skipped.
 */
export async function enqueueQBMiscReceipt(kind: QBMiscReceiptKind, paymentId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("qbo_misc_receipt_queue")
    .insert({ payment_kind: kind, payment_id: paymentId, status: "pending" })
    .select()
    .single();

  if (error && error.code !== "23505") {
    console.error("[qbo] enqueueQBMiscReceipt failed:", error);
  }
}

/**
 * For payments with no organization yet (prospective booth/registration —
 * that's the whole point of "pay first, apply second"), find-or-create a
 * one-off QB customer from the payment's own name/email. No write-back
 * column needed: findQBCustomer already dedupes by exact DisplayName in QBO.
 */
async function resolveOneOffQBCustomerId(displayName: string, email: string): Promise<string> {
  // No org_id here (that's the whole point of "pay first, apply second"),
  // so no org_admin fallback chain applies — email always comes straight
  // from the payment itself.
  const customer = await resolveQBCustomer({
    DisplayName: displayName,
    PrimaryEmailAddr: { Address: email },
  });
  return customer.Id;
}

interface MiscReceiptDetails {
  customerId: string;
  taxCodeRef: string;
  itemId: string;
  amountCents: number;
  description: string;
}

async function resolveMiscReceiptDetails(
  db: Db,
  kind: QBMiscReceiptKind,
  paymentId: string
): Promise<MiscReceiptDetails> {
  if (kind === "prospective_booth") {
    const { data: payment, error } = await db
      .from("prospective_booth_payments")
      .select("company_name, email, amount_cents, conference_id, booth_entity_id")
      .eq("id", paymentId)
      .single();
    if (error || !payment) throw new Error(`Prospective booth payment not found: ${paymentId}`);

    const { data: entity, error: entityError } = await db
      .from("conference_entities")
      .select("id, name, qbo_item_id")
      .eq("id", payment.booth_entity_id)
      .single();
    if (entityError || !entity) throw new Error(`Booth entity not found for payment ${paymentId}`);

    const itemId = await resolveEntityQBItemId(db, entity);
    if (!itemId) throw new Error(`"${entity.name}" has no QuickBooks item mapped — set it on its type in the Build tab.`);

    const taxCodeRef = await resolveConferenceTaxCode(db, payment.conference_id);
    const customerId = await resolveOneOffQBCustomerId(payment.company_name, payment.email);

    return { customerId, taxCodeRef, itemId, amountCents: payment.amount_cents, description: entity.name };
  }

  if (kind === "prospective_registration") {
    const { data: payment, error } = await db
      .from("prospective_registration_payments")
      .select("organization_name, email, amount_cents, conference_id, offer_entity_id")
      .eq("id", paymentId)
      .single();
    if (error || !payment) throw new Error(`Prospective registration payment not found: ${paymentId}`);

    const { data: entity, error: entityError } = await db
      .from("conference_entities")
      .select("id, name, qbo_item_id")
      .eq("id", payment.offer_entity_id)
      .single();
    if (entityError || !entity) throw new Error(`Registration entity not found for payment ${paymentId}`);

    const itemId = await resolveEntityQBItemId(db, entity);
    if (!itemId) throw new Error(`"${entity.name}" has no QuickBooks item mapped — set it on its type in the Build tab.`);

    const taxCodeRef = await resolveConferenceTaxCode(db, payment.conference_id);
    const customerId = await resolveOneOffQBCustomerId(payment.organization_name, payment.email);

    return { customerId, taxCodeRef, itemId, amountCents: payment.amount_cents, description: entity.name };
  }

  // event_ticket
  const { data: registration, error } = await db
    .from("event_registrations")
    .select("user_id, ticket_type_id, amount_paid_cents")
    .eq("id", paymentId)
    .single();
  if (error || !registration) throw new Error(`Event registration not found: ${paymentId}`);
  if (!registration.ticket_type_id) throw new Error(`Event registration ${paymentId} has no ticket type`);

  const { data: ticketType, error: ticketError } = await db
    .from("event_ticket_types")
    .select("name, qbo_item_id")
    .eq("id", registration.ticket_type_id)
    .single();
  if (ticketError || !ticketType) throw new Error(`Ticket type not found for registration ${paymentId}`);
  if (!ticketType.qbo_item_id) {
    throw new Error(`"${ticketType.name}" ticket type has no QuickBooks item mapped — set it in the event's Tickets tab.`);
  }

  // An org-linked event ticket buyer is taxed exactly like a membership-dues
  // payer — by their own org's province — reusing the same org lookup and
  // resolveMembershipTaxCode as the invoice export path. Public/non-member
  // registrants are a real, supported checkout path though (not a rare
  // misconfiguration), and there's nowhere to read their own province from
  // (profiles carries no address), so that case falls back to a one-off
  // customer + a single flat tax code setting, the same shape as the
  // membership pipeline's own outside-Canada fallback.
  const { data: userOrg } = await db
    .from("user_organizations")
    .select("organization_id")
    .eq("user_id", registration.user_id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  let customerId: string;
  let taxCodeRef: string;

  if (userOrg?.organization_id) {
    customerId = await resolveQBCustomerId(db, userOrg.organization_id);

    const { data: org, error: orgError } = await db
      .from("organizations")
      .select("name, province, country")
      .eq("id", userOrg.organization_id)
      .single();
    if (orgError || !org) throw new Error(`Organization not found: ${userOrg.organization_id}`);

    taxCodeRef = await resolveMembershipTaxCode(db, org);
  } else {
    const [{ data: profile }, { data: userRecord }] = await Promise.all([
      db.from("profiles").select("display_name").eq("id", registration.user_id).maybeSingle(),
      db.auth.admin.getUserById(registration.user_id),
    ]);
    const email = userRecord?.user?.email;
    if (!email) throw new Error(`No email on file for event registration ${paymentId}'s buyer — can't create a QB customer.`);

    customerId = await resolveOneOffQBCustomerId(profile?.display_name ?? email, email);
    taxCodeRef = await resolvePublicTicketTaxCode(db);
  }

  return {
    customerId,
    taxCodeRef,
    itemId: ticketType.qbo_item_id,
    amountCents: registration.amount_paid_cents,
    description: ticketType.name,
  };
}

export async function quickbooksMiscReceiptExportRun(): Promise<QBConferenceExportJobResult> {
  const db = createAdminClient();
  const result: QBConferenceExportJobResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };
  const now = new Date();

  const staleThreshold = new Date(now.getTime() - STALE_LEASE_THRESHOLD_MS).toISOString();
  await db
    .from("qbo_misc_receipt_queue")
    .update({ status: "retrying", lease_expires_at: null, next_retry_at: now.toISOString() })
    .eq("status", "processing")
    .lt("lease_expires_at", staleThreshold);

  const { data: candidates, error: findError } = await db
    .from("qbo_misc_receipt_queue")
    .select("id")
    .or(`status.eq.pending,and(status.eq.retrying,next_retry_at.lte.${now.toISOString()})`)
    .limit(10);

  if (findError) {
    console.error("[qbo] Failed to find claimable misc receipt queue rows:", findError);
    return result;
  }
  if (!candidates || candidates.length === 0) return result;

  const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
  const { data: rows, error: claimError } = await db
    .from("qbo_misc_receipt_queue")
    .update({ status: "processing", lease_expires_at: leaseExpiry })
    .in("id", candidates.map((c) => c.id))
    .select()
    .returns<QBMiscReceiptQueueRow[]>();

  if (claimError) {
    console.error("[qbo] Failed to claim misc receipt queue rows:", claimError);
    return result;
  }
  if (!rows || rows.length === 0) return result;

  for (const row of rows) {
    result.processed++;
    try {
      const details = await resolveMiscReceiptDetails(db, row.payment_kind, row.payment_id);
      const depositAccountId = await resolveStripeDepositAccountId(db);

      const receipt = await createQBSalesReceipt({
        CustomerRef: { value: details.customerId },
        Line: [
          {
            Amount: details.amountCents / 100,
            Description: details.description,
            DetailType: "SalesItemLineDetail",
            SalesItemLineDetail: {
              ItemRef: { value: details.itemId },
              Qty: 1,
              TaxCodeRef: { value: details.taxCodeRef },
            },
          },
        ],
        TxnDate: new Date().toISOString().slice(0, 10),
        DocNumber: qboDocNumber(row.payment_id),
        PrivateNote: `CSC ${row.payment_kind} payment ID: ${row.payment_id}`,
        CurrencyRef: { value: "CAD" },
        DepositToAccountRef: { value: depositAccountId },
      });

      await db
        .from("qbo_misc_receipt_queue")
        .update({
          status: "completed",
          qbo_sales_receipt_id: receipt.Id,
          processed_at: new Date().toISOString(),
          lease_expires_at: null,
          error_message: null,
        })
        .eq("id", row.id);

      result.succeeded++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${row.payment_kind} ${row.payment_id}: ${message}`);
      await failMiscReceiptRow(db, row, message);
    }
  }

  return result;
}

async function failMiscReceiptRow(db: Db, row: QBMiscReceiptQueueRow, message: string): Promise<void> {
  const newRetryCount = row.retry_count + 1;
  const exhausted = newRetryCount >= row.max_retries;
  const backoffMinutes = [5, 20, 60][Math.min(row.retry_count, 2)];
  const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

  await db
    .from("qbo_misc_receipt_queue")
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
      ruleKey: `qbo_misc_receipt_failed:${row.payment_kind}:${row.payment_id}`,
      severity: "critical",
      message: `QuickBooks Sales Receipt export failed for ${row.payment_kind} payment ${row.payment_id}: ${message}`,
      details: { paymentKind: row.payment_kind, paymentId: row.payment_id, error: message },
    });
  }
}

async function failRefundRow(db: Db, row: QBConferenceRefundQueueRow, message: string): Promise<void> {
  const newRetryCount = row.retry_count + 1;
  const exhausted = newRetryCount >= row.max_retries;
  const backoffMinutes = [5, 20, 60][Math.min(row.retry_count, 2)];
  const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

  await db
    .from("qbo_conference_refund_queue")
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
      ruleKey: `qbo_conference_refund_failed:${row.conference_order_id}`,
      severity: "critical",
      message: `QuickBooks Refund Receipt export failed for conference order ${row.conference_order_id}: ${message}`,
      details: { conferenceOrderId: row.conference_order_id, stripeRefundId: row.stripe_refund_id, error: message },
    });
  }
}
