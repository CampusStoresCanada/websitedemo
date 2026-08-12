// ─────────────────────────────────────────────────────────────────
// Communications — Conference Trigger Helpers
// Shared between both registration-mint paths (member-org orders and
// non-member prospective Day Pass checkout) so the confirmation email
// stays consistent regardless of which one minted the attendee.
// ─────────────────────────────────────────────────────────────────

import { triggerAutomation } from "./automation";
import { formatConferenceDates } from "./format";
import { formatCents } from "@/lib/utils";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Fire the registration confirmation email for a newly minted conference
 * attendee. Idempotent per personId — safe to call once right after the
 * conference_people row is created.
 */
export async function triggerConferenceRegistrationConfirmation(params: {
  db: AdminClient;
  conferenceId: string;
  personId: string;
  attendeeName: string;
  attendeeEmail: string;
  orgName: string;
  registrationRole: string;
}): Promise<void> {
  const { db, conferenceId, personId, attendeeName, attendeeEmail, orgName, registrationRole } = params;

  const { data: conference, error } = await db
    .from("conference_instances")
    .select("year, start_date, end_date, location_city, location_province, location_venue")
    .eq("id", conferenceId)
    .single();

  if (error || !conference) {
    console.error(`triggerConferenceRegistrationConfirmation: conference ${conferenceId} not found: ${error?.message}`);
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const conferenceLocation = [conference.location_venue, conference.location_city, conference.location_province]
    .filter(Boolean)
    .join(", ");

  await triggerAutomation({
    triggerSource: "conference",
    triggerEventKey: `conference_registration_confirmation:${personId}`,
    templateKey: "conference_registration_confirmation",
    automationMode: "auto_send",
    campaignName: `Registration Confirmation: ${attendeeName}`,
    // conference_instance_id is carried here purely so the conference-scoped
    // admin comms view can filter to this conference — custom_emails audience
    // resolution itself ignores it.
    audience: { type: "custom_emails", filters: { emails: [attendeeEmail], conference_instance_id: conferenceId } },
    variableValues: {
      contact_name: attendeeName,
      org_name: orgName,
      conference_year: String(conference.year),
      registration_role: registrationRole,
      conference_dates: formatConferenceDates(conference.start_date, conference.end_date),
      conference_location: conferenceLocation,
      my_conference_url: `${appUrl}/me/conference/${conferenceId}`,
    },
  });
}

/**
 * Fire the order-level payment confirmation for a paid conference order
 * (registrations, booths, sponsorships — whatever the order contained).
 * Separate from per-attendee registration confirmations: this is the
 * buyer's receipt, sent once per order. Idempotent per orderId.
 */
export async function triggerConferencePaymentConfirmation(params: {
  db: AdminClient;
  conferenceId: string;
  orderId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const { db, conferenceId, orderId, organizationId, userId } = params;

  const [{ data: conference }, { data: org }, { data: order }, { data: userRecord }, { data: profile }] =
    await Promise.all([
      db.from("conference_instances").select("year").eq("id", conferenceId).maybeSingle(),
      db.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
      db.from("conference_orders").select("total_cents").eq("id", orderId).maybeSingle(),
      db.auth.admin.getUserById(userId),
      db.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    ]);

  const buyerEmail = userRecord?.user?.email;
  if (!conference || !org || !order || !buyerEmail) {
    console.error(`triggerConferencePaymentConfirmation: missing data for order ${orderId}`);
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const contactName = profile?.display_name ?? buyerEmail;

  await triggerAutomation({
    triggerSource: "conference",
    triggerEventKey: `conference_payment_confirmation:${orderId}`,
    templateKey: "conference_payment_confirmation",
    automationMode: "auto_send",
    campaignName: `Payment Confirmation: ${org.name}`,
    audience: { type: "custom_emails", filters: { emails: [buyerEmail], conference_instance_id: conferenceId } },
    variableValues: {
      contact_name: contactName,
      org_name: org.name,
      conference_year: String(conference.year),
      amount_paid: formatCents(order.total_cents ?? 0),
      order_ref: orderId.slice(0, 8).toUpperCase(),
      my_conference_url: `${appUrl}/me/conference/${conferenceId}`,
    },
  });
}

function prospectApplyUrl(payment: { id: string; company_name: string; email: string }): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${appUrl}/apply/partner?paymentId=${payment.id}&companyName=${encodeURIComponent(payment.company_name)}&email=${encodeURIComponent(payment.email)}`;
}

/**
 * "Pay first, apply second" confirmation — fires right after a prospect's
 * checkout.session.completed for a booth they bought with no org/account
 * yet (see lib/actions/prospective-booth-checkout.ts). No org-scoped
 * conference_orders row exists for this path, so this is keyed off the
 * prospective_booth_payments row directly, not an order id.
 */
export async function triggerProspectiveBoothPaymentConfirmation(params: {
  db: AdminClient;
  paymentId: string;
}): Promise<void> {
  const { db, paymentId } = params;

  const { data: payment } = await db
    .from("prospective_booth_payments")
    .select("id, email, company_name, amount_cents, booth:conference_entities!prospective_booth_payments_booth_entity_id_fkey(name)")
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) {
    console.error(`triggerProspectiveBoothPaymentConfirmation: payment ${paymentId} not found`);
    return;
  }

  const boothName = (Array.isArray(payment.booth) ? payment.booth[0] : payment.booth)?.name ?? "";

  await triggerAutomation({
    triggerSource: "conference",
    triggerEventKey: `prospective_booth_payment_confirmation:${paymentId}`,
    templateKey: "prospective_booth_payment_confirmation",
    automationMode: "auto_send",
    campaignName: `Prospective Booth Payment Confirmation: ${payment.company_name}`,
    audience: { type: "custom_emails", filters: { emails: [payment.email] } },
    variableValues: {
      company_name: payment.company_name,
      booth_name: boothName,
      amount_paid: formatCents(payment.amount_cents ?? 0),
      apply_url: prospectApplyUrl(payment),
    },
  });
}

/**
 * One-time nudge (see lib/onboarding/nudge-job.ts for the cadence
 * convention this mirrors) for a prospect who paid but hasn't submitted
 * their partnership application a few days later. Fired by
 * /api/cron/prospective-booth-followup, keyed by payment id so it can
 * never double-send for the same payment.
 */
export async function triggerProspectiveBoothApplicationReminder(params: {
  db: AdminClient;
  paymentId: string;
}): Promise<void> {
  const { db, paymentId } = params;

  const { data: payment } = await db
    .from("prospective_booth_payments")
    .select("id, email, company_name, booth:conference_entities!prospective_booth_payments_booth_entity_id_fkey(name)")
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) {
    console.error(`triggerProspectiveBoothApplicationReminder: payment ${paymentId} not found`);
    return;
  }

  const boothName = (Array.isArray(payment.booth) ? payment.booth[0] : payment.booth)?.name ?? "";

  await triggerAutomation({
    triggerSource: "conference",
    triggerEventKey: `prospective_booth_application_reminder:${paymentId}`,
    templateKey: "prospective_booth_application_reminder",
    automationMode: "auto_send",
    campaignName: `Prospective Booth Application Reminder: ${payment.company_name}`,
    audience: { type: "custom_emails", filters: { emails: [payment.email] } },
    variableValues: {
      company_name: payment.company_name,
      booth_name: boothName,
      apply_url: prospectApplyUrl(payment),
    },
  });
}
