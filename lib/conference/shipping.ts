import "server-only";

/**
 * The conference shipping desk, on the server.
 *
 * Design: docs/purolator/SHIPPING_STATION_DESIGN.md. Purolator itself is only
 * ever called through lib/purolator/; this file is who is shipping, to where,
 * on whose account, and what we recorded.
 *
 * ⛔ A shipment row exists only once Purolator has booked it. Last year's app
 * saved a made-up tracking number and price when Purolator failed, then
 * invoiced it. Here a failed booking shows the error and saves nothing.
 */

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import { findBadgeTokenRow } from "@/lib/conference/badges/tokens";
import { abbreviateProvince } from "@/lib/constants/provinces";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { getPurolatorConfig } from "@/lib/purolator/client";
import { bookShipment, voidShipment } from "@/lib/purolator/shipping";
import type { PurolatorAddress, PurolatorBox, PurolatorPayer, PurolatorQuote } from "@/lib/purolator/types";

export type ShippingDestination = {
  company: string;
  attention: string;
  street: string;
  street2: string;
  city: string;
  province: string;
  postalCode: string;
  phone: string;
};

/** Who is shipping, and the defaults the desk starts from. */
export type Shipper = {
  personId: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
  /** The institution's own Purolator account, if its org admin added one. */
  institutionAccount: string | null;
  destination: ShippingDestination;
};

export type ShippingRosterRow = {
  id: string;
  name: string;
  email: string | null;
  organizationName: string | null;
};

export type DeskShipment = {
  id: string;
  reference: string;
  createdAt: string;
  status: string;
  personName: string | null;
  organizationName: string | null;
  serviceId: string;
  billingMode: "csc_rebill" | "institution_account";
  environment: "sandbox" | "production";
  shipmentPin: string;
  packagePins: string[];
  destination: string;
  estimateCents: number | null;
};

const CANADIAN_POSTAL = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;
const PROVINCE_CODES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

/** What's wrong with an address, in desk words, or null. */
export function destinationProblem(d: ShippingDestination): string | null {
  if (!d.street.trim()) return "Add the street address.";
  // CSC's own address on file is one (2026-11-04); Purolator delivers to doors.
  if (/\b(p\.?\s*o\.?\s*box|post office box|c\.?p\.?\s+\d|case postale)\b/i.test(`${d.street} ${d.street2}`)) {
    return "Purolator can't deliver to a PO box. Use the street address.";
  }
  if (!d.city.trim()) return "Add the city.";
  if (!PROVINCE_CODES.includes(d.province.trim().toUpperCase())) return "Pick the province.";
  if (!CANADIAN_POSTAL.test(d.postalCode.replace(/\s+/g, "").toUpperCase())) {
    return "The postal code looks wrong (like T2N 1N4).";
  }
  if (d.phone.replace(/\D/g, "").length < 10) return "Add a phone number with area code, for the driver.";
  return null;
}

export function boxesProblem(boxes: PurolatorBox[]): string | null {
  if (boxes.length === 0) return "Add at least one box.";
  if (boxes.length > 20) return "Twenty boxes is the most one shipment can take.";
  for (const [i, b] of boxes.entries()) {
    const n = boxes.length > 1 ? ` (box ${i + 1})` : "";
    if (!(b.weightLb > 0)) return `Weigh the box${n}.`;
    if (b.weightLb > 150) return `Purolator takes up to 150 lb a box${n}.`;
    if (!(b.lengthIn > 0 && b.widthIn > 0 && b.heightIn > 0)) return `Add the box size${n}.`;
  }
  return null;
}

export function toPurolatorAddress(d: ShippingDestination): PurolatorAddress {
  return {
    companyName: d.company.trim() || undefined,
    attentionTo: d.attention.trim() || undefined,
    streetAddress: [d.street, d.street2].map((s) => s.trim()).filter(Boolean),
    city: d.city.trim(),
    provinceStateCode: d.province.trim().toUpperCase(),
    postalZipCode: d.postalCode,
    phoneNumber: d.phone,
  };
}

/** "CSC27-7KQ2M": short enough for Purolator's 30-character reference, readable on a label. */
export function makeShipmentReference(year: number, bytes: Buffer = randomBytes(5)): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
  const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `CSC${String(year).slice(-2)}-${code}`;
}

/**
 * Attendees ship from /me only while the conference is on: from its first day
 * through its last, in its own time zone. The desk is not limited by this.
 */
export function shippingOpen(today: string, startDate: string | null, endDate: string | null): boolean {
  if (!startDate || !endDate) return false;
  return today >= startDate && today <= endDate;
}

// ─────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────

/** Where this conference's boxes ship from. Null until it is set on the conference. */
export async function loadShippingOrigin(conferenceId: string): Promise<PurolatorAddress | null> {
  const { data } = await createAdminClient()
    .from("conference_instances")
    .select("shipping_origin")
    .eq("id", conferenceId)
    .maybeSingle();
  const origin = data?.shipping_origin as PurolatorAddress | null | undefined;
  return origin?.streetAddress?.length ? origin : null;
}

async function orgNames(ids: string[]): Promise<Map<string, string>> {
  const db = createAdminClient();
  const names = new Map<string, string>();
  const unique = [...new Set(ids)];
  // ⛔ Chunked: .in() past ~200 ids is a Bad Request, not rows.
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await db.from("organizations").select("id, name").in("id", unique.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const o of data ?? []) names.set(o.id as string, o.name as string);
  }
  return names;
}

/** Everyone on the conference roster, for the desk's Find. */
export async function loadShippingRoster(conferenceId: string): Promise<ShippingRosterRow[]> {
  const { data, error } = await createAdminClient()
    .from("conference_people")
    .select("id, display_name, contact_email, organization_id")
    .eq("conference_id", conferenceId);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const names = await orgNames(rows.map((r) => r.organization_id).filter((v): v is string => !!v));
  return rows
    .map((r) => ({
      id: r.id as string,
      name: (r.display_name as string | null) ?? (r.contact_email as string | null) ?? "Unnamed",
      email: (r.contact_email as string | null) ?? null,
      organizationName: r.organization_id ? names.get(r.organization_id as string) ?? null : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A scanned badge → the person, WITHOUT checking them in. Same token reader as
 * the check-in desk (findBadgeTokenRow); a revoked badge still identifies who
 * it belonged to, which is all shipping needs.
 */
export async function personForBadge(conferenceId: string, scanned: string): Promise<string | null> {
  const db = createAdminClient();
  const row = await findBadgeTokenRow(db, { token: scanned, conferenceId });
  if (row) return row.person_id;
  // v1 badges carry the person's id directly (see scanConferenceCheckInToken).
  const raw = scanned.trim();
  if (!/^[0-9a-f-]{36}$/i.test(raw)) return null;
  const { data } = await db
    .from("conference_people")
    .select("id")
    .eq("id", raw)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** The person, their institution, and its address on file as the starting destination. */
export async function loadShipper(conferenceId: string, personId: string): Promise<Shipper | null> {
  const db = createAdminClient();
  const { data: person } = await db
    .from("conference_people")
    .select("id, display_name, contact_email, organization_id")
    .eq("id", personId)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  if (!person) return null;

  const org = person.organization_id
    ? (
        await db
          .from("organizations")
          .select("id, name, street_address, city, province, postal_code, phone, purolator_account")
          .eq("id", person.organization_id)
          .maybeSingle()
      ).data
    : null;

  const name = (person.display_name as string | null) ?? (person.contact_email as string | null) ?? "Unnamed";
  const street = ((org?.street_address as string | null) ?? "").split("\n");
  return {
    personId: person.id as string,
    name,
    organizationId: (org?.id as string | undefined) ?? null,
    organizationName: (org?.name as string | undefined) ?? null,
    institutionAccount: ((org?.purolator_account as string | null) ?? "").replace(/\D/g, "") || null,
    destination: {
      company: (org?.name as string | undefined) ?? "",
      attention: name,
      street: street[0]?.trim() ?? "",
      street2: street.slice(1).join(" ").trim(),
      city: (org?.city as string | null) ?? "",
      province: abbreviateProvince(org?.province as string | null),
      postalCode: (org?.postal_code as string | null) ?? "",
      phone: (org?.phone as string | null) ?? "",
    },
  };
}

type ShipmentRow = {
  id: string;
  reference: string;
  created_at: string;
  status: string;
  conference_person_id: string | null;
  organization_id: string | null;
  service_id: string;
  billing_mode: "csc_rebill" | "institution_account";
  purolator_environment: "sandbox" | "production";
  shipment_pin: string;
  receiver_city: string;
  receiver_province: string;
  quote: { totalCents?: number } | null;
  conference_shipment_packages: Array<{ piece_number: number; package_pin: string }>;
};

/** Every shipment booked at this conference (or one person's, or one institution's), newest first. */
export async function loadDeskShipments(
  conferenceId: string,
  only: { personId?: string; organizationId?: string } = {}
): Promise<DeskShipment[]> {
  const db = createAdminClient();
  let query = db
    .from("conference_shipments")
    .select(
      "id, reference, created_at, status, conference_person_id, organization_id, service_id, billing_mode, purolator_environment, shipment_pin, receiver_city, receiver_province, quote, conference_shipment_packages(piece_number, package_pin)"
    )
    .eq("conference_id", conferenceId)
    .order("created_at", { ascending: false });
  if (only.personId) query = query.eq("conference_person_id", only.personId);
  if (only.organizationId) query = query.eq("organization_id", only.organizationId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ShipmentRow[];

  const personIds = rows.map((r) => r.conference_person_id).filter((v): v is string => !!v);
  const people = new Map<string, string>();
  for (let i = 0; i < personIds.length; i += 150) {
    const { data: ps } = await db
      .from("conference_people")
      .select("id, display_name, contact_email")
      .in("id", personIds.slice(i, i + 150));
    for (const p of ps ?? []) people.set(p.id as string, (p.display_name ?? p.contact_email ?? "Unnamed") as string);
  }
  const orgs = await orgNames(rows.map((r) => r.organization_id).filter((v): v is string => !!v));

  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    createdAt: r.created_at,
    status: r.status,
    personName: r.conference_person_id ? people.get(r.conference_person_id) ?? null : null,
    organizationName: r.organization_id ? orgs.get(r.organization_id) ?? null : null,
    serviceId: r.service_id,
    billingMode: r.billing_mode,
    environment: r.purolator_environment,
    shipmentPin: r.shipment_pin,
    packagePins: [...r.conference_shipment_packages]
      .sort((a, b) => a.piece_number - b.piece_number)
      .map((p) => p.package_pin),
    destination: `${r.receiver_city}, ${r.receiver_province}`,
    estimateCents: r.quote?.totalCents ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────

export type BookInput = {
  conferenceId: string;
  conferenceYear: number;
  personId: string;
  organizationId: string | null;
  bookedBy: string;
  origin: PurolatorAddress;
  destination: ShippingDestination;
  boxes: PurolatorBox[];
  serviceId: string;
  payer: PurolatorPayer;
  /** The estimate the desk showed, kept if Purolator's booking returns none. */
  shownQuote: PurolatorQuote | null;
};

/**
 * Book with Purolator, then record it. If recording fails after Purolator has
 * booked, void it there so nothing ships unrecorded; if that fails too, an ops
 * alert names the tracking number.
 */
export async function bookAndRecordShipment(
  input: BookInput
): Promise<{ shipmentId: string; reference: string; labelsQueued: boolean }> {
  const db = createAdminClient();
  const { billingAccount, environment } = getPurolatorConfig();
  const reference = makeShipmentReference(input.conferenceYear);

  const booking = await bookShipment(
    { sender: input.origin, receiver: toPurolatorAddress(input.destination), boxes: input.boxes, reference },
    input.serviceId,
    input.payer
  );

  const d = toPurolatorAddress(input.destination);
  const { data: shipment, error } = await db
    .from("conference_shipments")
    .insert({
      conference_id: input.conferenceId,
      conference_person_id: input.personId,
      organization_id: input.organizationId,
      booked_by: input.bookedBy,
      reference,
      billing_mode: input.payer.kind === "csc" ? "csc_rebill" : "institution_account",
      purolator_account: input.payer.kind === "csc" ? billingAccount : input.payer.accountNumber,
      purolator_environment: environment,
      service_id: input.serviceId,
      receiver_company: d.companyName ?? null,
      receiver_attention: d.attentionTo ?? null,
      receiver_street: d.streetAddress,
      receiver_city: d.city,
      receiver_province: d.provinceStateCode,
      receiver_postal_code: d.postalZipCode.replace(/\s+/g, "").toUpperCase(),
      receiver_phone: d.phoneNumber?.replace(/\D/g, "") ?? null,
      shipment_pin: booking.shipmentPin,
      // Nothing to re-bill on the institution's own account.
      status: input.payer.kind === "csc" ? "booked" : "no_charge",
      quote: (booking.quote ?? input.shownQuote) as unknown as Json,
      purolator_request_reference: booking.requestReference,
    })
    .select("id")
    .single();

  const packagesError = shipment
    ? (
        await db.from("conference_shipment_packages").insert(
          input.boxes.map((b, i) => ({
            shipment_id: shipment.id,
            piece_number: i + 1,
            weight_lb: b.weightLb,
            length_in: b.lengthIn,
            width_in: b.widthIn,
            height_in: b.heightIn,
            package_pin: booking.packagePins[i] ?? booking.shipmentPin,
          }))
        )
      ).error
    : null;

  if (error || !shipment || packagesError) {
    const why = error?.message ?? packagesError?.message ?? "no row returned";
    if (shipment) await db.from("conference_shipments").delete().eq("id", shipment.id);
    try {
      await voidShipment(booking.shipmentPin);
    } catch {
      await raiseAlertIfNotOpen({
        ruleKey: `shipping_unrecorded:${booking.shipmentPin}`,
        severity: "critical",
        message: `Purolator shipment ${booking.shipmentPin} (${reference}) was booked but could not be saved or voided. Void it in Purolator's portal.`,
        details: { shipmentPin: booking.shipmentPin, reference, conferenceId: input.conferenceId, error: why },
      });
    }
    throw new Error(`The shipment could not be saved, so it was cancelled with Purolator. (${why})`);
  }

  // The labels wait on the print queue for the roll swap (releaseShippingLabels).
  // A failure here costs the queued print, not the booking: the desk can still
  // open the labels.
  const { error: jobError } = await db.from("badge_print_jobs").insert({
    conference_id: input.conferenceId,
    person_id: input.personId,
    pipeline_type: "shipping_label",
    status: "queued",
    transport_method: "printer_bridge",
    initiated_by: input.bookedBy,
    metadata: {
      shipment_id: shipment.id,
      reference,
      boxes: input.boxes.length,
      label: `${reference} · ${input.destination.attention || input.destination.company} · ${input.boxes.length} box${input.boxes.length === 1 ? "" : "es"}`,
    },
  });
  if (jobError) console.error(`[shipping] labels for ${reference} not queued: ${jobError.message}`);

  return { shipmentId: shipment.id as string, reference, labelsQueued: !jobError };
}

/** Labels that will print once the shipping roll is in: waiting, or released and not printed yet. */
export type ShippingLabelQueue = { waiting: number; waitingBoxes: number; released: number };

export async function loadShippingLabelQueue(conferenceId: string): Promise<ShippingLabelQueue> {
  const { data, error } = await createAdminClient()
    .from("badge_print_jobs")
    .select("status, metadata")
    .eq("conference_id", conferenceId)
    .eq("pipeline_type", "shipping_label")
    .in("status", ["queued", "sent_to_printer", "rendering"]);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const waiting = rows.filter((r) => r.status === "queued");
  return {
    waiting: waiting.length,
    waitingBoxes: waiting.reduce((n, r) => n + ((r.metadata as { boxes?: number } | null)?.boxes ?? 1), 0),
    released: rows.length - waiting.length,
  };
}

/**
 * "Print the shipping labels": every waiting label goes to the print station.
 * Pressed once the QL has the die-cut 103 x 164 mm roll in; anything the
 * printer refuses comes back to waiting (finishJob).
 */
export async function releaseShippingLabels(conferenceId: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("badge_print_jobs")
    .update({ status: "sent_to_printer", updated_at: new Date().toISOString() })
    .eq("conference_id", conferenceId)
    .eq("pipeline_type", "shipping_label")
    .eq("status", "queued")
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

export async function voidRecordedShipment(params: {
  conferenceId: string;
  shipmentId: string;
  voidedBy: string;
}): Promise<void> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("conference_shipments")
    .select("id, status, shipment_pin")
    .eq("id", params.shipmentId)
    .eq("conference_id", params.conferenceId)
    .maybeSingle();
  if (!row) throw new Error("That shipment was not found.");
  if (row.status === "voided") return;
  if (row.status === "billed") throw new Error("That shipment has already been invoiced.");

  await voidShipment(row.shipment_pin as string);
  // Its labels must not print: a cancelled shipment's barcode ships nothing.
  await db
    .from("badge_print_jobs")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("conference_id", params.conferenceId)
    .eq("pipeline_type", "shipping_label")
    .in("status", ["queued", "sent_to_printer"])
    .contains("metadata", { shipment_id: row.id });
  const { error } = await db
    .from("conference_shipments")
    .update({ status: "voided", voided_at: new Date().toISOString(), voided_by: params.voidedBy, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(`Cancelled with Purolator, but not marked here: ${error.message}`);
}

/** Who a shipment is for, to let them cancel their own. */
export async function shipmentPersonId(conferenceId: string, shipmentId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("conference_shipments")
    .select("conference_person_id")
    .eq("id", shipmentId)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  return (data?.conference_person_id as string | null | undefined) ?? null;
}

export async function shipmentPinFor(conferenceId: string, shipmentId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("conference_shipments")
    .select("shipment_pin, status")
    .eq("id", shipmentId)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  if (!data || data.status === "voided") return null;
  return data.shipment_pin as string;
}
