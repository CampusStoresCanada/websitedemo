"use server";

import { requireAuthenticated, canManageOrganization, isGlobalAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { transitionMembershipState } from "@/lib/membership/state-machine";
import { processRefund } from "@/lib/stripe/billing";
import { stripe } from "@/lib/stripe/client";
import { sendTransactional } from "@/lib/comms/send";
import type { Json } from "@/lib/database.types";

// ─────────────────────────────────────────────────────────────────
// Opt Out of Renewal
// ─────────────────────────────────────────────────────────────────

/**
 * Allows an org admin (or global admin) to opt the organization
 * out of its upcoming renewal. This:
 *
 * 1. Records an opt_out event in renewal_events
 * 2. Voids any pending renewal invoice (local + Stripe)
 * 3. If the current period was already paid and within refund window,
 *    processes a refund
 * 4. Transitions org to "canceled" via state machine
 *
 * The caller must be an org_admin for the given organization or a
 * global admin / super_admin.
 */
export async function optOutOfRenewal(
  orgId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  // ── Auth ──────────────────────────────────────────────────────
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const { ctx } = auth;
  if (!isGlobalAdmin(ctx.globalRole) && !canManageOrganization(ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const db = createAdminClient();

  // ── Load org ──────────────────────────────────────────────────
  const { data: org, error: orgErr } = await db
    .from("organizations")
    .select("id, name, email, membership_status, membership_expires_at")
    .eq("id", orgId)
    .single();

  if (orgErr || !org) {
    return { success: false, error: "Organization not found" };
  }

  // Only active, grace, or reactivated orgs can opt out
  const optOutableStatuses = ["active", "grace", "reactivated"];
  if (!optOutableStatuses.includes(org.membership_status ?? "")) {
    return {
      success: false,
      error: `Cannot opt out from status "${org.membership_status}". Org must be active, grace, or reactivated.`,
    };
  }

  // ── Determine renewal year ────────────────────────────────────
  const now = new Date();
  const renewalYear =
    now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();

  // ── Check for duplicate opt-out this year ─────────────────────
  const { data: existing } = await db
    .from("renewal_events")
    .select("id")
    .eq("organization_id", orgId)
    .eq("renewal_year", renewalYear)
    .eq("event_type", "opt_out")
    .limit(1);

  if (existing && existing.length > 0) {
    return {
      success: false,
      error: "Organization has already opted out for this renewal period.",
    };
  }

  // ── Find and void any pending renewal invoice ─────────────────
  // Look for invoices for this org with status in (invoiced, pending_settlement, draft)
  const { data: pendingInvoices } = await db
    .from("invoices")
    .select("id, status, stripe_invoice_id, paid_at, total_cents")
    .eq("organization_id", orgId)
    .in("status", ["invoiced", "pending_settlement", "draft"])
    .order("created_at", { ascending: false });

  let voidedInvoiceId: string | null = null;
  let refundedInvoiceId: string | null = null;

  if (pendingInvoices && pendingInvoices.length > 0) {
    for (const inv of pendingInvoices) {
      // Void the local invoice
      await db
        .from("invoices")
        .update({
          status: "voided",
          updated_at: new Date().toISOString(),
        })
        .eq("id", inv.id);

      // Void/delete the Stripe invoice if it exists
      if (inv.stripe_invoice_id) {
        try {
          const stripeInvoice = await stripe.invoices.retrieve(
            inv.stripe_invoice_id
          );
          if (stripeInvoice.status === "open") {
            await stripe.invoices.voidInvoice(inv.stripe_invoice_id);
          } else if (stripeInvoice.status === "draft") {
            await stripe.invoices.del(inv.stripe_invoice_id);
          }
        } catch (err) {
          console.error(
            `[opt-out] Failed to void Stripe invoice ${inv.stripe_invoice_id}:`,
            err
          );
          // Continue — local state is already voided
        }
      }

      voidedInvoiceId = inv.id;
    }
  }

  // ── Check if there's a paid invoice eligible for refund ───────
  // If the org is still within the current billing period and the
  // invoice was recently paid, try to refund it.
  const { data: paidInvoices } = await db
    .from("invoices")
    .select("id, paid_at, total_cents")
    .eq("organization_id", orgId)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(1);

  if (paidInvoices && paidInvoices.length > 0) {
    const latestPaid = paidInvoices[0];
    // Attempt refund — processRefund validates the refund window internally
    const refundResult = await processRefund(
      latestPaid.id,
      `Opt-out: ${reason}`
    );
    if (refundResult.success) {
      refundedInvoiceId = latestPaid.id;
    }
    // If refund fails (outside window), that's fine — just void unpaid invoices
  }

  // ── Record opt-out event ──────────────────────────────────────
  await db.from("renewal_events").insert({
    organization_id: orgId,
    renewal_year: renewalYear,
    event_type: "opt_out" as const,
    invoice_id: voidedInvoiceId,
    metadata: JSON.parse(
      JSON.stringify({
        reason,
        actor_id: ctx.userId,
        voided_invoice_id: voidedInvoiceId,
        refunded_invoice_id: refundedInvoiceId,
        from_status: org.membership_status,
      })
    ) as Json,
  });

  // ── Transition to canceled ────────────────────────────────────
  const transitionResult = await transitionMembershipState(
    orgId,
    "canceled",
    "user",
    ctx.userId,
    `Opt-out: ${reason}`
  );

  if (!transitionResult.success) {
    return {
      success: false,
      error: `Opt-out recorded but state transition failed: ${transitionResult.error}`,
    };
  }

  if (org.email) {
    await sendTransactional({
      templateKey: "opt_out_confirmation",
      to: org.email,
      variables: {
        contact_name: org.name,
        org_name: org.name,
        refund_processed: false,
        effective_date: org.membership_expires_at?.split("T")[0] ?? "",
      },
    });
  }

  return { success: true };
}
