import "server-only";

/**
 * Telling people a shipment was booked: the person shipping AND every org
 * admin of their institution, in case the person who booked is not the one
 * who handles the invoice (Steve, design 2026-11-03). Each gets the
 * confirmation email and the same message in Circle.
 *
 * ⛔ The ESTIMATE only, labelled as one. The actual charge arrives later on
 * CSC's invoice, or from Purolator on the institution's own account.
 *
 * Never throws: a booking that happened stays booked whether or not anyone
 * could be told.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrgAdminEmails } from "@/lib/supabase/user-lookup";
import { sendTransactional } from "@/lib/comms/send";
import { butlerDm, dmPara, dmText, dmLink } from "@/lib/ghosts/butler-dm";
import { formatCents } from "@/lib/utils";
import { serviceName } from "@/lib/purolator/services";

type Recipient = { email: string; name: string; url: string };

/** The shipper first, then each admin; one message per address however many hats it wears. */
export function shipmentRecipients(params: {
  shipperEmail: string | null;
  shipperName: string;
  adminEmails: string[];
  orgName: string | null;
  meUrl: string;
  orgUrl: string | null;
}): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  const add = (email: string | null, name: string, url: string) => {
    const key = email?.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ email: email!.trim(), name, url });
  };
  add(params.shipperEmail, params.shipperName.split(" ")[0] || params.shipperName, params.meUrl);
  for (const admin of params.adminEmails) {
    add(admin, params.orgName ? `${params.orgName} team` : "there", params.orgUrl ?? params.meUrl);
  }
  return out;
}

export async function notifyShipmentBooked(shipmentId: string): Promise<void> {
  try {
    const db = createAdminClient();
    const { data: s } = await db
      .from("conference_shipments")
      .select(
        "reference, billing_mode, service_id, receiver_city, receiver_province, quote, organization_id, conference_person_id, conference_shipment_packages(piece_number, package_pin)"
      )
      .eq("id", shipmentId)
      .maybeSingle();
    if (!s) return;

    const [{ data: person }, { data: org }] = await Promise.all([
      s.conference_person_id
        ? db.from("conference_people").select("display_name, contact_email").eq("id", s.conference_person_id).maybeSingle()
        : Promise.resolve({ data: null }),
      s.organization_id
        ? db.from("organizations").select("name, slug").eq("id", s.organization_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const adminEmails = s.organization_id ? await resolveOrgAdminEmails(db, s.organization_id) : [];

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";
    const shipperName = (person?.display_name as string | null) ?? "Someone from your institution";
    const orgName = (org?.name as string | null) ?? null;
    const recipients = shipmentRecipients({
      shipperEmail: (person?.contact_email as string | null) ?? null,
      shipperName,
      adminEmails,
      orgName,
      meUrl: `${appUrl}/me#conference_checklist`,
      orgUrl: org?.slug ? `${appUrl}/org/${org.slug}#conference_checklist` : null,
    });

    const pins = [...((s.conference_shipment_packages ?? []) as Array<{ piece_number: number; package_pin: string }>)]
      .sort((a, b) => a.piece_number - b.piece_number)
      .map((p) => p.package_pin);
    const estimateCents = (s.quote as { totalCents?: number } | null)?.totalCents;
    const facts = {
      shipper_name: shipperName,
      destination: `${s.receiver_city}, ${s.receiver_province}`,
      reference: s.reference as string,
      service: serviceName(s.service_id as string),
      box_count: String(pins.length),
      tracking: pins.join(", "),
      estimate: estimateCents != null ? formatCents(estimateCents) : "not available",
      billing_line:
        s.billing_mode === "institution_account"
          ? `It is on ${orgName ?? "your institution"}'s own Purolator account, so Purolator bills you directly.`
          : `Campus Stores Canada pays Purolator, then invoices ${orgName ?? "your institution"} what Purolator actually charges, after the conference.`,
    };

    for (const r of recipients) {
      const sent = await sendTransactional({
        templateKey: "conference_shipment_booked",
        to: r.email,
        variables: { ...facts, contact_name: r.name, shipments_url: r.url },
      });
      if (!sent.success) console.error(`[shipping] confirmation to ${r.email} for ${facts.reference} failed: ${sent.error}`);
      await circleMessage(r, facts);
    }
  } catch (err) {
    console.error(`[shipping] notifying for shipment ${shipmentId} failed:`, err);
  }
}

/**
 * The same message in Circle, from the ghost DMs come from (butlerDm). ⛔ A
 * local server shares the live database and Circle, so DEV_EMAIL_INTERCEPT
 * redirects these as it does email (as lib/circle/flag-notify.ts does).
 */
async function circleMessage(r: Recipient, f: Record<string, string>): Promise<void> {
  const intercept = process.env.DEV_EMAIL_INTERCEPT;
  const to = intercept || r.email;
  const content = [
    ...(intercept ? [dmPara(dmText(`[DEV: would have gone to ${r.email}]`))] : []),
    dmPara(dmText("Your Purolator shipment from the conference is booked.", true)),
    dmPara(dmText(`${f.shipper_name} is shipping ${f.box_count === "1" ? "1 box" : `${f.box_count} boxes`} to ${f.destination} by ${f.service}.`)),
    dmPara(dmText(`Reference ${f.reference}. Tracking ${f.tracking}.`)),
    dmPara(dmText(`Purolator's estimate: ${f.estimate}, tax included. ${f.billing_line}`)),
    dmPara(dmLink("See the shipment", r.url)),
  ];
  const fallback = `Your Purolator shipment from the conference is booked: ${f.reference}, ${f.box_count} box(es) to ${f.destination}. ${r.url}`;
  await butlerDm(to, content, fallback);
}
