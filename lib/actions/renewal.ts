"use server";

import { requireAuthenticated, canManageOrganization, isGlobalAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { transitionMembershipState } from "@/lib/membership/state-machine";
import { createMembershipInvoice, createPartnershipInvoice, finalizeAndSendInvoice, processRefund } from "@/lib/stripe/billing";
import { stripe } from "@/lib/stripe/client";
import { computeNewExpiresAt } from "@/lib/membership/renewal-activation";
import { getActivePolicySet } from "@/lib/policy/engine";
import { sendTransactional } from "@/lib/comms/send";
import { resolveRenewalRecipients } from "@/lib/renewal/jobs";
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

  const optOutRecipients = await resolveRenewalRecipients(db, org.id, org.email);
  for (const to of optOutRecipients) {
    await sendTransactional({
      templateKey: "opt_out_confirmation",
      to,
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

// ─────────────────────────────────────────────────────────────────
// Renew Now (self-serve, on demand)
// ─────────────────────────────────────────────────────────────────

/**
 * Lets an org admin (or global admin) trigger their own renewal invoice
 * immediately, instead of waiting for the reminder cron's 30-day mark or
 * getting swept into it as a side effect of an unrelated purchase (e.g. the
 * conference-commerce membership-gate bundle). Reuses the exact same
 * invoice-generation path the cron uses (createMembershipInvoice /
 * createPartnershipInvoice + computeNewExpiresAt's cycle-anchored billing
 * period), so the amount and coverage dates are identical whichever path
 * triggers it — only the timing differs.
 *
 * Idempotent: if an unpaid invoice already exists for this org, returns its
 * existing Stripe hosted URL instead of generating a duplicate.
 */
export async function renewMembershipNow(
  orgId: string
): Promise<{ success: boolean; error?: string; invoiceUrl?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const { ctx } = auth;
  if (!isGlobalAdmin(ctx.globalRole) && !canManageOrganization(ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const db = createAdminClient();

  const { data: org, error: orgErr } = await db
    .from("organizations")
    .select("id, name, type, membership_status, membership_expires_at")
    .eq("id", orgId)
    .single();

  if (orgErr || !org) {
    return { success: false, error: "Organization not found" };
  }

  // "locked" is now self-serve reactivation too — computeNewExpiresAt's
  // isLateJoin path already prices a lapsed org's catch-up correctly (see
  // lib/membership/renewal-activation.ts), and the Stripe webhook already
  // flips locked → reactivated on payment. "canceled" stays excluded — it's
  // a deliberate opt-out (optOutOfRenewal voids/refunds invoices) with no
  // reversal path in the state machine (ALLOWED_TRANSITIONS.canceled = []).
  const renewableStatuses = ["active", "reactivated", "grace", "locked"];
  if (!renewableStatuses.includes(org.membership_status ?? "")) {
    return {
      success: false,
      error: `Cannot renew from status "${org.membership_status}". Contact an administrator.`,
    };
  }

  // A membership-renewal cart line added by the conference-commerce
  // bundle (lib/actions/conference-commerce.ts's membership gate) is a
  // completely separate billing artifact from `invoices` — it only becomes
  // a charge at conference checkout, via conference_orders, not this table.
  // Generating a fresh invoice here while one of those is still sitting in
  // an active cart would double-bill the same coverage period, so check for
  // that first.
  const { data: pendingCartRenewal } = await db
    .from("cart_items")
    .select("id, offer:conference_entities!cart_items_offer_entity_id_fkey(kind)")
    .eq("organization_id", orgId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  const hasPendingCartRenewal = (pendingCartRenewal ?? []).some((item) => {
    const offer = Array.isArray(item.offer) ? item.offer[0] : item.offer;
    return offer?.kind === "membership_renewal";
  });
  if (hasPendingCartRenewal) {
    return {
      success: false,
      error:
        "This organization already has a membership renewal in an active conference cart — complete that checkout instead of starting a second one.",
    };
  }

  // Reuse an existing unpaid invoice rather than generating a duplicate —
  // an org that clicks "Renew Now" twice, or that already has a
  // cron-generated invoice waiting, should land on the same invoice both
  // times.
  const { data: existingInvoice } = await db
    .from("invoices")
    .select("id, stripe_invoice_id, status")
    .eq("organization_id", orgId)
    .in("status", ["draft", "invoiced", "pending_settlement"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let stripeInvoiceId: string | null;

  if (existingInvoice) {
    stripeInvoiceId = existingInvoice.stripe_invoice_id;
    if (existingInvoice.status === "draft" && stripeInvoiceId) {
      await finalizeAndSendInvoice(existingInvoice.id);
    }
  } else {
    const { billingPeriodStart, billingPeriodEnd } = await computeNewExpiresAt(
      org.membership_expires_at ?? null
    );

    const invoice =
      org.type === "Vendor Partner"
        ? await createPartnershipInvoice(orgId, { billingPeriodStart, billingPeriodEnd })
        : await createMembershipInvoice(orgId, {
            billingPeriodStart,
            billingPeriodEnd,
            policySetId: (await getActivePolicySet())?.id,
          });

    await finalizeAndSendInvoice(invoice.id);
    stripeInvoiceId = invoice.stripe_invoice_id;

    await db.from("renewal_events").insert({
      organization_id: orgId,
      renewal_year: new Date(billingPeriodEnd).getFullYear(),
      event_type: "invoice_generated" as const,
      invoice_id: invoice.id,
      metadata: JSON.parse(
        JSON.stringify({
          billing_period_start: billingPeriodStart,
          billing_period_end: billingPeriodEnd,
          triggered_by: "org_admin_self_serve",
          actor_id: ctx.userId,
        })
      ) as Json,
    });
  }

  if (!stripeInvoiceId) {
    return { success: false, error: "Invoice created but not linked to Stripe — contact an administrator." };
  }

  const stripeInvoice = await stripe.invoices.retrieve(stripeInvoiceId);
  return { success: true, invoiceUrl: stripeInvoice.hosted_invoice_url ?? undefined };
}
