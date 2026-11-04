"use server";

/**
 * Billing CANCOLL for the registrations it funds (CSC/CANCOLL MOU, Article 11,
 * Schedule A): the registration report, and the invoice that goes with it.
 *
 * Steve, 2026-11-03:
 *   * "We send it from the site": a Stripe invoice like any other, finalized
 *     and emailed from here. To Lorraine Hamilton, copying Greg McPherson and
 *     Kelly Abraham (the funded offer's invoice_to / invoice_cc).
 *   * "Push the invoices to QBO as soon as we issue them": CANCOLL pays slowly,
 *     and an invoice can sit across a GST period. So it is queued for QuickBooks
 *     the moment it is issued, and the payment follows when it is paid
 *     (lib/quickbooks/export.ts).
 *   * The report goes "as a csv for them": attached to the invoice email, and
 *     downloadable here.
 *
 * Corrections after an invoice is issued go on the next one (MOU 11.4): an
 * invoice bills only registrations no earlier CANCOLL invoice has billed.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { ensureStripeCustomer, finalizeAndSendInvoice } from "@/lib/stripe/billing";
import { sendTransactional } from "@/lib/comms/send";
import { formatMemberFacingDate } from "@/lib/comms/format";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { zonedWallTimeToUtcIso } from "@/lib/conference/tz";
import { formatCents } from "@/lib/utils";
import {
  cancollReportCsv,
  cancollAttendanceCsv,
  loadCancollBilling,
  registrationsToInvoice,
} from "@/lib/conference/cancoll-report";

type Result<T> = { success: true; data: T } | { success: false; error: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The day after a YYYY-MM-DD, as YYYY-MM-DD. */
function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Staff: the registration report as CSV, every Supported Registration to date. */
export async function exportCancollRegistrationReport(
  conferenceId: string
): Promise<Result<{ filename: string; csv: string; rows: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const billing = await loadCancollBilling(createAdminClient(), conferenceId);
  if (!billing) return { success: false, error: "This conference has no CANCOLL-funded registration." };

  await logAuditEventSafe({
    action: "cancoll_registration_report_exported",
    entityType: "conference",
    entityId: conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { rows: billing.rows.length },
  });
  return {
    success: true,
    data: {
      filename: `cancoll-registration-report-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: cancollReportCsv(billing.rows, billing),
      rows: billing.rows.length,
    },
  };
}

/**
 * Staff: the attendance report as CSV. The same delegates as the registration
 * report; this one says whether each came to their partner meetings and the AGM.
 */
export async function exportCancollAttendanceReport(
  conferenceId: string
): Promise<Result<{ filename: string; csv: string; rows: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const billing = await loadCancollBilling(db, conferenceId);
  if (!billing) return { success: false, error: "This conference has no CANCOLL-funded registration." };

  await logAuditEventSafe({
    action: "cancoll_attendance_report_exported",
    entityType: "conference",
    entityId: conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { rows: billing.rows.length },
  });
  return {
    success: true,
    data: {
      filename: `cancoll-attendance-report-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: await cancollAttendanceCsv(db, billing),
      rows: billing.rows.length,
    },
  };
}

/**
 * Staff: invoice CANCOLL for every Supported Registration confirmed on or
 * before `throughDate` (the conference's own calendar day) that no earlier
 * CANCOLL invoice has billed. $299.00 each plus the conference's tax.
 */
export async function issueCancollInvoice(params: {
  conferenceId: string;
  throughDate: string;
}): Promise<Result<{ invoiceId: string; count: number; totalCents: number; emailed: boolean }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!YMD.test(params.throughDate)) return { success: false, error: "Choose the last day this invoice covers." };

  const db = createAdminClient();
  const billing = await loadCancollBilling(db, params.conferenceId);
  if (!billing) return { success: false, error: "This conference has no CANCOLL-funded registration." };
  if (!billing.stripeTaxRateId || !billing.qboTaxCodeRef) {
    return { success: false, error: "The conference's tax isn't set up for Stripe and QuickBooks. Set it before invoicing." };
  }
  if (!billing.invoiceTo) return { success: false, error: "Nobody is set to receive CANCOLL's invoice." };

  // Exclusive: the start of the next day where the conference is.
  const boundary = zonedWallTimeToUtcIso(nextDay(params.throughDate), null, billing.timeZone);
  const lines = registrationsToInvoice(billing.rows, boundary);
  if (lines.length === 0) {
    return { success: false, error: "No registrations confirmed by that date are waiting to be invoiced." };
  }

  const { data: cancoll } = await db.from("organizations").select("id, name").eq("slug", "cancoll").maybeSingle();
  if (!cancoll) return { success: false, error: "CANCOLL's organization record wasn't found." };

  let stripeInvoiceId: string;
  let taxCents: number;
  let totalCents: number;
  let stripeCustomerId: string;
  try {
    stripeCustomerId = await ensureStripeCustomer(cancoll.id);
    // ⛔ Invoice first, then items attached to it, as the conference invoice
    // path does: loose items would sweep in anything else pending.
    const created = await stripe.invoices.create({
      customer: stripeCustomerId,
      collection_method: "send_invoice",
      days_until_due: 30,
      currency: "cad",
      metadata: { org_id: cancoll.id, cancoll_conference_id: params.conferenceId },
    });
    if (!created.id) return { success: false, error: "Stripe did not return an invoice id." };
    stripeInvoiceId = created.id;
    for (const row of lines) {
      await stripe.invoiceItems.create({
        customer: stripeCustomerId,
        invoice: stripeInvoiceId,
        amount: billing.unitCents,
        currency: "cad",
        description: `Supported Registration: ${row.institution}${row.delegateName ? `, ${row.delegateName}` : ""}`,
        tax_rates: [billing.stripeTaxRateId],
      });
    }
    // Read the tax back from Stripe rather than computing a second answer.
    const priced = await stripe.invoices.retrieve(stripeInvoiceId);
    taxCents = priced.total - priced.subtotal;
    totalCents = priced.total;
  } catch (err) {
    return { success: false, error: `Stripe refused the invoice: ${err instanceof Error ? err.message : String(err)}` };
  }

  const amountCents = lines.length * billing.unitCents;
  const metadata = {
    cancoll_conference_id: params.conferenceId,
    through_date: params.throughDate,
    seat_ids: lines.map((l) => l.seatId),
    // The QuickBooks invoice posts to the registration's own item at the
    // conference's tax, not the membership mappings (lib/quickbooks/export.ts).
    qbo_item_id: billing.qboItemId,
    qbo_tax_code_ref: billing.qboTaxCodeRef,
    qbo_qty: lines.length,
    qbo_unit_cents: billing.unitCents,
  };
  const { data: invoice, error: insertError } = await db
    .from("invoices")
    .insert({
      organization_id: cancoll.id,
      type: "conference",
      description: `CANCOLL-funded registrations, ${billing.conferenceName}: ${lines.length} × ${formatCents(billing.unitCents)}`,
      amount_cents: amountCents,
      currency: "CAD",
      tax_amount_cents: taxCents,
      total_cents: totalCents,
      status: "draft",
      stripe_invoice_id: stripeInvoiceId,
      stripe_customer_id: stripeCustomerId,
      metadata,
    })
    .select("id, due_date")
    .single();
  if (insertError || !invoice) {
    return { success: false, error: `The invoice was created in Stripe (${stripeInvoiceId}) but not recorded here: ${insertError?.message}` };
  }

  // Finalized without our member email: CANCOLL's goes to its own people below.
  const finalized = await finalizeAndSendInvoice(invoice.id, { notify: false });
  if (!finalized.success) return { success: false, error: finalized.error ?? "Could not finalize the invoice." };
  const issued = await stripe.invoices.retrieve(stripeInvoiceId);
  await db
    .from("invoices")
    // The invoice number, which the report and the panel show.
    .update({ metadata: { ...metadata, number: issued.number ?? null } })
    .eq("id", invoice.id);

  // The report sent with it lists every Supported Registration to date, with
  // this invoice's number on the ones it bills.
  const lineIds = new Set(lines.map((l) => l.seatId));
  const reportRows = billing.rows.map((r) =>
    lineIds.has(r.seatId) ? { ...r, invoiceId: invoice.id, invoiceNumber: issued.number ?? null } : r
  );
  const sent = await sendTransactional({
    templateKey: "invoice_issued",
    to: billing.invoiceTo,
    cc: billing.invoiceCc,
    variables: {
      contact_name: billing.invoiceContactName ?? `${cancoll.name} team`,
      org_name: cancoll.name,
      invoice_description: `Supported Registrations for ${billing.conferenceName}, confirmed on or before ${formatMemberFacingDate(params.throughDate)}: ${lines.length} × ${formatCents(billing.unitCents)} plus tax. The registration report is attached.`,
      invoice_amount: formatCents(totalCents),
      due_date: formatMemberFacingDate(issued.due_date ? new Date(issued.due_date * 1000).toISOString().slice(0, 10) : invoice.due_date),
      invoice_url: finalized.hostedInvoiceUrl ?? "",
    },
    attachments: [
      {
        filename: `cancoll-registration-report-${params.throughDate}.csv`,
        content: cancollReportCsv(reportRows, billing),
      },
    ],
  });

  await logAuditEventSafe({
    action: "cancoll_invoice_issued",
    entityType: "invoice",
    entityId: invoice.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: params.conferenceId,
      throughDate: params.throughDate,
      count: lines.length,
      totalCents,
      stripeInvoiceId,
      emailed: sent.success,
      emailError: sent.success ? null : sent.error,
    },
  });
  revalidatePath(`/admin/conference/${params.conferenceId}/registrations`);
  return { success: true, data: { invoiceId: invoice.id, count: lines.length, totalCents, emailed: sent.success } };
}

export type CancollBillingSummary = {
  /** Supported Registrations to date, and their value. */
  count: number;
  valueCents: number;
  /** Not yet on any CANCOLL invoice. */
  waiting: number;
  invoiceTo: string | null;
  invoiceCc: string[];
  invoices: Array<{ id: string; number: string | null; status: string; totalCents: number; createdAt: string; count: number }>;
};

/** Staff: where CANCOLL's billing stands, for the registrations page. */
export async function getCancollBillingSummary(conferenceId: string): Promise<Result<CancollBillingSummary | null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const billing = await loadCancollBilling(createAdminClient(), conferenceId);
  if (!billing) return { success: true, data: null };
  return {
    success: true,
    data: {
      count: billing.rows.length,
      valueCents: billing.rows.length * billing.unitCents,
      waiting: billing.rows.filter((r) => !r.invoiceId).length,
      invoiceTo: billing.invoiceTo,
      invoiceCc: billing.invoiceCc,
      invoices: billing.invoices,
    },
  };
}
