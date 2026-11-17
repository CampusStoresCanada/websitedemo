// Stripe inbound reconciliation worker — sweeps local invoices that are
// still "invoiced"/"pending_settlement" locally but have a Stripe invoice id,
// and checks Stripe directly for their real status. Exists because the
// webhook endpoint registered in the Stripe Dashboard was pointed at the
// wrong host for an unknown period (see ops incident 2026-08-05), so an
// unknown number of real invoice.paid events were never delivered.
//
// Deliberately does NOT require the original webhook event — it retrieves
// the current Stripe Invoice by id and, if paid, replays it through the same
// processStripeWebhookEvent() path a real webhook would have used, wrapped
// in a synthetic event. processStripeWebhookEvent only reads event.type and
// event.data.object, so this produces identical results (status update,
// membership_expires_at advance, membership_status transition, QB export
// enqueue) to what the real webhook delivery would have done.
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "./client";
import { processStripeWebhookEvent, toWebhookPayloadJson } from "./webhook-processing";

export interface StripeReconcileDetail {
  invoiceId: string;
  organizationId: string | null;
  stripeInvoiceId: string;
  localStatusBefore: string;
  stripeStatus: string;
  action: "activated" | "voided" | "still_unpaid" | "error";
  error?: string;
}

export interface StripeReconcileJobResult {
  checked: number;
  activated: number;
  /** Local invoices brought into line with a void that happened in Stripe. */
  voided: number;
  stillUnpaid: number;
  errors: string[];
  details: StripeReconcileDetail[];
}

const UNSETTLED_LOCAL_STATUSES = ["invoiced", "pending_settlement", "draft"];

export async function stripeInboundReconcileRun(): Promise<StripeReconcileJobResult> {
  const db = createAdminClient();
  const result: StripeReconcileJobResult = {
    checked: 0,
    activated: 0,
    voided: 0,
    stillUnpaid: 0,
    errors: [],
    details: [],
  };

  const { data: rows, error } = await db
    .from("invoices")
    .select("id, organization_id, status, stripe_invoice_id")
    .not("stripe_invoice_id", "is", null)
    .in("status", UNSETTLED_LOCAL_STATUSES);

  if (error) {
    result.errors.push(`Failed to load local invoices: ${error.message}`);
    return result;
  }

  for (const row of rows ?? []) {
    if (!row.stripe_invoice_id) continue;
    result.checked++;

    try {
      const stripeInvoice = await stripe.invoices.retrieve(row.stripe_invoice_id);

      // A void is as settled as a payment — it means nobody is collecting this.
      // Previously it fell into "still unpaid" and the local row stayed
      // "invoiced" indefinitely, which is how Shoes for Crews sat voided in
      // Stripe and open here. The webhook now catches these going forward;
      // this catches the ones that already drifted.
      if (stripeInvoice.status === "void") {
        const voidEvent = {
          id: `manual_reconcile_void_${stripeInvoice.id}_${Date.now()}`,
          type: "invoice.voided",
          data: { object: stripeInvoice },
        } as unknown as Stripe.Event;

        await processStripeWebhookEvent(voidEvent, db);

        await db.from("stripe_webhook_events").insert({
          id: voidEvent.id,
          type: voidEvent.type,
          result: "success",
          payload: toWebhookPayloadJson(voidEvent),
          processed_at: new Date().toISOString(),
        });

        result.voided++;
        result.details.push({
          invoiceId: row.id,
          organizationId: row.organization_id,
          stripeInvoiceId: row.stripe_invoice_id,
          localStatusBefore: row.status,
          stripeStatus: "void",
          action: "voided",
        });
        continue;
      }

      if (stripeInvoice.status !== "paid") {
        result.stillUnpaid++;
        result.details.push({
          invoiceId: row.id,
          organizationId: row.organization_id,
          stripeInvoiceId: row.stripe_invoice_id,
          localStatusBefore: row.status,
          stripeStatus: stripeInvoice.status ?? "unknown",
          action: "still_unpaid",
        });
        continue;
      }

      // Synthetic event — same shape processStripeWebhookEvent expects from
      // a real webhook delivery. Marked with a distinguishable id prefix so
      // it's obviously a manual reconcile pass in stripe_webhook_events, not
      // a real Stripe-delivered event.
      const syntheticEvent = {
        id: `manual_reconcile_${stripeInvoice.id}_${Date.now()}`,
        type: "invoice.paid",
        data: { object: stripeInvoice },
      } as unknown as Stripe.Event;

      const context = await processStripeWebhookEvent(syntheticEvent, db);
      void context;

      await db.from("stripe_webhook_events").insert({
        id: syntheticEvent.id,
        type: syntheticEvent.type,
        result: "success",
        payload: toWebhookPayloadJson(syntheticEvent),
        processed_at: new Date().toISOString(),
      });

      result.activated++;
      result.details.push({
        invoiceId: row.id,
        organizationId: row.organization_id,
        stripeInvoiceId: row.stripe_invoice_id,
        localStatusBefore: row.status,
        stripeStatus: stripeInvoice.status ?? "paid",
        action: "activated",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Invoice ${row.id} (${row.stripe_invoice_id}): ${message}`);
      result.details.push({
        invoiceId: row.id,
        organizationId: row.organization_id,
        stripeInvoiceId: row.stripe_invoice_id,
        localStatusBefore: row.status,
        stripeStatus: "unknown",
        action: "error",
        error: message,
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Invoices made in the Stripe dashboard
// ─────────────────────────────────────────────────────────────────

export interface UntrackedStripeInvoice {
  stripeInvoiceId: string;
  number: string | null;
  status: string;
  customer: string | null;
  totalCents: number;
  createdAt: string;
}

/** How far back the daily sweep looks. An invoice older than this was either caught or closed by hand. */
const UNTRACKED_LOOKBACK_DAYS = 30;

/**
 * The Stripe invoices nothing here knows about: a finalized invoice (open or
 * paid) whose id is on no `invoices` row and no shipment.
 *
 * Everything the site bills gets a row first, so these are invoices somebody
 * made in the Stripe dashboard. The site cannot post one to QuickBooks or tie
 * it to an order: eight existed between August and September 2026 and each was
 * entered in QuickBooks by hand. Drafts and voids are left out, since neither
 * asks anyone for money.
 */
export function untrackedStripeInvoices(
  stripeInvoices: Array<Pick<Stripe.Invoice, "id" | "number" | "status" | "total" | "created" | "customer_name" | "customer_email">>,
  knownStripeInvoiceIds: ReadonlySet<string>
): UntrackedStripeInvoice[] {
  return stripeInvoices
    .filter((inv) => (inv.status === "open" || inv.status === "paid") && !!inv.id && !knownStripeInvoiceIds.has(inv.id))
    .map((inv) => ({
      stripeInvoiceId: inv.id as string,
      number: inv.number ?? null,
      status: inv.status as string,
      customer: inv.customer_name ?? inv.customer_email ?? null,
      totalCents: inv.total,
      createdAt: new Date(inv.created * 1000).toISOString(),
    }));
}

/** Reads the last 30 days of Stripe invoices and returns the ones the site has no record of. */
export async function findUntrackedStripeInvoices(now: Date = new Date()): Promise<UntrackedStripeInvoice[]> {
  const db = createAdminClient();
  const since = Math.floor(now.getTime() / 1000) - UNTRACKED_LOOKBACK_DAYS * 86_400;

  const recent: Stripe.Invoice[] = [];
  for await (const inv of stripe.invoices.list({ created: { gte: since }, limit: 100 })) {
    recent.push(inv);
  }
  if (recent.length === 0) return [];

  // Look the ids up rather than loading every invoice row: the table is past
  // the API's 1,000-row cap, and a cut list would report real invoices as
  // untracked.
  const ids = recent.map((inv) => inv.id).filter((id): id is string => !!id);
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [invoiceRes, shipmentRes] = await Promise.all([
      db.from("invoices").select("stripe_invoice_id").in("stripe_invoice_id", chunk),
      db.from("shipments").select("stripe_invoice_id").in("stripe_invoice_id", chunk),
    ]);
    if (invoiceRes.error) throw new Error(`Could not read invoices: ${invoiceRes.error.message}`);
    if (shipmentRes.error) throw new Error(`Could not read shipments: ${shipmentRes.error.message}`);
    for (const row of [...(invoiceRes.data ?? []), ...(shipmentRes.data ?? [])]) {
      if (row.stripe_invoice_id) known.add(row.stripe_invoice_id);
    }
  }

  return untrackedStripeInvoices(recent, known);
}
