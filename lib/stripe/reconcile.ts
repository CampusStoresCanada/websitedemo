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
  action: "activated" | "still_unpaid" | "error";
  error?: string;
}

export interface StripeReconcileJobResult {
  checked: number;
  activated: number;
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
