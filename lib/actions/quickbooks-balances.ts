"use server";

/**
 * Bill a balance QuickBooks shows as owing that the site has no open invoice
 * for: a tax amount left off the original, a cheque that came in short, an
 * invoice made outside the site and part paid.
 *
 * Built on the August tax corrections (lib/quickbooks/export.ts,
 * postTaxCorrection): the invoice is not a sale, so it posts nothing new to
 * QuickBooks. When it is paid, the payment goes against the QuickBooks invoice
 * that already carries the balance.
 *
 * The amount is never typed. It is what QuickBooks shows owing, read again at
 * the moment of billing (Steve, 2026-11-17: QuickBooks is the standard).
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { ensureStripeCustomer, finalizeAndSendInvoice, stripeDueTerms } from "@/lib/stripe/billing";
import { loadQuickBooksBalances } from "@/lib/billing/quickbooks-balances";
import { logAuditEventSafe } from "@/lib/ops/audit";

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function billQuickBooksBalance(params: {
  qboInvoiceId: string;
  /** What the customer reads on the invoice and in the email. */
  description: string;
  /** YYYY-MM-DD; blank for 30 days. */
  dueDate?: string | null;
  /** Email the organization's admins that the invoice is ready. */
  notify: boolean;
}): Promise<Result<{ invoiceId: string; totalCents: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const description = params.description.trim();
  if (!description) return { success: false, error: "Say what this invoice is for." };

  const db = createAdminClient();
  let balance;
  try {
    balance = (await loadQuickBooksBalances(db)).find((b) => b.qboInvoiceId === params.qboInvoiceId);
  } catch (err) {
    return { success: false, error: `QuickBooks could not be read: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!balance) return { success: false, error: "QuickBooks no longer shows a balance on that invoice." };
  if (balance.state !== "billable" || !balance.org) {
    return {
      success: false,
      error:
        balance.state === "no_org"
          ? "No organization on the site is linked to that QuickBooks customer."
          : balance.state === "other_currency"
            ? "That invoice is not in Canadian dollars."
            : "The site already has an open invoice for that balance.",
    };
  }
  const org = balance.org;

  let terms;
  try {
    terms = stripeDueTerms(params.dueDate || null);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  let stripeInvoiceId: string;
  let stripeCustomerId: string;
  try {
    stripeCustomerId = await ensureStripeCustomer(org.id);
    // Invoice first, then the item attached to it: a loose item would sweep in
    // anything else pending on the customer.
    const created = await stripe.invoices.create({
      customer: stripeCustomerId,
      collection_method: "send_invoice",
      ...terms,
      currency: "cad",
      metadata: { org_id: org.id, pays_qbo_invoice_id: balance.qboInvoiceId },
    });
    if (!created.id) return { success: false, error: "Stripe did not return an invoice id." };
    stripeInvoiceId = created.id;
    // No tax rate: the balance is already the full amount owing, tax included.
    await stripe.invoiceItems.create({
      customer: stripeCustomerId,
      invoice: stripeInvoiceId,
      amount: balance.owingCents,
      currency: "cad",
      description,
    });
  } catch (err) {
    return { success: false, error: `Stripe refused the invoice: ${err instanceof Error ? err.message : String(err)}` };
  }

  const { data: invoice, error: insertError } = await db
    .from("invoices")
    .insert({
      organization_id: org.id,
      // The kind of invoice it finishes paying; "addon" when the site never made the original.
      type: balance.original?.type ?? "addon",
      description,
      amount_cents: balance.owingCents,
      currency: "CAD",
      tax_amount_cents: 0,
      total_cents: balance.owingCents,
      status: "draft",
      stripe_invoice_id: stripeInvoiceId,
      stripe_customer_id: stripeCustomerId,
      metadata: {
        pays_qbo_invoice_id: balance.qboInvoiceId,
        qbo_doc_number: balance.docNumber,
        ...(balance.original ? { corrects_invoice_id: balance.original.id } : {}),
      },
    })
    .select("id")
    .single();
  if (insertError || !invoice) {
    return {
      success: false,
      error: `The invoice was created in Stripe (${stripeInvoiceId}) but not recorded here: ${insertError?.message}`,
    };
  }

  const finalized = await finalizeAndSendInvoice(invoice.id, { notify: params.notify });
  if (!finalized.success) return { success: false, error: finalized.error ?? "Could not finalize the invoice." };

  await logAuditEventSafe({
    action: "quickbooks_balance_billed",
    entityType: "invoice",
    entityId: invoice.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      organization_id: org.id,
      qbo_invoice_id: balance.qboInvoiceId,
      total_cents: balance.owingCents,
      notified: params.notify,
    },
  });

  revalidatePath("/admin/membership/balances");
  return { success: true, data: { invoiceId: invoice.id, totalCents: balance.owingCents } };
}
