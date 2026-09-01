// createAdminClient/transitionMembershipState/stripe use the @/ alias to
// match the exact specifier vi.mock() registers in
// lib/stripe/__tests__/webhook-processing.test.ts (this module is pulled in
// unmocked by that suite, but its own dependencies on already-mocked modules
// must use the same specifier the mock is keyed on — vitest has no real @/
// alias resolver, so mocked-vs-relative choice per import is deliberate).
import { createAdminClient } from "@/lib/supabase/admin";
import { transitionMembershipState } from "@/lib/membership/state-machine";
import { stripe } from "@/lib/stripe/client";
// renewal/events and policy/engine have no existing mock anywhere, so they
// must resolve for real (getRenewalConfig's own createAdminClient call uses
// the "@/" alias internally, which the existing mocks in this suite already
// cover — no new mock needed).
import { recordRenewalEvent } from "../renewal/events";
import { getRenewalConfig } from "../policy/engine";
// Same reasoning as the two above: `mirror` is not mocked in any suite, so
// it must resolve for real. Its own dependencies use the "@/" alias and so
// pick up the existing mocks.
import { mirrorFieldsToMembership } from "./mirror";

/**
 * The membership/partnership fiscal year boundary (e.g. "09-01") is an
 * admin-editable policy value (renewal.cycle_start_month_day) — the single
 * source of truth every renewal date, reminder countdown, and late-joiner
 * proration cutoff is computed relative to. Returns the boundary date
 * (the day before the next cycle start) strictly after `date` — a date
 * that IS already exactly that boundary rolls to the FOLLOWING cycle's
 * boundary, not itself.
 */
function nextFiscalYearEnd(date: Date, cycleStartMonthDay: string): string {
  const [startMonth, startDay] = cycleStartMonthDay.split("-").map(Number);
  const dateYear = date.getUTCFullYear();
  const dateMonth = date.getUTCMonth() + 1;
  const dateDay = date.getUTCDate();

  const onOrAfterStart = dateMonth > startMonth || (dateMonth === startMonth && dateDay >= startDay);
  const cycleStartYear = onOrAfterStart ? dateYear : dateYear - 1;

  const boundaryBefore = (cycleStartYearForNextStart: number) => {
    const nextCycleStart = new Date(Date.UTC(cycleStartYearForNextStart, startMonth - 1, startDay));
    return new Date(nextCycleStart.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  };

  const boundary = boundaryBefore(cycleStartYear + 1);
  if (date.toISOString().split("T")[0] === boundary) {
    return boundaryBefore(cycleStartYear + 2);
  }
  return boundary;
}

/**
 * The next occurrence of the shared cycle-start date (renewal.cycle_start_month_day)
 * on or after `date` — e.g. "when is the upcoming Sep 1 renewal deadline
 * from today." Used by the reminder cron, which counts down to one shared
 * date for every org rather than each org's own (possibly unset) expiry.
 */
export function nextCycleStartOnOrAfter(date: Date, cycleStartMonthDay: string): string {
  const [month, day] = cycleStartMonthDay.split("-").map(Number);
  const year = date.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const result = candidate.getTime() >= date.getTime() ? candidate : new Date(Date.UTC(year + 1, month - 1, day));
  return result.toISOString().split("T")[0];
}

/**
 * True when `today` is within the admin-configured pre-renewal skip-stub
 * window (renewal.pre_renewal_skip_stub_days) of the next cycle-start
 * anniversary — the point past which a signup is priced/covered as the year
 * ahead rather than a small prorated stub of the dying cycle. Shared by
 * every caller that used to duplicate this day-count inline
 * (conference-commerce.ts, prospective-booth-checkout.ts) plus the plain
 * membership/partnership pricing path (lib/stripe/billing.ts's
 * applyProration, and the public pricing-table display).
 */
export function isWithinPreRenewalSkipWindow(
  today: Date,
  cycleStartMonthDay: string,
  preRenewalSkipStubDays: number
): boolean {
  const cycleStartDate = nextCycleStartOnOrAfter(today, cycleStartMonthDay);
  const daysUntilCycleStart = Math.round(
    (new Date(`${cycleStartDate}T00:00:00Z`).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  return daysUntilCycleStart <= preRenewalSkipStubDays;
}

/**
 * Anchor a new membership period to the fiscal year. If the current expiry
 * is null or already in the past, anchors to today instead — otherwise a
 * long-lapsed org would "renew" into a period that's still in the past.
 *
 * `mustCoverThrough` (e.g. a conference's end date) advances the boundary an
 * extra fiscal year at a time until the result actually covers it. Without
 * this, a booth bought far enough ahead of a conference could "renew" into a
 * period that still doesn't reach the conference — the customer would pay
 * for a renewal that doesn't satisfy the gate that prompted it.
 *
 * Also reports `isLateJoin` and `cyclesBridged` so a caller can price this
 * correctly: proration (billing.proration_rules) only ever discounts the
 * FIRST, partial cycle of a genuine late join — every additional full cycle
 * bridged to reach a further-future mustCoverThrough date is full price, and
 * an org with a currently-valid (non-lapsed) expiry that's simply being
 * extended further isn't a "late join" at all, so gets no discount anywhere.
 */
export async function computeNewExpiresAt(
  currentExpiresAt: string | null,
  mustCoverThrough?: string | null
): Promise<{
  billingPeriodStart: string;
  billingPeriodEnd: string;
  isLateJoin: boolean;
  cyclesBridged: number;
}> {
  const { cycle_start_month_day: cycleStartMonthDay } = await getRenewalConfig();

  const now = new Date();
  const anchorCandidate = currentExpiresAt
    ? new Date(`${currentExpiresAt.split("T")[0]}T00:00:00Z`)
    : now;
  // No prior expiry at all (never joined) is just as much a "late join" as
  // a lapsed one — either way there's no valid future coverage to extend.
  const isLateJoin = !currentExpiresAt || anchorCandidate.getTime() < now.getTime();
  const start = isLateJoin ? now : anchorCandidate;

  const { end, cycles } = bridgeFrom(start, mustCoverThrough, cycleStartMonthDay);

  return {
    billingPeriodStart: start.toISOString().split("T")[0],
    billingPeriodEnd: end,
    isLateJoin,
    cyclesBridged: cycles,
  };
}

function bridgeFrom(
  anchor: Date,
  mustCoverThrough: string | null | undefined,
  cycleStartMonthDay: string
): { end: string; cycles: number } {
  let end = nextFiscalYearEnd(anchor, cycleStartMonthDay);
  let cycles = 1;
  while (mustCoverThrough && end < mustCoverThrough) {
    end = nextFiscalYearEnd(new Date(`${end}T00:00:00Z`), cycleStartMonthDay);
    cycles++;
  }
  return { end, cycles };
}

/**
 * How many fiscal-year cycles from a KNOWN anchor date (regardless of
 * whether it's in the past or future) until the result covers
 * `mustCoverThrough`. Pure "how many boundaries from here" arithmetic — no
 * judgment about whether the anchor represents a late join.
 *
 * Used to price two cases correctly without double-counting: (1) an org
 * catching up on a lapsed cycle — once that missed cycle is paid, they're
 * "caught up" as of their OLD expiry, so bridge from THERE (not from today)
 * to find how many ADDITIONAL cycles are needed; (2) an org whose stub
 * period is being skipped entirely — bridge from the upcoming cycle START
 * date, not from today, so the very next real cycle counts as cycle 1, not
 * as a second cycle stacked after an uncounted stub.
 */
export async function cyclesNeededFrom(
  anchorDate: string,
  mustCoverThrough: string | null
): Promise<number> {
  const { cycle_start_month_day: cycleStartMonthDay } = await getRenewalConfig();
  const anchor = new Date(`${anchorDate.split("T")[0]}T00:00:00Z`);
  return bridgeFrom(anchor, mustCoverThrough, cycleStartMonthDay).cycles;
}

export interface ActivateMembershipRenewalParams {
  organizationId: string;
  /** ISO date (YYYY-MM-DD) the new membership period ends. */
  newExpiresAt: string;
  /** ISO date (YYYY-MM-DD) the new membership period starts. */
  billingPeriodStart: string;
  triggeredBy: "stripe_webhook" | "conference_checkout" | "out_of_band";
  /** Idempotency key — e.g. the Stripe invoice id, or `conference_order:<id>`. */
  idempotencyKey: string;
  /** Local invoices.id this activation is settling, if any. */
  invoiceId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * The single place that advances organizations.membership_expires_at.
 * Used by both the normal invoice-webhook renewal path and the bundled
 * conference-checkout path so the two never drift.
 */
export async function activateMembershipRenewal(
  params: ActivateMembershipRenewalParams
): Promise<{ success: boolean; error?: string; alreadyProcessed?: boolean }> {
  const db = createAdminClient();

  // Idempotency guard — Stripe webhooks can retry, and this may be called
  // more than once for the same payment. Non-atomic check-then-act, same
  // risk tolerance the renewal cron already uses in production.
  const { data: existingEvent } = await db
    .from("renewal_events")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("event_type", "charge_succeeded")
    .contains("metadata", { idempotency_key: params.idempotencyKey })
    .limit(1)
    .maybeSingle();

  if (existingEvent) {
    return { success: true, alreadyProcessed: true };
  }

  const { data: org, error: orgError } = await db
    .from("organizations")
    .select("membership_status, membership_expires_at")
    .eq("id", params.organizationId)
    .single();

  if (orgError || !org) {
    return { success: false, error: orgError?.message ?? "Organization not found." };
  }

  const { error: updateError } = await db
    .from("organizations")
    .update({ membership_expires_at: params.newExpiresAt })
    .eq("id", params.organizationId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // Phase 4: keep `memberships.expires_at` in step with the authoritative
  // organizations write above. Best-effort and non-blocking by contract —
  // this must never fail the activation, since the org column is what every
  // live consumer reads today (the renewal cron's gate included). Placed
  // after the update rather than beside it so a mirror failure can't strand
  // a paid org without its new expiry.
  await mirrorFieldsToMembership(
    params.organizationId,
    { expires_at: params.newExpiresAt },
    { source: "activateMembershipRenewal" }
  );

  if (org.membership_status === "grace" || org.membership_status === "locked" || org.membership_status === "approved") {
    // "approved" here is a first-time activation, not a renewal — an org
    // whose partnership/membership application was approved but who hasn't
    // paid yet. createPartnershipInvoice/createMembershipInvoice set a
    // billing period on that first invoice same as any renewal, so this
    // webhook path is what actually moves them into "active" once it's
    // paid. Without this branch, the expiry date got set correctly but the
    // org stayed stuck on "approved" forever — masked as if logged out,
    // with no way for its own admin to edit the profile.
    const nextStatus = org.membership_status === "locked" ? "reactivated" : "active";
    // The Stripe-driven sources (the invoice-paid event, the
    // conference-checkout-session-completed event) both map to
    // "stripe_webhook"; a payment recorded outside Stripe entirely — a
    // cheque or EFT settled through markInvoicePaidOutOfBand — has no
    // webhook behind it, so it logs as "system". The richer
    // params.triggeredBy is preserved in the renewal_events metadata below.
    const transitionResult = await transitionMembershipState(
      params.organizationId,
      nextStatus,
      params.triggeredBy === "out_of_band" ? "system" : "stripe_webhook",
      null,
      org.membership_status === "approved" ? "First payment received" : "Renewal payment received"
    );
    if (!transitionResult.success) {
      // Don't fail the whole activation over a status transition — the
      // expiry date (the actual bug being fixed) is already correct. Log
      // and continue; an admin can fix status manually if this ever fires.
      console.error(
        `[membership] status transition failed for org ${params.organizationId} after renewal payment: ${transitionResult.error}`
      );
    }
  }

  // Void any other pending renewal invoice for this org so the cron doesn't
  // double-bill. Mirrors optOutOfRenewal() in lib/actions/renewal.ts.
  const { data: pendingInvoices } = await db
    .from("invoices")
    .select("id, status, stripe_invoice_id")
    .eq("organization_id", params.organizationId)
    .in("status", ["invoiced", "pending_settlement", "draft"])
    .neq("id", params.invoiceId ?? "00000000-0000-0000-0000-000000000000");

  for (const inv of pendingInvoices ?? []) {
    await db
      .from("invoices")
      .update({ status: "voided", updated_at: new Date().toISOString() })
      .eq("id", inv.id);

    if (inv.stripe_invoice_id) {
      try {
        const stripeInvoice = await stripe.invoices.retrieve(inv.stripe_invoice_id);
        if (stripeInvoice.status === "open") {
          await stripe.invoices.voidInvoice(inv.stripe_invoice_id);
        } else if (stripeInvoice.status === "draft") {
          await stripe.invoices.del(inv.stripe_invoice_id);
        }
      } catch (err) {
        console.error(`[membership] failed to void Stripe invoice ${inv.stripe_invoice_id}:`, err);
        // Non-fatal — local state is already voided.
      }
    }
  }

  await recordRenewalEvent(
    db,
    params.organizationId,
    new Date(params.newExpiresAt).getFullYear(),
    "charge_succeeded",
    params.invoiceId ?? undefined,
    {
      idempotency_key: params.idempotencyKey,
      triggered_by: params.triggeredBy,
      previous_expires_at: org.membership_expires_at,
      new_expires_at: params.newExpiresAt,
      billing_period_start: params.billingPeriodStart,
      ...params.metadata,
    }
  );

  return { success: true };
}

/**
 * Settle a just-paid membership/partnership invoice into the org's
 * membership state. The single shared tail for every way an invoice can be
 * paid — the Stripe `invoice.paid` webhook, the Stripe reconcile sweeper,
 * and out-of-band settlement (cheque/EFT recorded in QuickBooks) via
 * markInvoicePaidOutOfBand — so no payment channel can quietly take money
 * without advancing the year it bought.
 *
 * Invoices carrying a billing period (everything createProgramInvoice makes)
 * advance `membership_expires_at` through activateMembershipRenewal.
 * Invoices without one were created outside the renewal flow — a GST/HST
 * correction, a hand-made Stripe invoice — and deliberately buy no time:
 * they only lift an org out of `grace`, exactly as before.
 *
 * Never throws. A failure here must not unwind an invoice that is already
 * genuinely paid, so problems are reported back to the caller (and logged)
 * rather than raised.
 */
export async function settlePaidInvoiceMembership(params: {
  organizationId: string;
  invoiceId?: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  triggeredBy: ActivateMembershipRenewalParams["triggeredBy"];
  /** Stripe invoice id where one exists, so the webhook and out-of-band
   *  paths dedupe against each other rather than double-activating. */
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<{ activated: boolean; error?: string }> {
  const db = createAdminClient();

  if (params.billingPeriodEnd) {
    const result = await activateMembershipRenewal({
      organizationId: params.organizationId,
      newExpiresAt: params.billingPeriodEnd,
      billingPeriodStart: params.billingPeriodStart ?? params.billingPeriodEnd,
      triggeredBy: params.triggeredBy,
      idempotencyKey: params.idempotencyKey,
      invoiceId: params.invoiceId ?? null,
      metadata: params.metadata,
    });

    if (!result.success) {
      console.error(
        `[membership] activation failed for org ${params.organizationId} (${params.triggeredBy}): ${result.error}`
      );
      return { activated: false, error: result.error };
    }
    return { activated: true };
  }

  // No billing period — buys no time. Only lift an org out of grace.
  const { data: org, error } = await db
    .from("organizations")
    .select("membership_status")
    .eq("id", params.organizationId)
    .single();

  if (error || !org) {
    const message = error?.message ?? "Organization not found.";
    console.error(
      `[membership] could not read status for org ${params.organizationId} (${params.triggeredBy}): ${message}`
    );
    return { activated: false, error: message };
  }

  if (org.membership_status === "grace") {
    const transition = await transitionMembershipState(
      params.organizationId,
      "active",
      params.triggeredBy === "out_of_band" ? "system" : "stripe_webhook",
      null,
      "Renewal payment received"
    );
    if (!transition.success) {
      console.error(
        `[membership] grace→active failed for org ${params.organizationId} (${params.triggeredBy}): ${transition.error}`
      );
      return { activated: false, error: transition.error };
    }
  }

  return { activated: false };
}
