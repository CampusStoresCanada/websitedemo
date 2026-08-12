/**
 * Prospective booth "pay first, apply second" follow-up.
 *
 * Runs daily via /api/cron/prospective-booth-followup. A prospect who pays
 * for a booth with no org/account yet (see lib/actions/prospective-booth-
 * checkout.ts) is left with one job: finish the partnership application at
 * /apply/partner. Nothing else nudges them if they don't — this closes that
 * gap with the same cadence convention lib/onboarding/nudge-job.ts already
 * uses for other "you paid/signed up, now finish this step" cases: a single
 * reminder a few days in, then an internal alert if it's still unfinished
 * a few days after that, since a live, unresolved payment is worth a human
 * looking at rather than sitting silently forever.
 *
 * prospective_booth_payments.status moves paid → linked the moment the
 * applicant actually submits /apply/partner (see submitApplication in
 * lib/actions/applications.ts), so "still status = paid" is exactly
 * "hasn't finished yet" — no separate tracking column needed. Idempotency
 * for both the reminder and the alert is handled by their own systems
 * (triggerAutomation's trigger_event_key, ops_alerts' rule_key), so this
 * job can run every day without re-sending anything already sent.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { triggerProspectiveBoothApplicationReminder } from "@/lib/comms/conference-triggers";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";

const REMINDER_AFTER_DAYS = 3;
const ALERT_AFTER_DAYS = 7;

export type ProspectiveBoothFollowupResult = {
  reminded: number;
  alerted: number;
};

export async function runProspectiveBoothFollowup(): Promise<ProspectiveBoothFollowupResult> {
  const db = createAdminClient();
  const result: ProspectiveBoothFollowupResult = { reminded: 0, alerted: 0 };

  const { data: stalePayments, error } = await db
    .from("prospective_booth_payments")
    .select("id, company_name, email, paid_at, booth:conference_entities!prospective_booth_payments_booth_entity_id_fkey(name)")
    .eq("status", "paid")
    .not("paid_at", "is", null);

  if (error) {
    console.error("[prospective-booth-followup] fetch failed:", error.message);
    return result;
  }

  const now = Date.now();

  for (const payment of stalePayments ?? []) {
    if (!payment.paid_at) continue;
    const daysSincePaid = (now - new Date(payment.paid_at).getTime()) / (1000 * 60 * 60 * 24);
    const boothName = (Array.isArray(payment.booth) ? payment.booth[0] : payment.booth)?.name ?? "";

    if (daysSincePaid >= REMINDER_AFTER_DAYS) {
      await triggerProspectiveBoothApplicationReminder({ db, paymentId: payment.id });
      result.reminded++;
    }

    if (daysSincePaid >= ALERT_AFTER_DAYS) {
      await raiseAlertIfNotOpen({
        ruleKey: `prospective_booth_unfinished:${payment.id}`,
        severity: "warning",
        message: `${payment.company_name} paid for booth ${boothName} ${Math.floor(daysSincePaid)} days ago and still hasn't finished their partnership application.`,
        details: {
          paymentId: payment.id,
          companyName: payment.company_name,
          email: payment.email,
          boothName,
          daysSincePaid: Math.floor(daysSincePaid),
        },
      });
      result.alerted++;
    }
  }

  return result;
}
