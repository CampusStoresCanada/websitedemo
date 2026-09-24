"use server";

import { requireAuthenticated, canManageOrganization, isGlobalAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { transitionMembershipState } from "@/lib/membership/state-machine";
import { createProgramInvoice, finalizeAndSendInvoice } from "@/lib/stripe/billing";
import { stripe } from "@/lib/stripe/client";
import { computeNewExpiresAt } from "@/lib/membership/renewal-activation";
import { getActivePolicySet } from "@/lib/policy/engine";
import { sendTransactional } from "@/lib/comms/send";
import { resolveRenewalRecipients } from "@/lib/renewal/jobs";
import { resolveOptOutScope } from "@/lib/renewal/opt-out-scope";
import type { Json } from "@/lib/database.types";

// ─────────────────────────────────────────────────────────────────
// Opt Out of Renewal
// ─────────────────────────────────────────────────────────────────

/**
 * Allows an org admin (or global admin) to decline the organization's NEXT
 * renewal. It never touches coverage they have already paid for.
 *
 * With coverage still in force (membership_expires_at in the future):
 *   1. Records an opt_out event against the cycle that begins when the
 *      current term ends
 *   2. Leaves status, invoices and money exactly as they are
 *
 * With no coverage left (expired, or in grace having never paid):
 *   1. Voids any unpaid invoice for that cycle (local + Stripe)
 *   2. Records the opt_out event
 *   3. Transitions org to "canceled" via state machine
 *
 * Neither path issues a refund. See the note in the body.
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

  // ── Which cycle is the member opting out of? ──────────────────
  // The rule itself lives in lib/renewal/opt-out-scope.ts, with the Langara
  // case that forced it. Short version: an opt-out declines the NEXT thing we
  // would bill for, and never touches coverage already paid for.
  const now = new Date();
  const todayISO = now.toISOString().split("T")[0];
  const { coverageInForce, renewalYear } = resolveOptOutScope(
    org.membership_expires_at,
    todayISO
  );
  const expiresAt = org.membership_expires_at?.split("T")[0] ?? null;

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

  // ── Void only invoices for the cycle being opted out of ───────
  // A member with coverage still in force keeps every invoice they have —
  // including the paid one funding the current term. Only an unpaid invoice
  // for the cycle we are being told not to bill gets voided.
  let voidedInvoiceId: string | null = null;

  if (!coverageInForce) {
    const { data: pendingInvoices } = await db
      .from("invoices")
      .select("id, status, stripe_invoice_id, paid_at, total_cents")
      .eq("organization_id", orgId)
      .in("status", ["invoiced", "pending_settlement", "draft"])
      .order("created_at", { ascending: false });

    for (const inv of pendingInvoices ?? []) {
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

  // No refund is issued here, by design. Returning money is a deliberate
  // finance decision with an accounting entry behind it, not a side effect of
  // a member setting a preference. The old code called processRefund() from
  // this path; for Langara that marked a $551.25 invoice refunded_full while
  // moving no money and writing nothing to QuickBooks, because the payment had
  // arrived out of band and there was no Stripe charge to reverse.

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
        refunded_invoice_id: null,
        from_status: org.membership_status,
        coverage_in_force: coverageInForce,
        coverage_through: expiresAt,
      })
    ) as Json,
  });

  // ── Transition only when there is no coverage left ────────────
  // An in-force member stays exactly as they are. The opt_out event above is
  // the whole record, and renewalReminderRun reads it to skip them when the
  // cycle they declined comes around.
  if (!coverageInForce) {
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
// Undo a cancellation
// ─────────────────────────────────────────────────────────────────

/**
 * Puts a canceled organization back to active. For correcting a cancellation
 * that should not have happened, nothing else.
 *
 * This exists because there was no way to undo one. `canceled -> active` has
 * always been a legal transition (lib/membership/types.ts) but every caller of
 * transitionMembershipState was a cron, the Stripe webhook, or the application
 * flow, so a mistaken cancellation could only be corrected by writing to
 * `organizations` directly, which skips the audit row. Langara College
 * (2026-09) is the case: an opt-out cancelled a paid, in-force membership, and
 * putting it right needed an audited path that did not exist.
 *
 * Deliberately NOT a re-enrolment tool. It refuses an org with no coverage
 * left, because someone who genuinely lapsed rejoins by being invoiced and
 * paying, and that payment already flips them canceled -> active through the
 * webhook. Reviving an expired org here would only park them in `active` for
 * the grace cron to knock straight back out, with no money behind it.
 *
 * Global admins only. An org's own admin cannot un-cancel themselves.
 */
export async function reviveMembership(
  orgId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const { ctx } = auth;
  if (!isGlobalAdmin(ctx.globalRole)) {
    return { success: false, error: "Only a global admin can revive a membership" };
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    // The audit row is the whole point. A blank reason makes a corrected
    // record indistinguishable from an unexplained one later.
    return { success: false, error: "A reason is required" };
  }

  const db = createAdminClient();

  const { data: org, error: orgErr } = await db
    .from("organizations")
    .select("id, name, membership_status, membership_expires_at")
    .eq("id", orgId)
    .single();

  if (orgErr || !org) {
    return { success: false, error: "Organization not found" };
  }

  if (org.membership_status !== "canceled") {
    return {
      success: false,
      error: `Only a canceled organization can be revived. This one is "${org.membership_status}".`,
    };
  }

  const todayISO = new Date().toISOString().split("T")[0];
  const expiresAt = org.membership_expires_at?.split("T")[0] ?? null;
  if (!expiresAt || expiresAt < todayISO) {
    return {
      success: false,
      error:
        "This organization has no paid coverage left, so there is nothing to restore. " +
        "Invoice them and let the payment reactivate the membership.",
    };
  }

  const transitionResult = await transitionMembershipState(
    orgId,
    "active",
    "admin",
    ctx.userId,
    trimmedReason,
    { revived_from: "canceled", coverage_through: expiresAt }
  );

  if (!transitionResult.success) {
    return { success: false, error: transitionResult.error };
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Revive a lapsed member into grace
// ─────────────────────────────────────────────────────────────────

/**
 * Put a canceled organization back into `grace` — the move for a former
 * member who is rejoining, made before any money has arrived.
 *
 * reviveMembership above is the other half of the pair and deliberately
 * refuses this case: it only un-does a cancellation that should not have
 * happened, for an org whose paid coverage is still running. An org with no
 * coverage left has nothing to restore, and parking it in `active` unpaid
 * would be a lie the grace cron cannot even see (it filters
 * `membership_expires_at is not null`, so a long-lapsed org would sit there
 * unbilled and unpoliced indefinitely).
 *
 * `grace` is the honest state for "back in, not yet paid", and every
 * downstream consumer already understands it, which is why this needed one
 * new transition and nothing else:
 *
 *   - ACCESS_ACTIVE_STATUSES (lib/contacts/login-policy.ts) contains grace, so
 *     portal and Circle access come back — and, importantly, a successor org
 *     admin becomes appointable. That gate is what made an admin handover at a
 *     lapsed org impossible: appointing one requires an active membership,
 *     while the outgoing admin could not be demoted either, because
 *     changeOrgUserRole refuses to remove the last one.
 *   - renewableStatuses in renewMembershipNow contains grace, so the ordinary
 *     Renew Now button raises the invoice. No separate admin billing path, and
 *     the amount and coverage dates come from the same place as every other
 *     renewal.
 *   - The grace job (lib/renewal/jobs.ts) keys off grace_period_started_at,
 *     which the RPC sets on entry, so the normal grace → locked clock runs
 *     even with no expiry on file.
 *   - settlePaidInvoiceMembership lifts grace → active when they pay.
 *
 * Global admins only, reason required — the state log is the only record of
 * why an org that had left is back, and `grace` hands real access to someone
 * who has not paid yet.
 */
export async function reviveMembershipToGrace(
  orgId: string,
  reason: string
): Promise<{ success: boolean; error?: string; invoiceUrl?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const { ctx } = auth;
  if (!isGlobalAdmin(ctx.globalRole)) {
    return { success: false, error: "Only a global admin can revive a membership" };
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { success: false, error: "A reason is required" };
  }

  const db = createAdminClient();

  const { data: org, error: orgErr } = await db
    .from("organizations")
    .select("id, name, membership_status, membership_expires_at")
    .eq("id", orgId)
    .single();

  if (orgErr || !org) {
    return { success: false, error: "Organization not found" };
  }

  // `grace` is accepted as well as `canceled`, so this is re-runnable. The
  // first version only moved the org and left billing to the Renew Now card —
  // which turned out to be unreachable afterwards. That card needs
  // `renewalWindowOpen || !isOrgAccessActive(status)`, and once an org sits in
  // grace BOTH are false outside the 30-day reminder window: grace counts as
  // access-active, and an org with no expiry counts down to the next shared
  // cycle start, ~11 months out. So reviving hid the only button that could
  // bill them. Orgs stranded that way still need a way out, and re-clicking is
  // it — the billing step below is idempotent.
  if (org.membership_status !== "canceled" && org.membership_status !== "grace") {
    return {
      success: false,
      error: `Only a canceled or lapsed organization can be revived. This one is "${org.membership_status}".`,
    };
  }

  // Coverage still in force is reviveMembership's case, not this one. Starting
  // a grace clock on a member who has already paid through a future date would
  // put them on a countdown to `locked` that their own money should have
  // prevented.
  const todayISO = new Date().toISOString().split("T")[0];
  const expiresAt = org.membership_expires_at?.split("T")[0] ?? null;
  if (expiresAt && expiresAt >= todayISO) {
    return {
      success: false,
      error:
        "This organization still has paid coverage, so it should be restored to active rather than put into grace.",
    };
  }

  // Move them first. It is the cheap, reversible half, and an invoice raised
  // against a still-`canceled` org would be the misleading order.
  if (org.membership_status === "canceled") {
    const transitionResult = await transitionMembershipState(
      orgId,
      "grace",
      "admin",
      ctx.userId,
      trimmedReason,
      { revived_from: "canceled", had_coverage_through: expiresAt }
    );

    if (!transitionResult.success) {
      return { success: false, error: transitionResult.error };
    }
  }

  // Then bill them. Reviving without an invoice is the state that stranded
  // Mohawk College and Saint Mary's: in grace, on a 30-day clock to `locked`,
  // with nothing asking them for money and no screen able to. The reminder
  // cron cannot rescue them either — it reads only `active`/`reactivated`
  // orgs (lib/renewal/jobs.ts), so a grace org is never swept up.
  const invoiceResult = await issueRenewalInvoice({
    db,
    orgId,
    currentExpiresAt: org.membership_expires_at ?? null,
    actorId: ctx.userId,
    reason: trimmedReason,
  });

  if (!invoiceResult.success) {
    // The move already happened and is correct on its own. Say so, rather than
    // implying nothing ran — otherwise the next click looks like a retry of
    // something that never started.
    return {
      success: false,
      error: `Moved to grace, but the invoice failed: ${invoiceResult.error ?? "unknown error"}. Click again to retry billing.`,
    };
  }

  return { success: true, invoiceUrl: invoiceResult.invoiceUrl };
}

/**
 * Raise, finalize and send this organization's renewal invoice, and record the
 * `invoice_generated` event against the cycle it covers.
 *
 * The same path the renewal cron and Renew Now use (createProgramInvoice plus
 * computeNewExpiresAt's cycle-anchored period), so the amount and the coverage
 * dates are identical however the invoice was triggered.
 *
 * Idempotent: an unpaid invoice already on the org is reused rather than
 * duplicated, so re-clicking Revive after a partial failure finishes the job
 * instead of double-billing.
 *
 * Not exported, so it is not a server action.
 */
async function issueRenewalInvoice(params: {
  db: ReturnType<typeof createAdminClient>;
  orgId: string;
  currentExpiresAt: string | null;
  actorId: string | null;
  reason: string;
}): Promise<{ success: boolean; error?: string; invoiceUrl?: string }> {
  const { db, orgId, currentExpiresAt, actorId, reason } = params;

  try {
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
      const { billingPeriodStart, billingPeriodEnd } =
        await computeNewExpiresAt(currentExpiresAt);

      const invoice = await createProgramInvoice(orgId, {
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
            triggered_by: "admin_revive",
            actor_id: actorId,
            reason,
          })
        ) as Json,
      });
    }

    if (!stripeInvoiceId) {
      return { success: false, error: "Invoice created but not linked to Stripe" };
    }

    const stripeInvoice = await stripe.invoices.retrieve(stripeInvoiceId);
    return { success: true, invoiceUrl: stripeInvoice.hosted_invoice_url ?? undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ─────────────────────────────────────────────────────────────────
// Renew Now (self-serve, on demand)
// ─────────────────────────────────────────────────────────────────

/**
 * Lets an org admin (or global admin) trigger their own renewal invoice
 * immediately, instead of waiting for the reminder cron's 30-day mark or
 * getting swept into it as a side effect of an unrelated purchase (e.g. the
 * conference-commerce membership-gate bundle). Reuses the exact same
 * invoice-generation path the cron uses (createProgramInvoice +
 * computeNewExpiresAt's cycle-anchored billing period), so the amount and
 * coverage dates are identical whichever path
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

    const invoice = await createProgramInvoice(orgId, {
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
