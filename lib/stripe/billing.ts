import { stripe } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBillingConfig, getEffectivePolicy } from "@/lib/policy/engine";
import { computeMembershipAssessment } from "@/lib/membership/pricing";
import type {
  Invoice,
  PaymentMethod,
  ProrationResult,
  MembershipTier,
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

  if (org.stripe_customer_id) {
    return org.stripe_customer_id;
  }

  return createStripeCustomer(orgId, org.name, org.email ?? "");
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
  const billing = await getBillingConfig();
  const rules = billing.proration_rules as ProrationRule[];

  if (!rules || rules.length === 0) {
    return { amountCents: baseAmountCents, discountPct: 0 };
  }

  // Determine the current fiscal year boundaries
  // CSC fiscal year runs Sep 1 → Aug 31
  const month = startDate.getMonth() + 1; // 1-based
  const day = startDate.getDate();

  // Find the highest applicable discount
  let applicableDiscount = 0;

  for (const rule of rules) {
    const [ruleMonth, ruleDay] = rule.after_month_day.split("-").map(Number);

    // Check if startDate is on or after the rule cutoff (month-day comparison)
    if (month > ruleMonth || (month === ruleMonth && day >= ruleDay)) {
      applicableDiscount = Math.max(applicableDiscount, rule.discount_pct);
    }
  }

  if (applicableDiscount === 0) {
    return { amountCents: baseAmountCents, discountPct: 0 };
  }

  const discountedAmount = Math.round(
    baseAmountCents * (1 - applicableDiscount / 100)
  );

  return {
    amountCents: discountedAmount,
    discountPct: applicableDiscount,
  };
}

// ─────────────────────────────────────────────────────────────────
// Tier Calculation
// ─────────────────────────────────────────────────────────────────

/**
 * Determine the membership tier price based on org FTE.
 * Tiers are sorted ascending by max_fte; null max_fte means unlimited.
 */
export function determineTierPrice(
  fte: number | null,
  tiers: MembershipTier[]
): { price: number; tierIndex: number } {
  const orgFte = fte ?? 0;

  // Sort tiers by max_fte ascending, null (unlimited) last
  const sorted = [...tiers].sort((a, b) => {
    if (a.max_fte === null) return 1;
    if (b.max_fte === null) return -1;
    return a.max_fte - b.max_fte;
  });

  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i];
    if (tier.max_fte === null || orgFte <= tier.max_fte) {
      return { price: tier.price, tierIndex: i };
    }
  }

  // Should not reach here if tiers are well-defined — fallback to last tier
  const lastTier = sorted[sorted.length - 1];
  return { price: lastTier.price, tierIndex: sorted.length - 1 };
}

// ─────────────────────────────────────────────────────────────────
// Invoice Creation
// ─────────────────────────────────────────────────────────────────

/**
 * Create a membership invoice for an org.
 * Reads FTE from org, tiers from policy, applies proration if applicable.
 */
export async function createMembershipInvoice(
  orgId: string,
  options?: {
    applyProrationFromDate?: Date;
    billingPeriodStart?: string;
    billingPeriodEnd?: string;
    policySetId?: string;
  }
): Promise<Invoice> {
  const db = createAdminClient();
  const billing = await getBillingConfig();

  // 1. Read org FTE + stripe customer
  const { data: org, error: orgError } = await db
    .from("organizations")
    .select("id, name, fte, stripe_customer_id, email")
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    throw new Error(`Organization ${orgId} not found`);
  }

  // 2. Compute deterministic policy-pinned assessment for this cycle
  const assessment = await computeMembershipAssessment(orgId, {
    policySetId: options?.policySetId,
    billingPeriodStart: options?.billingPeriodStart,
  });

  if (assessment.assessmentStatus === "manual_required") {
    throw new Error(
      `Membership assessment requires manual override for organization ${orgId}`
    );
  }

  const baseCents = assessment.computedAmountCents;

  // 3. Apply proration if requested
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

  // 4. Ensure Stripe customer exists
  const stripeCustomerId = await ensureStripeCustomer(orgId);

  // 5. Create Stripe invoice
  const stripeInvoice = await stripe.invoices.create({
    customer: stripeCustomerId,
    collection_method: "send_invoice",
    days_until_due: 30,
    currency: billing.currency.toLowerCase(),
    metadata: { org_id: orgId, invoice_type: "membership" },
  });

  // Add line item
  await stripe.invoiceItems.create({
    customer: stripeCustomerId,
    invoice: stripeInvoice.id,
    amount: finalCents,
    currency: billing.currency.toLowerCase(),
    description: `Membership - ${assessment.explanation}${prorationPct > 0 ? `, ${prorationPct}% prorated` : ""}`,
  });

  // 6. Insert local invoice record
  const description = prorationPct > 0
    ? `Membership - ${assessment.explanation} (${prorationPct}% prorated)`
    : `Membership - ${assessment.explanation}`;

  const { data: invoice, error: insertError } = await db
    .from("invoices")
    .insert({
      organization_id: orgId,
      type: "membership",
      description,
      amount_cents: finalCents,
      currency: billing.currency,
      tax_amount_cents: 0,
      total_cents: finalCents,
      proration_discount_pct: prorationPct,
      original_amount_cents: originalCents,
      status: "draft",
      stripe_invoice_id: stripeInvoice.id,
      stripe_customer_id: stripeCustomerId,
      billing_period_start: options?.billingPeriodStart ?? null,
      billing_period_end: options?.billingPeriodEnd ?? null,
      metadata: {
        policy_set_id: assessment.policySetId,
        membership_assessment_id: assessment.id,
        assessment_status: assessment.assessmentStatus,
      },
    })
    .select()
    .single();

  if (insertError || !invoice) {
    throw new Error(`Failed to insert invoice: ${insertError?.message}`);
  }

  return invoice as unknown as Invoice;
}

/**
 * Create a partnership invoice for a vendor partner org.
 */
export async function createPartnershipInvoice(
  orgId: string,
  options?: { applyProrationFromDate?: Date; billingPeriodStart?: string; billingPeriodEnd?: string }
): Promise<Invoice> {
  const db = createAdminClient();
  const billing = await getBillingConfig();

  const baseCents = Math.round(billing.partnership_rate * 100);

  // Apply proration if requested
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

  // Ensure Stripe customer
  const stripeCustomerId = await ensureStripeCustomer(orgId);

  // Create Stripe invoice
  const stripeInvoice = await stripe.invoices.create({
    customer: stripeCustomerId,
    collection_method: "send_invoice",
    days_until_due: 30,
    currency: billing.currency.toLowerCase(),
    metadata: { org_id: orgId, invoice_type: "partnership" },
  });

  await stripe.invoiceItems.create({
    customer: stripeCustomerId,
    invoice: stripeInvoice.id,
    amount: finalCents,
    currency: billing.currency.toLowerCase(),
    description: `Partnership ($${(finalCents / 100).toFixed(2)}${prorationPct > 0 ? `, ${prorationPct}% prorated` : ""})`,
  });

  // Insert local record
  const description = prorationPct > 0
    ? `Partnership ($${billing.partnership_rate}) (${prorationPct}% prorated)`
    : `Partnership ($${billing.partnership_rate})`;

  const { data: invoice, error } = await db
    .from("invoices")
    .insert({
      organization_id: orgId,
      type: "partnership",
      description,
      amount_cents: finalCents,
      currency: billing.currency,
      tax_amount_cents: 0,
      total_cents: finalCents,
      proration_discount_pct: prorationPct,
      original_amount_cents: originalCents,
      status: "draft",
      stripe_invoice_id: stripeInvoice.id,
      stripe_customer_id: stripeCustomerId,
      billing_period_start: options?.billingPeriodStart ?? null,
      billing_period_end: options?.billingPeriodEnd ?? null,
    })
    .select()
    .single();

  if (error || !invoice) {
    throw new Error(`Failed to insert partnership invoice: ${error?.message}`);
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

  // Finalize in Stripe (this sends the invoice email)
  await stripe.invoices.finalizeInvoice(invoice.stripe_invoice_id);
  await stripe.invoices.sendInvoice(invoice.stripe_invoice_id);

  // Update local status
  await db
    .from("invoices")
    .update({ status: "invoiced", updated_at: new Date().toISOString() })
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
    "renewal.refund_window_days"
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
  if (invoice.stripe_payment_intent_id) {
    try {
      await stripe.refunds.create({
        payment_intent: invoice.stripe_payment_intent_id,
        reason: "requested_by_customer",
        metadata: { invoice_id: invoiceId, reason },
      });
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
 * Suppresses Stripe reminder emails if a linked Stripe invoice exists.
 */
export async function markInvoicePaidOutOfBand(
  invoiceId: string,
  source: "quickbooks" | "manual",
  externalPaymentId: string,
  paidAt: string
): Promise<{ success: boolean; error?: string }> {
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

  return { success: true };
}
