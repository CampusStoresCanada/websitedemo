import { stripe } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrgAdminEmails, resolveOrgPrimaryContactEmail } from "@/lib/supabase/user-lookup";
import { enqueueQBExportRefund } from "@/lib/quickbooks/export";
import { getBillingConfig, getEffectivePolicy, getRenewalConfig, getProgramsConfig } from "@/lib/policy/engine";
import { computeMembershipAssessment } from "@/lib/membership/pricing";
import { settlePaidInvoiceMembership } from "@/lib/membership/renewal-activation";
import { effectiveProrationDiscountPct, applyDiscountPct } from "@/lib/policy/proration";
import { resolveMembershipStripeTaxRateId } from "@/lib/stripe/tax";
import type { MembershipProgramDef } from "@/lib/policy/types";
import type {
  Invoice,
  PaymentMethod,
  ProrationResult,
  ProrationRule,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Stripe Customer Management
// ─────────────────────────────────────────────────────────────────

/**
 * Create a Stripe customer for an org and store the ID.
 * Called when an org is approved and ready for invoicing.
 */
export async function createStripeCustomer(
  orgId: string,
  orgName: string,
  email: string
): Promise<string> {
  const db = createAdminClient();

  // Check if org already has a Stripe customer
  const { data: org } = await db
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", orgId)
    .single();

  if (org?.stripe_customer_id) {
    return org.stripe_customer_id;
  }

  // Create in Stripe
  const customer = await stripe.customers.create({
    name: orgName,
    email,
    metadata: { org_id: orgId },
  });

  // Store on org
  await db
    .from("organizations")
    .update({ stripe_customer_id: customer.id })
    .eq("id", orgId);

  return customer.id;
}

/**
 * Ensure an org has a Stripe customer ID, creating one if needed.
 *
 * Billing correspondence (Stripe invoice emails, hosted invoice page) must
 * reach the org_admin's own login email, not organizations.email — that
 * column is the public "Store Contact" address shown on the org page
 * (see components/org/MemberProfile.tsx), a different audience. Falls back
 * to organizations.email, then to a real contact on file, only if the org
 * has no active org_admin yet.
 */
export async function ensureStripeCustomer(
  orgId: string
): Promise<string> {
  const db = createAdminClient();

  const { data: org } = await db
    .from("organizations")
    .select("stripe_customer_id, name, email")
    .eq("id", orgId)
    .single();

  if (!org) throw new Error(`Organization ${orgId} not found`);

  const adminEmails = await resolveOrgAdminEmails(db, orgId);
  const billingEmail =
    adminEmails[0] ?? org.email ?? (await resolveOrgPrimaryContactEmail(db, orgId)) ?? "";

  if (org.stripe_customer_id) {
    // Keep the Stripe customer's email current — it may have been created
    // before the org had an org_admin, or with the old public-email source.
    if (billingEmail) {
      await stripe.customers.update(org.stripe_customer_id, { email: billingEmail });
    }
    return org.stripe_customer_id;
  }

  return createStripeCustomer(orgId, org.name, billingEmail);
}

// ─────────────────────────────────────────────────────────────────
// Proration
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate proration discount based on policy rules and join date.
 *
 * Policy billing.proration_rules is an array like:
 *   [{ after_month_day: "02-01", discount_pct: 50 },
 *    { after_month_day: "06-01", discount_pct: 75 }]
 *
 * If startDate is after the cutoff in the current billing year,
 * the highest applicable discount is applied.
 */
export async function applyProration(
  baseAmountCents: number,
  startDate: Date
): Promise<ProrationResult> {
  const [billing, renewal] = await Promise.all([getBillingConfig(), getRenewalConfig()]);
  const rules = billing.proration_rules as ProrationRule[];

  const applicableDiscount = effectiveProrationDiscountPct(
    rules,
    renewal.cycle_start_month_day,
    renewal.pre_renewal_skip_stub_days,
    startDate
  );

  if (applicableDiscount === 0) {
    return { amountCents: baseAmountCents, discountPct: 0 };
  }

  return {
    amountCents: applyDiscountPct(baseAmountCents, applicableDiscount),
    discountPct: applicableDiscount,
  };
}

// ─────────────────────────────────────────────────────────────────
// Invoice Creation
// ─────────────────────────────────────────────────────────────────

/**
 * The flat Vendor Partner annual rate, in cents, from policy.
 * Shared by the invoice path here and per-org cart pricing in
 * lib/actions/conference-commerce.ts, so both quote the same number.
 */
export async function getPartnershipRateCents(): Promise<number> {
  const billing = await getBillingConfig();
  return Math.round(billing.partnership_rate * 100);
}

/**
 * Create an invoice for an org, priced according to its membership
 * program (lib/policy/types.ts — MembershipProgramDef). Replaces what
 * used to be two separately-implemented functions
 * (createMembershipInvoice/createPartnershipInvoice) that were ~90%
 * identical plumbing and diverged only in price resolution — that
 * divergence is now the only branch here, on `program.billing.mode`:
 * "metric_engine" resolves price via the already program-agnostic
 * computeMembershipAssessment (FTE tiers, single-metric tiers, or a
 * linear formula, per policy), "flat_rate" uses a fixed rate.
 */
export async function createProgramInvoice(
  orgId: string,
  options?: {
    applyProrationFromDate?: Date;
    billingPeriodStart?: string;
    billingPeriodEnd?: string;
    policySetId?: string;
  }
): Promise<Invoice> {
  const db = createAdminClient();
  const [billing, programs] = await Promise.all([getBillingConfig(), getProgramsConfig()]);

  const { data: org, error: orgError } = await db
    .from("organizations")
    .select("id, name, type, province, country, memberships(program_key)")
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    throw new Error(`Organization ${orgId} not found`);
  }

  // Phase 4 Stage 2: resolve which program to invoice from the org's
  // `memberships` row — the entity that now holds that fact — rather than
  // from `organizations.type`. Falls back to the type lookup when the
  // membership data can't answer it unambiguously (no row yet, or an org
  // holding several memberships, which the schema permits but nothing in
  // CSC's data produces today), so behavior is preserved either way.
  const membershipPrograms = programs.filter((p) =>
    (org.memberships ?? []).some((m) => m.program_key === p.key)
  );
  const program =
    membershipPrograms.length === 1
      ? membershipPrograms[0]
      : programs.find((p) => p.orgTypeValue === org.type);

  if (!program) {
    throw new Error(`Organization ${orgId} has type "${org.type}", which matches no configured membership program`);
  }

  // 1. Resolve the base price and description for this program's billing mode.
  // Description text uses invoiceType (e.g. "Membership"/"Partnership" — the
  // transaction type), not program.label (e.g. "Member"/"Vendor Partner" —
  // the org's display name), matching what these invoices have always said.
  const invoiceTypeLabel = program.invoiceType.charAt(0).toUpperCase() + program.invoiceType.slice(1);
  let baseCents: number;
  let priceDescription: string;
  let assessment: Awaited<ReturnType<typeof computeMembershipAssessment>> | null = null;

  if (program.billing.mode === "metric_engine") {
    assessment = await computeMembershipAssessment(orgId, {
      policySetId: options?.policySetId,
      billingPeriodStart: options?.billingPeriodStart,
    });

    if (assessment.assessmentStatus === "manual_required") {
      throw new Error(
        `Membership assessment requires manual override for organization ${orgId}`
      );
    }

    baseCents = assessment.computedAmountCents;
    priceDescription = `${invoiceTypeLabel} - ${assessment.explanation}`;
  } else {
    baseCents = program.billing.rateCents;
    priceDescription = `${invoiceTypeLabel} ($${(baseCents / 100).toFixed(2)})`;
  }

  // 2. Apply proration if requested
  let finalCents = baseCents;
  let prorationPct = 0;
  let originalCents: number | null = null;

  if (options?.applyProrationFromDate) {
    const proration = await applyProration(baseCents, options.applyProrationFromDate);
    finalCents = proration.amountCents;
    prorationPct = proration.discountPct;
    if (prorationPct > 0) {
      originalCents = baseCents;
    }
  }

  // 3. Ensure Stripe customer exists
  const stripeCustomerId = await ensureStripeCustomer(orgId);

  // 3b. Resolve the buyer's-own-province tax rate — dues are taxed by the
  // org's own location, not CSC's (see lib/stripe/tax.ts).
  if (!org.province) {
    throw new Error(
      `"${org.name}" has no province on file — cannot determine its tax rate. Set it before invoicing.`
    );
  }
  const taxRateId = await resolveMembershipStripeTaxRateId(db, org.province);

  // 4. Create Stripe invoice
  const stripeInvoice = await stripe.invoices.create({
    customer: stripeCustomerId,
    collection_method: "send_invoice",
    days_until_due: 30,
    currency: billing.currency.toLowerCase(),
    metadata: { org_id: orgId, invoice_type: program.invoiceType },
  });

  await stripe.invoiceItems.create({
    customer: stripeCustomerId,
    invoice: stripeInvoice.id,
    amount: finalCents,
    currency: billing.currency.toLowerCase(),
    description: `${priceDescription}${prorationPct > 0 ? `, ${prorationPct}% prorated` : ""}`,
    tax_rates: [taxRateId],
  });

  // Stripe computes tax as soon as a taxed line item is added, even on a
  // draft invoice — read it back rather than hand-computing from the rate
  // table, so our local total_cents always matches what Stripe (and later
  // QBO, once paid) actually shows.
  const taxedInvoice = await stripe.invoices.retrieve(stripeInvoice.id);
  const taxAmountCents = taxedInvoice.total - taxedInvoice.subtotal;
  const totalCents = taxedInvoice.total;

  // 5. Insert local invoice record
  const description = prorationPct > 0
    ? `${priceDescription} (${prorationPct}% prorated)`
    : priceDescription;

  const { data: invoice, error: insertError } = await db
    .from("invoices")
    .insert({
      organization_id: orgId,
      type: program.invoiceType,
      description,
      amount_cents: finalCents,
      currency: billing.currency,
      tax_amount_cents: taxAmountCents,
      total_cents: totalCents,
      proration_discount_pct: prorationPct,
      original_amount_cents: originalCents,
      status: "draft",
      stripe_invoice_id: stripeInvoice.id,
      stripe_customer_id: stripeCustomerId,
      billing_period_start: options?.billingPeriodStart ?? null,
      billing_period_end: options?.billingPeriodEnd ?? null,
      metadata: assessment
        ? {
            policy_set_id: assessment.policySetId,
            membership_assessment_id: assessment.id,
            assessment_status: assessment.assessmentStatus,
          }
        : null,
    })
    .select()
    .single();

  if (insertError || !invoice) {
    throw new Error(`Failed to insert invoice: ${insertError?.message}`);
  }

  return invoice as unknown as Invoice;
}

/**
 * Finalize and send a draft Stripe invoice.
 * This transitions the local invoice status to 'invoiced'.
 */
export async function finalizeAndSendInvoice(
  invoiceId: string
): Promise<{ success: boolean; error?: string }> {
  const db = createAdminClient();

  const { data: invoice } = await db
    .from("invoices")
    .select("id, stripe_invoice_id, status")
    .eq("id", invoiceId)
    .single();

  if (!invoice) return { success: false, error: "Invoice not found" };
  if (invoice.status !== "draft") {
    return { success: false, error: `Cannot send invoice in ${invoice.status} status` };
  }
  if (!invoice.stripe_invoice_id) {
    return { success: false, error: "No Stripe invoice linked" };
  }

  // Finalize in Stripe (this sends the invoice email) — the finalized
  // invoice already has invoice_pdf/hosted_invoice_url populated, so we
  // capture them here rather than fetching live later just to render a
  // download link.
  const finalized = await stripe.invoices.finalizeInvoice(invoice.stripe_invoice_id);
  await stripe.invoices.sendInvoice(invoice.stripe_invoice_id);

  // Update local status
  await db
    .from("invoices")
    .update({
      status: "invoiced",
      invoice_pdf_url: finalized.invoice_pdf ?? null,
      hosted_invoice_url: finalized.hosted_invoice_url ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Refunds
// ─────────────────────────────────────────────────────────────────

/**
 * Process a full refund for an invoice.
 * Validates refund eligibility via policy renewal.refund_window_days.
 */
export async function processRefund(
  invoiceId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const db = createAdminClient();

  // 1. Load invoice
  const { data: invoice } = await db
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (!invoice) return { success: false, error: "Invoice not found" };
  if (invoice.status !== "paid") {
    return { success: false, error: `Cannot refund invoice in ${invoice.status} status` };
  }

  // 2. Check refund window
  const refundWindowDays = await getEffectivePolicy<number>(
    "renewal.refund_window_days",
    "number"
  );

  if (invoice.paid_at) {
    const paidAt = new Date(invoice.paid_at);
    const daysSincePaid =
      (Date.now() - paidAt.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSincePaid > refundWindowDays) {
      return {
        success: false,
        error: `Refund window expired (${refundWindowDays} days). Paid ${Math.floor(daysSincePaid)} days ago.`,
      };
    }
  }

  // 3. Process Stripe refund
  let stripeRefundId: string | null = null;
  if (invoice.stripe_payment_intent_id) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: invoice.stripe_payment_intent_id,
        reason: "requested_by_customer",
        metadata: { invoice_id: invoiceId, reason },
      });
      stripeRefundId = refund.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stripe refund failed";
      return { success: false, error: msg };
    }
  }

  // 4. Update local invoice
  await db
    .from("invoices")
    .update({
      status: "refunded_full",
      refunded_at: new Date().toISOString(),
      refund_amount_cents: invoice.total_cents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  // stripe_refund_id is the idempotency key on qbo_membership_refund_queue —
  // if the charge.refunded webhook also fires for this same refund, that
  // enqueue is a no-op.
  if (stripeRefundId) {
    await enqueueQBExportRefund(invoiceId, stripeRefundId, invoice.total_cents);
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Payment Methods
// ─────────────────────────────────────────────────────────────────

/**
 * Save a payment method from a Stripe setup intent.
 */
export async function savePaymentMethod(
  orgId: string,
  stripePaymentMethodId: string,
  stripeCustomerId: string
): Promise<PaymentMethod> {
  const db = createAdminClient();

  // Fetch card details from Stripe
  const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);

  const { data, error } = await db
    .from("payment_methods")
    .insert({
      organization_id: orgId,
      stripe_payment_method_id: stripePaymentMethodId,
      stripe_customer_id: stripeCustomerId,
      card_brand: pm.card?.brand ?? null,
      card_last4: pm.card?.last4 ?? null,
      card_exp_month: pm.card?.exp_month ?? null,
      card_exp_year: pm.card?.exp_year ?? null,
      is_default: true,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to save payment method: ${error?.message}`);
  }

  // Unset other defaults for this org
  await db
    .from("payment_methods")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .neq("id", data.id);

  return data as unknown as PaymentMethod;
}

// ─────────────────────────────────────────────────────────────────
// Out-of-Band Payment (QuickBooks / Manual)
// ─────────────────────────────────────────────────────────────────

/**
 * Mark an invoice as paid outside of Stripe (e.g., cheque via QuickBooks).
 * Suppresses Stripe reminder emails if a linked Stripe invoice exists, and
 * settles the payment into the org's membership state.
 *
 * That last part used to be missing: this path flipped the invoice row and
 * stopped there, so a renewal settled by cheque or EFT left
 * membership_expires_at untouched — the org read "paid" with no year bought,
 * and every expiry-driven surface (the conference renewal gate, election
 * eligibility) still treated them as owing. It now runs the same
 * settlePaidInvoiceMembership() the Stripe webhook does.
 *
 * Activation is keyed on the Stripe invoice id where one exists, so this and
 * a late-arriving `invoice.paid` for the same invoice dedupe against each
 * other instead of activating twice.
 */
export async function markInvoicePaidOutOfBand(
  invoiceId: string,
  source: "quickbooks" | "manual",
  externalPaymentId: string,
  paidAt: string
): Promise<{ success: boolean; error?: string; activationError?: string }> {
  const db = createAdminClient();

  // 1. Load invoice
  const { data: invoice } = await db
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (!invoice) return { success: false, error: "Invoice not found" };

  // Check it hasn't already been settled
  if (["paid", "refunded_full", "refunded_partial", "voided"].includes(invoice.status)) {
    return {
      success: false,
      error: `Invoice already in terminal status: ${invoice.status}`,
    };
  }

  const now = new Date().toISOString();

  // 2. Update local invoice
  await db
    .from("invoices")
    .update({
      status: "paid",
      payment_source: source,
      external_payment_id: externalPaymentId,
      paid_out_of_band_at: paidAt,
      paid_at: paidAt,
      reminder_suppressed_at: now,
      updated_at: now,
    })
    .eq("id", invoiceId);

  // 3. If Stripe invoice exists, void it to stop reminder emails
  if (invoice.stripe_invoice_id) {
    try {
      const stripeInv = await stripe.invoices.retrieve(
        invoice.stripe_invoice_id
      );
      // Can only void open invoices; draft invoices can be deleted
      if (stripeInv.status === "open") {
        await stripe.invoices.voidInvoice(invoice.stripe_invoice_id);
      } else if (stripeInv.status === "draft") {
        // Mark as void locally; Stripe draft invoices don't send reminders
        // but we can delete them to keep Stripe clean
        await stripe.invoices.del(invoice.stripe_invoice_id);
      }
    } catch {
      // Non-fatal: local record is already marked paid.
      // Stripe invoice state is secondary.
      console.warn(
        `Failed to void/delete Stripe invoice ${invoice.stripe_invoice_id} for out-of-band payment`
      );
    }
  }

  // 4. Settle into membership state — advance the expiry for invoices that
  // carry a billing period, lift grace for those that don't. Deliberately
  // does not fail the settlement: the money is real and the invoice is
  // already marked paid, so an activation problem is reported alongside
  // success rather than unwinding it.
  const settlement = await settlePaidInvoiceMembership({
    organizationId: invoice.organization_id,
    invoiceId: invoice.id,
    billingPeriodStart: invoice.billing_period_start,
    billingPeriodEnd: invoice.billing_period_end,
    triggeredBy: "out_of_band",
    idempotencyKey: invoice.stripe_invoice_id ?? `invoice:${invoice.id}`,
    metadata: { payment_source: source, external_payment_id: externalPaymentId },
  });

  return settlement.error
    ? { success: true, activationError: settlement.error }
    : { success: true };
}
