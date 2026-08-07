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
