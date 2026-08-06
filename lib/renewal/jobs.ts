import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePolicySet, getRenewalConfig } from "@/lib/policy/engine";
import { transitionMembershipState } from "@/lib/membership/state-machine";
import { computeMembershipAssessment } from "@/lib/membership/pricing";
import { computeNewExpiresAt, nextCycleStartOnOrAfter } from "@/lib/membership/renewal-activation";
import {
  createMembershipInvoice,
  createPartnershipInvoice,
  finalizeAndSendInvoice,
} from "@/lib/stripe/billing";
import { stripe } from "@/lib/stripe/client";
import { sendTransactional } from "@/lib/comms/send";
import { resolveOrgAdminEmails, resolveOrgPrimaryContactEmail } from "@/lib/supabase/user-lookup";
import { DRAFT_PREVIEW_ORG_IDS } from "@/lib/conference/draft-preview";
import type { Json } from "@/lib/database.types";
import {
  hasRenewalEventForOrgYear,
  recordRenewalEvent,
  type RenewalEventType,
} from "@/lib/renewal/events";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface JobResult {
  success: boolean;
  jobRunId: string;
  orgsProcessed: number;
  orgsSucceeded: number;
  orgsFailed: number;
  errors?: string[];
}

const REMINDER_EVENT_MAP: Record<number, RenewalEventType> = {
  30: "reminder_30",
  14: "reminder_14",
  7: "reminder_7",
  0: "reminder_0",
};

// Each org's renewal work is ~5-8s of sequential Stripe calls. At full
// sequential (concurrency 1) this hit Vercel's 300s function timeout at
// 57 of 169 orgs on 2026-08-02. 8 in flight brings ~169 orgs comfortably
// under the limit without leaning on Stripe rate limits.
const RENEWAL_JOB_CONCURRENCY = 8;

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Renewal/billing notices must reach the org_admin(s) — their own login
 * email — not organizations.email, which is the public "Store Contact"
 * address shown on the org page (see components/org/MemberProfile.tsx).
 * Falls back to that public address only if the org has no active
 * org_admin on file yet, so a notice still goes out somewhere rather than
 * silently vanishing.
 */
async function resolveRenewalRecipients(
  db: AdminClient,
  orgId: string,
  fallbackEmail: string | null
): Promise<string[]> {
  const adminEmails = await resolveOrgAdminEmails(db, orgId);
  if (adminEmails.length) return adminEmails;
  if (fallbackEmail) return [fallbackEmail];
  const contactEmail = await resolveOrgPrimaryContactEmail(db, orgId);
  return contactEmail ? [contactEmail] : [];
}

/** Start a job run record and return its ID. */
async function startJobRun(
  db: AdminClient,
  jobType: "reminder_run" | "charge_run" | "grace_check_run"
): Promise<string> {
  const { data, error } = await db
    .from("renewal_job_runs")
    .insert({ job_type: jobType, status: "running" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create job run: ${error?.message}`);
  }

  return data.id;
}

/**
 * Write current counts onto a still-"running" job_run row without marking
 * it complete. Called after every chunk in runWithConcurrency so a run that
 * gets killed by the platform's function timeout (has happened — see
 * 2026-08-02 incident, 57/169 orgs done then silently orphaned at
 * "running"/0-processed) leaves an accurate partial-progress record instead
 * of hiding the failure from anything checking job_run status.
 */
async function updateJobRunProgress(
  db: AdminClient,
  jobRunId: string,
  counts: { orgsProcessed: number; orgsSucceeded: number; orgsFailed: number }
): Promise<void> {
  await db
    .from("renewal_job_runs")
    .update({
      orgs_processed: counts.orgsProcessed,
      orgs_succeeded: counts.orgsSucceeded,
      orgs_failed: counts.orgsFailed,
    })
    .eq("id", jobRunId);
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight at once,
 * calling `onChunkDone` after each batch settles. Each org's renewal work
 * is several sequential Stripe calls (~5-8s) — fully sequential processing
 * of 169 orgs is what hit the 300s platform timeout at 57 orgs on
 * 2026-08-02. Bounded concurrency cuts wall-clock time roughly by the
 * concurrency factor without hammering Stripe's rate limits.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  onChunkDone: () => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    await Promise.all(chunk.map((item) => worker(item)));
    await onChunkDone();
  }
}

/** Complete a job run record. */
async function completeJobRun(
  db: AdminClient,
  jobRunId: string,
  result: {
    status: "completed" | "failed";
    orgsProcessed: number;
    orgsSucceeded: number;
    orgsFailed: number;
    errorDetails?: unknown;
  }
): Promise<void> {
  await db
    .from("renewal_job_runs")
    .update({
      status: result.status,
      completed_at: new Date().toISOString(),
      orgs_processed: result.orgsProcessed,
      orgs_succeeded: result.orgsSucceeded,
      orgs_failed: result.orgsFailed,
      error_details: result.errorDetails
        ? (JSON.parse(JSON.stringify(result.errorDetails)) as Json)
        : null,
    })
    .eq("id", jobRunId);
}

/**
 * Calculate days until a target date from today.
 * Uses the policy timezone for date calculation.
 */
function daysUntil(targetDateStr: string, timezone: string): number {
  // Get "today" in the policy timezone
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const today = new Date(todayStr + "T00:00:00");

  const target = new Date(targetDateStr.split("T")[0] + "T00:00:00");

  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get the renewal year from an expiry date.
 * The renewal year is the year the membership expires.
 */
function getRenewalYear(expiresAt: string): number {
  return new Date(expiresAt).getFullYear();
}

// Every org shares the same renewal cycle (renewal.cycle_start_month_day) —
// the reminder countdown is one shared "days until cycle start" value, not
// a per-org date, so this only needs to check it once, not per org.
async function precomputeCycleAssessmentsForFirstReminderOrgs(
  orgs: Array<{ id: string; type: string }>,
  daysUntilCycleStart: number,
  firstReminderDay: number,
  cycleBillingPeriodStart: string,
  policySetId: string
): Promise<void> {
  if (daysUntilCycleStart !== firstReminderDay) return;

  for (const org of orgs) {
    if (org.type === "Vendor Partner") continue;

    await computeMembershipAssessment(org.id, {
      policySetId,
      billingPeriodStart: cycleBillingPeriodStart,
      persist: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Job 1: Renewal Reminder Run
// ─────────────────────────────────────────────────────────────────

/**
 * Send renewal reminders at configured day intervals before expiry.
 * On the first reminder (typically 30 days), generates the renewal invoice.
 *
 * Runs daily. Idempotent — checks renewal_events before sending.
 */
export async function renewalReminderRun(): Promise<JobResult> {
  const db = createAdminClient();
  const config = await getRenewalConfig();
  const jobRunId = await startJobRun(db, "reminder_run");

  const errors: string[] = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const reminderDays = config.reminder_days; // e.g., [30, 14, 7, 0]
    const timezone = config.dispatch_timezone; // e.g., "America/Toronto"
    const maxReminderDay = Math.max(...reminderDays);
    const activePolicySet = await getActivePolicySet();
    if (!activePolicySet) {
      throw new Error("No active policy set found for renewal reminder run");
    }

    // Every org renews on the SAME shared calendar date
    // (renewal.cycle_start_month_day) — one countdown for everyone, not a
    // per-org date. This also means an org that has never had its own
    // membership_expires_at set (e.g. never completed a renewal cycle) still
    // gets reminded as the shared date approaches, instead of being silently
    // skipped.
    const cycleStartDate = nextCycleStartOnOrAfter(new Date(), config.cycle_start_month_day);
    const cycleBillingPeriodStart = new Date(
      new Date(`${cycleStartDate}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000
    )
      .toISOString()
      .split("T")[0];
    const daysUntilCycleStart = daysUntil(cycleStartDate, timezone);
    const renewalYear = Number(cycleStartDate.split("-")[0]) + 1;

    // Find all orgs eligible for renewal reminders — active or reactivated.
    // Dedicated test orgs (see draft-preview.ts) are excluded so they never
    // get a live Stripe invoice or reminder email from a production run —
    // 2026-08-05: Test Org (Member)/(Partner) both got real finalized
    // invoices from this job because nothing filtered them out.
    const { data: orgs, error: queryError } = await db
      .from("organizations")
      .select(
        "id, name, email, type, membership_status, membership_expires_at, stripe_customer_id"
      )
      .in("membership_status", ["active", "reactivated"])
      .is("archived_at", null)
      .not("id", "in", `(${DRAFT_PREVIEW_ORG_IDS.join(",")})`);

    if (queryError) {
      throw new Error(`Failed to query orgs: ${queryError.message}`);
    }

    if (!orgs || orgs.length === 0) {
      await completeJobRun(db, jobRunId, {
        status: "completed",
        orgsProcessed: 0,
        orgsSucceeded: 0,
        orgsFailed: 0,
      });
      return { success: true, jobRunId, orgsProcessed: 0, orgsSucceeded: 0, orgsFailed: 0 };
    }

    // Freeze cycle assessments before invoice generation so billing uses
    // deterministic, precomputed amounts tied to a concrete policy set.
    await precomputeCycleAssessmentsForFirstReminderOrgs(
      orgs.map((org) => ({ id: org.id, type: org.type })),
      daysUntilCycleStart,
      maxReminderDay,
      cycleBillingPeriodStart,
      activePolicySet.id
    );

    // Only process orgs within the reminder window — the countdown is the
    // same for every org, so this check happens once, not per org.
    if (daysUntilCycleStart <= maxReminderDay && daysUntilCycleStart >= 0) {
      const worker = async (org: (typeof orgs)[number]) => {
        // An org that already paid through this renewal year or beyond
        // (e.g. bridged multiple cycles at once via `bridgeFrom` in
        // renewal-activation.ts, covering a future conference) shouldn't
        // get a new invoice or a "your membership expires soon" reminder
        // for a cycle its own membership_expires_at already covers.
        if (
          org.membership_expires_at &&
          getRenewalYear(org.membership_expires_at) >= renewalYear
        ) {
          return;
        }

        // Invoice generation is a catch-up check ("has this org gotten its
        // cycle invoice yet?"), not an exact-day match on maxReminderDay.
        // 2026-08-02: the old exact-match gate meant any org missed on the
        // one day it fired (timeout, transient Stripe error) got skipped
        // for the entire renewal year — no invoice, no charge, ever, until
        // someone noticed. Now any day inside the window retries orgs that
        // still don't have one, so a bad day self-heals on the next run.
        const hasInvoice = await hasRenewalEventForOrgYear(
          db,
          org.id,
          renewalYear,
          "invoice_generated"
        );

        let invoiceId: string | undefined;

        if (!hasInvoice) {
          processed++;
          try {
            // Fiscal-year-anchored — shared with the bundled
            // conference-checkout renewal path so both compute the exact
            // same boundary instead of drifting apart. An org with no
            // expiry set at all (active status with a never-populated
            // date) is anchored to the SAME shared cycle boundary every
            // other org uses, not to "today" — otherwise
            // computeNewExpiresAt(null) would anchor to today and produce
            // an invoice for a nonsensical few-week period instead of a
            // real annual one.
            const { billingPeriodStart, billingPeriodEnd } = await computeNewExpiresAt(
              org.membership_expires_at ?? cycleBillingPeriodStart
            );

            const invoice =
              org.type === "Vendor Partner"
                ? await createPartnershipInvoice(org.id, {
                    billingPeriodStart,
                    billingPeriodEnd,
                  })
                : await createMembershipInvoice(org.id, {
                    billingPeriodStart,
                    billingPeriodEnd,
                    policySetId: activePolicySet.id,
                  });

            await finalizeAndSendInvoice(invoice.id);
            invoiceId = invoice.id;

            await recordRenewalEvent(db, org.id, renewalYear, "invoice_generated", invoiceId, {
              billing_period_start: billingPeriodStart,
              billing_period_end: billingPeriodEnd,
            });
            succeeded++;
          } catch (err) {
            failed++;
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`Org ${org.id} (invoice): ${msg}`);
            console.error(`[renewal/reminder] Invoice failed for org ${org.id}:`, msg);
            return; // don't attempt the reminder email without an invoice
          }
        }

        // Exact-day informational reminders (30/14/7/0) — unchanged
        // semantics, still one-shot per day since "days_until_expiry" in
        // the email is only meaningful on the day it names.
        for (const reminderDay of reminderDays) {
          if (daysUntilCycleStart !== reminderDay) continue;

          const eventType = REMINDER_EVENT_MAP[reminderDay];
          if (!eventType) continue;

          const alreadySent = await hasRenewalEventForOrgYear(db, org.id, renewalYear, eventType);
          if (alreadySent) continue;

          processed++;

          try {
            const reminderRecipients = await resolveRenewalRecipients(db, org.id, org.email);
            for (const to of reminderRecipients) {
              await sendTransactional({
                templateKey: "renewal_reminder",
                to,
                variables: {
                  contact_name: org.name,
                  org_name: org.name,
                  renewal_date: cycleBillingPeriodStart,
                  days_until_expiry: reminderDay,
                  invoice_amount: "",
                  invoice_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/org/billing`,
                },
              });
            }

            await recordRenewalEvent(db, org.id, renewalYear, eventType, invoiceId, {
              days_before_expiry: reminderDay,
            });

            succeeded++;
          } catch (err) {
            failed++;
            const msg = err instanceof Error ? err.message : "Unknown error";
            errors.push(`Org ${org.id} (reminder ${reminderDay}): ${msg}`);
            console.error(`[renewal/reminder] Reminder failed for org ${org.id}:`, msg);
          }
        }
      };

      await runWithConcurrency(orgs, RENEWAL_JOB_CONCURRENCY, worker, () =>
        updateJobRunProgress(db, jobRunId, {
          orgsProcessed: processed,
          orgsSucceeded: succeeded,
          orgsFailed: failed,
        })
      );
    }

    await completeJobRun(db, jobRunId, {
      status: failed > 0 && succeeded === 0 ? "failed" : "completed",
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errorDetails: errors.length > 0 ? { errors } : undefined,
    });

    return {
      success: true,
      jobRunId,
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[renewal/reminder] Job failed:", msg);

    await completeJobRun(db, jobRunId, {
      status: "failed",
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errorDetails: { fatal: msg, errors },
    });

    return {
      success: false,
      jobRunId,
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errors: [msg, ...errors],
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Job 2: Renewal Charge Run
// ─────────────────────────────────────────────────────────────────

/**
 * Attempt to charge saved payment methods for orgs with unpaid
 * renewal invoices that are at or past their expiry date.
 *
 * If charge fails or no payment method exists, transition to grace.
 * Webhook handles `invoice.paid` event for successful charges.
 */
export async function renewalChargeRun(): Promise<JobResult> {
  const db = createAdminClient();
  const config = await getRenewalConfig();
  const jobRunId = await startJobRun(db, "charge_run");

  const errors: string[] = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const timezone = config.dispatch_timezone;

    // Find orgs whose membership has expired with unpaid invoices
    const { data: orgs, error: queryError } = await db
      .from("organizations")
      .select(
        "id, name, email, type, membership_status, membership_expires_at, stripe_customer_id"
      )
      .in("membership_status", ["active", "reactivated"])
      .is("archived_at", null)
      .not("membership_expires_at", "is", null)
      .not("id", "in", `(${DRAFT_PREVIEW_ORG_IDS.join(",")})`);

    if (queryError) {
      throw new Error(`Failed to query orgs: ${queryError.message}`);
    }

    if (!orgs || orgs.length === 0) {
      await completeJobRun(db, jobRunId, {
        status: "completed",
        orgsProcessed: 0,
        orgsSucceeded: 0,
        orgsFailed: 0,
      });
      return { success: true, jobRunId, orgsProcessed: 0, orgsSucceeded: 0, orgsFailed: 0 };
    }

    for (const org of orgs) {
      if (!org.membership_expires_at) continue;

      const days = daysUntil(org.membership_expires_at, timezone);

      // Only process orgs at or past expiry
      if (days > 0) continue;

      const renewalYear = getRenewalYear(org.membership_expires_at);

      // Check if charge already attempted today
      const alreadyCharged = await hasRenewalEventForOrgYear(
        db,
        org.id,
        renewalYear,
        "charge_attempted"
      );
      if (alreadyCharged) continue;

      // Find unpaid renewal invoice
      const { data: invoice } = await db
        .from("invoices")
        .select("id, stripe_invoice_id, total_cents, status")
        .eq("organization_id", org.id)
        .in("status", ["invoiced", "pending_settlement"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!invoice) continue; // No unpaid invoice — skip

      processed++;

      try {
        // Record charge attempt
        await recordRenewalEvent(db, org.id, renewalYear, "charge_attempted", invoice.id);

        // Look up default payment method
        const { data: paymentMethod } = await db
          .from("payment_methods")
          .select("stripe_payment_method_id, stripe_customer_id")
          .eq("organization_id", org.id)
          .eq("is_default", true)
          .maybeSingle();

        if (paymentMethod?.stripe_payment_method_id && paymentMethod?.stripe_customer_id) {
          // Attempt charge via Stripe PaymentIntent
          try {
            const paymentIntent = await stripe.paymentIntents.create({
              amount: invoice.total_cents,
              currency: "cad",
              customer: paymentMethod.stripe_customer_id,
              payment_method: paymentMethod.stripe_payment_method_id,
              confirm: true,
              off_session: true,
              metadata: {
                org_id: org.id,
                invoice_id: invoice.id,
                renewal_year: String(renewalYear),
              },
            });

            if (paymentIntent.status === "succeeded") {
              // Update local invoice
              await db
                .from("invoices")
                .update({
                  status: "paid",
                  payment_source: "stripe",
                  paid_at: new Date().toISOString(),
                  stripe_payment_intent_id: paymentIntent.id,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", invoice.id);

              await recordRenewalEvent(
                db,
                org.id,
                renewalYear,
                "charge_succeeded",
                invoice.id,
                { payment_intent_id: paymentIntent.id }
              );

              succeeded++;
              continue;
            }

            // If requires_action or other status — treat as failed for now
            await recordRenewalEvent(
              db,
              org.id,
              renewalYear,
              "charge_failed",
              invoice.id,
              { payment_intent_id: paymentIntent.id, status: paymentIntent.status }
            );
          } catch (stripeErr) {
            const stripeMsg =
              stripeErr instanceof Error ? stripeErr.message : "Stripe error";

            await recordRenewalEvent(
              db,
              org.id,
              renewalYear,
              "charge_failed",
              invoice.id,
              { error: stripeMsg }
            );

            const chargeFailedRecipients = await resolveRenewalRecipients(db, org.id, org.email);
            for (const to of chargeFailedRecipients) {
              await sendTransactional({
                templateKey: "renewal_charge_failed",
                to,
                variables: {
                  contact_name: org.name,
                  org_name: org.name,
                  payment_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/org/billing`,
                },
              });
            }
          }
        } else {
          // No saved payment method
          await recordRenewalEvent(
            db,
            org.id,
            renewalYear,
            "charge_failed",
            invoice.id,
            { reason: "no_payment_method" }
          );
        }

        // Charge failed or no payment method — transition to grace
        if (org.membership_status === "active" || org.membership_status === "reactivated") {
          const transResult = await transitionMembershipState(
            org.id,
            "grace",
            "renewal_job",
            null,
            "Renewal payment failed or no payment method on file"
          );

          if (transResult.success) {
            await recordRenewalEvent(db, org.id, renewalYear, "grace_started", invoice.id);
          }
        }

        failed++;
        errors.push(`Org ${org.id}: charge failed`);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Org ${org.id}: ${msg}`);
        console.error(`[renewal/charge] Failed for org ${org.id}:`, msg);
      }
    }

    await completeJobRun(db, jobRunId, {
      status: failed > 0 && succeeded === 0 ? "failed" : "completed",
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errorDetails: errors.length > 0 ? { errors } : undefined,
    });

    return {
      success: true,
      jobRunId,
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[renewal/charge] Job failed:", msg);

    await completeJobRun(db, jobRunId, {
      status: "failed",
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errorDetails: { fatal: msg, errors },
    });

    return {
      success: false,
      jobRunId,
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errors: [msg, ...errors],
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Job 3: Grace State Transition Run
// ─────────────────────────────────────────────────────────────────

/**
 * Check orgs in grace period. Reconcile payments first, then
 * lock access for orgs whose grace period has expired.
 *
 * Runs daily. Idempotent.
 */
export async function graceStateTransitionRun(): Promise<JobResult> {
  const db = createAdminClient();
  const config = await getRenewalConfig();
  const jobRunId = await startJobRun(db, "grace_check_run");

  const errors: string[] = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const graceDays = config.grace_days; // e.g., 30

    // Find all orgs currently in grace
    const { data: orgs, error: queryError } = await db
      .from("organizations")
      .select(
        "id, name, email, membership_status, membership_expires_at, grace_period_started_at"
      )
      .eq("membership_status", "grace")
      .not("grace_period_started_at", "is", null);

    if (queryError) {
      throw new Error(`Failed to query grace orgs: ${queryError.message}`);
    }

    if (!orgs || orgs.length === 0) {
      await completeJobRun(db, jobRunId, {
        status: "completed",
        orgsProcessed: 0,
        orgsSucceeded: 0,
        orgsFailed: 0,
      });
      return { success: true, jobRunId, orgsProcessed: 0, orgsSucceeded: 0, orgsFailed: 0 };
    }

    for (const org of orgs) {
      if (!org.grace_period_started_at) continue;

      processed++;

      try {
        // Step 1: Reconcile — check if invoice has been paid
        const { data: paidInvoice } = await db
          .from("invoices")
          .select("id, status, payment_source, paid_out_of_band_at")
          .eq("organization_id", org.id)
          .eq("status", "paid")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (paidInvoice) {
          // Payment was received — recover to active
          const transResult = await transitionMembershipState(
            org.id,
            "active",
            "renewal_job",
            null,
            "Payment reconciled during grace period"
          );

          if (transResult.success) {
            const renewalYear = org.membership_expires_at
              ? getRenewalYear(org.membership_expires_at)
              : new Date().getFullYear();

            await recordRenewalEvent(
              db,
              org.id,
              renewalYear,
              "reactivation_payment",
              paidInvoice.id,
              { reconciled_by: "grace_check_run" }
            );

            succeeded++;
            continue;
          }
        }

        // Step 2: Calculate days in grace
        const graceStart = new Date(org.grace_period_started_at);
        const daysInGrace =
          (Date.now() - graceStart.getTime()) / (1000 * 60 * 60 * 24);

        const renewalYear = org.membership_expires_at
          ? getRenewalYear(org.membership_expires_at)
          : new Date().getFullYear();

        if (daysInGrace >= graceDays) {
          // Grace expired — lock access
          const transResult = await transitionMembershipState(
            org.id,
            "locked",
            "renewal_job",
            null,
            `Grace period expired after ${Math.floor(daysInGrace)} days`
          );

          if (transResult.success) {
            await recordRenewalEvent(db, org.id, renewalYear, "access_locked", undefined, {
              days_in_grace: Math.floor(daysInGrace),
              grace_days_policy: graceDays,
            });

            const lockedRecipients = await resolveRenewalRecipients(db, org.id, org.email);
            for (const to of lockedRecipients) {
              await sendTransactional({
                templateKey: "membership_locked",
                to,
                variables: {
                  contact_name: org.name,
                  org_name: org.name,
                  admin_contact_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/contact`,
                },
              });
            }

            succeeded++;
          } else {
            failed++;
            errors.push(`Org ${org.id}: transition to locked failed — ${transResult.error}`);
          }
        } else {
          // Still in grace — send weekly reminder if not sent recently
          const daysSinceLastReminder = await getLastGraceReminderDaysAgo(
            db,
            org.id,
            renewalYear
          );

          if (daysSinceLastReminder === null || daysSinceLastReminder >= 7) {
            await recordRenewalEvent(db, org.id, renewalYear, "grace_reminder", undefined, {
              days_in_grace: Math.floor(daysInGrace),
              days_remaining: Math.ceil(graceDays - daysInGrace),
            });

            const graceReminderRecipients = await resolveRenewalRecipients(db, org.id, org.email);
            for (const to of graceReminderRecipients) {
              await sendTransactional({
                templateKey: "grace_weekly_reminder",
                to,
                variables: {
                  contact_name: org.name,
                  org_name: org.name,
                  grace_days_remaining: Math.ceil(graceDays - daysInGrace),
                  payment_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/org/billing`,
                },
              });
            }
          }

          succeeded++;
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Org ${org.id}: ${msg}`);
        console.error(`[renewal/grace] Failed for org ${org.id}:`, msg);
      }
    }

    await completeJobRun(db, jobRunId, {
      status: failed > 0 && succeeded === 0 ? "failed" : "completed",
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errorDetails: errors.length > 0 ? { errors } : undefined,
    });

    return {
      success: true,
      jobRunId,
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[renewal/grace] Job failed:", msg);

    await completeJobRun(db, jobRunId, {
      status: "failed",
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errorDetails: { fatal: msg, errors },
    });

    return {
      success: false,
      jobRunId,
      orgsProcessed: processed,
      orgsSucceeded: succeeded,
      orgsFailed: failed,
      errors: [msg, ...errors],
    };
  }
}

/** How many days ago was the last grace_reminder for this org/year? */
async function getLastGraceReminderDaysAgo(
  db: AdminClient,
  orgId: string,
  year: number
): Promise<number | null> {
  const { data } = await db
    .from("renewal_events")
    .select("created_at")
    .eq("organization_id", orgId)
    .eq("renewal_year", year)
    .eq("event_type", "grace_reminder")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.created_at) return null;

  return (Date.now() - new Date(data.created_at).getTime()) / (1000 * 60 * 60 * 24);
}
