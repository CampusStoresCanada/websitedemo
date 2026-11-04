"use server";

/**
 * Shipping boxes home: the desk's actions, and the attendee's own on /me.
 * Desk staff ship for anyone on the roster; anyone else only for themselves,
 * and only while the conference is on (authorizeShipping). See
 * lib/conference/shipping.ts for the rules; Purolator is called only through
 * lib/purolator/.
 */

import {
  isConferenceDeskStaff,
  requireAuthenticated,
  requireConferenceDeskAccess,
  requireConferenceOpsAccess,
} from "@/lib/auth/guards";
import { conferenceToday } from "@/lib/conference/desk-staff";
import { notifyShipmentBooked } from "@/lib/conference/shipping-notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { PurolatorError } from "@/lib/purolator/client";
import { estimateShipment } from "@/lib/purolator/shipping";
import type { PurolatorBox, PurolatorQuote } from "@/lib/purolator/types";
import {
  bookAndRecordShipment,
  boxesProblem,
  destinationProblem,
  loadDeskShipments,
  loadShipper,
  loadShippingLabelQueue,
  releaseShippingLabels,
  bookOrUpdatePickup,
  cancelPickup,
  loadPickupPlan,
  loadShippingOrigin,
  shipmentPersonId,
  shippingOpen,
  personForBadge,
  toPurolatorAddress,
  voidRecordedShipment,
  type DeskShipment,
  type ShippingLabelQueue,
  type PickupPlan,
  type Shipper,
  type ShippingDestination,
} from "@/lib/conference/shipping";

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Purolator's words, plus the reference their support asks for. */
function purolatorMessage(e: unknown): string {
  if (e instanceof PurolatorError) {
    return e.requestReference ? `Purolator: ${e.message} (ref ${e.requestReference})` : `Purolator: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * May the signed-in person ship for this person? Desk staff: anyone on the
 * roster. Anyone else: only themselves (their own conference_people row), and
 * only during the conference.
 */
async function authorizeShipping(
  conferenceId: string,
  personId: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (await isConferenceDeskStaff(auth.ctx, conferenceId)) return { ok: true, userId: auth.ctx.userId };

  const db = createAdminClient();
  const [{ data: own }, { data: conference }, today] = await Promise.all([
    db
      .from("conference_people")
      .select("id")
      .eq("id", personId)
      .eq("conference_id", conferenceId)
      .eq("user_id", auth.ctx.userId)
      .neq("assignment_status", "canceled")
      .maybeSingle(),
    db.from("conference_instances").select("start_date, end_date").eq("id", conferenceId).maybeSingle(),
    conferenceToday(conferenceId),
  ]);
  if (!own) return { ok: false, error: "You can only ship your own boxes." };
  if (!shippingOpen(today, conference?.start_date ?? null, conference?.end_date ?? null)) {
    return { ok: false, error: "Shipping opens on the first day of the conference." };
  }
  return { ok: true, userId: auth.ctx.userId };
}

/** A scanned badge, or a picked name → who is shipping. Never checks anyone in. */
export async function loadShippingPerson(params: {
  conferenceId: string;
  personId?: string;
  scanned?: string;
}): Promise<Result<Shipper>> {
  const auth = await requireConferenceDeskAccess(params.conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };
  const personId =
    params.personId ?? (params.scanned ? await personForBadge(params.conferenceId, params.scanned) : null);
  if (!personId) return { success: false, error: "That isn't one of this conference's badges. Find them by name." };
  const shipper = await loadShipper(params.conferenceId, personId);
  if (!shipper) return { success: false, error: "We can't find who that badge belongs to. Find them by name." };
  return { success: true, data: shipper };
}

/** Every Purolator service for these boxes to this address, cheapest first. */
export async function quoteConferenceShipment(params: {
  conferenceId: string;
  personId: string;
  destination: ShippingDestination;
  boxes: PurolatorBox[];
}): Promise<Result<PurolatorQuote[]>> {
  const auth = await authorizeShipping(params.conferenceId, params.personId);
  if (!auth.ok) return { success: false, error: auth.error };
  const problem = destinationProblem(params.destination) ?? boxesProblem(params.boxes);
  if (problem) return { success: false, error: problem };
  const origin = await loadShippingOrigin(params.conferenceId);
  if (!origin) return { success: false, error: "This conference has no ship-from address yet." };
  try {
    const quotes = await estimateShipment({
      sender: origin,
      receiver: toPurolatorAddress(params.destination),
      boxes: params.boxes,
    });
    if (quotes.length === 0) return { success: false, error: "Purolator offered no service to that address." };
    return { success: true, data: quotes };
  } catch (e) {
    return { success: false, error: purolatorMessage(e) };
  }
}

export async function bookConferenceShipment(params: {
  conferenceId: string;
  personId: string;
  destination: ShippingDestination;
  boxes: PurolatorBox[];
  serviceId: string;
  /** "institution" ships on the org's own Purolator account, read here, never from the client. */
  payer: "csc" | "institution";
  shownQuote: PurolatorQuote | null;
}): Promise<Result<{ shipmentId: string; reference: string; labelsQueued: boolean }>> {
  const auth = await authorizeShipping(params.conferenceId, params.personId);
  if (!auth.ok) return { success: false, error: auth.error };
  const problem = destinationProblem(params.destination) ?? boxesProblem(params.boxes);
  if (problem) return { success: false, error: problem };

  const [origin, shipper, conference] = await Promise.all([
    loadShippingOrigin(params.conferenceId),
    loadShipper(params.conferenceId, params.personId),
    createAdminClient().from("conference_instances").select("year").eq("id", params.conferenceId).maybeSingle(),
  ]);
  if (!origin) return { success: false, error: "This conference has no ship-from address yet." };
  if (!shipper) return { success: false, error: "That person is not on this conference's roster." };
  if (params.payer === "institution" && !shipper.institutionAccount) {
    return { success: false, error: `${shipper.organizationName ?? "Their institution"} has no Purolator account on file.` };
  }

  try {
    const booked = await bookAndRecordShipment({
      conferenceId: params.conferenceId,
      conferenceYear: (conference.data?.year as number | undefined) ?? new Date().getFullYear(),
      personId: shipper.personId,
      organizationId: shipper.organizationId,
      bookedBy: auth.userId,
      origin,
      destination: params.destination,
      boxes: params.boxes,
      serviceId: params.serviceId,
      payer:
        params.payer === "institution"
          ? { kind: "institution", accountNumber: shipper.institutionAccount! }
          : { kind: "csc" },
      shownQuote: params.shownQuote,
    });
    await logAuditEventSafe({
      action: "conference_shipment_booked",
      entityType: "conference_shipment",
      entityId: booked.shipmentId,
      actorId: auth.userId,
      actorType: "user",
      details: { conferenceId: params.conferenceId, reference: booked.reference, payer: params.payer },
    });
    // The shipper and their org admins: email and Circle. Never fails the booking.
    await notifyShipmentBooked(booked.shipmentId);
    return { success: true, data: booked };
  } catch (e) {
    return { success: false, error: purolatorMessage(e) };
  }
}

export async function voidConferenceShipment(params: {
  conferenceId: string;
  shipmentId: string;
}): Promise<Result<null>> {
  const personId = await shipmentPersonId(params.conferenceId, params.shipmentId);
  if (!personId) return { success: false, error: "That shipment was not found." };
  const auth = await authorizeShipping(params.conferenceId, personId);
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    await voidRecordedShipment({ ...params, voidedBy: auth.userId });
    await logAuditEventSafe({
      action: "conference_shipment_voided",
      entityType: "conference_shipment",
      entityId: params.shipmentId,
      actorId: auth.userId,
      actorType: "user",
      details: { conferenceId: params.conferenceId },
    });
    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: purolatorMessage(e) };
  }
}

/** The attendee's own shipments, for /me. */
export async function listMyShipments(params: { conferenceId: string; personId: string }): Promise<Result<DeskShipment[]>> {
  const auth = await authorizeShipping(params.conferenceId, params.personId);
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    return { success: true, data: await loadDeskShipments(params.conferenceId, { personId: params.personId }) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listConferenceShipments(conferenceId: string): Promise<Result<DeskShipment[]>> {
  const auth = await requireConferenceDeskAccess(conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    return { success: true, data: await loadDeskShipments(conferenceId) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** War Room → Print: how many shipping labels are waiting for the roll swap. */
export async function getShippingLabelQueue(conferenceId: string): Promise<Result<ShippingLabelQueue>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    return { success: true, data: await loadShippingLabelQueue(conferenceId) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** War Room → "Print the shipping labels": release every waiting label to the station. */
export async function printShippingLabels(conferenceId: string): Promise<Result<{ released: number }>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const released = await releaseShippingLabels(conferenceId);
    await logAuditEventSafe({
      action: "shipping_labels_released",
      entityType: "conference",
      entityId: conferenceId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { released },
    });
    return { success: true, data: { released } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** War Room → Print: the conference's one pickup, and what it should carry now. */
export async function getPickupPlan(conferenceId: string): Promise<Result<PickupPlan>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    return { success: true, data: await loadPickupPlan(conferenceId) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Book the pickup with every box added up, or update it to today's totals. */
export async function bookShippingPickup(conferenceId: string): Promise<Result<PickupPlan["booked"]>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const booked = await bookOrUpdatePickup(conferenceId, auth.ctx.userId);
    await logAuditEventSafe({
      action: "shipping_pickup_booked",
      entityType: "conference",
      entityId: conferenceId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { confirmationNumber: booked?.confirmationNumber, pieces: booked?.totalPieces },
    });
    return { success: true, data: booked };
  } catch (e) {
    return { success: false, error: purolatorMessage(e) };
  }
}

export async function cancelShippingPickup(conferenceId: string): Promise<Result<null>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    await cancelPickup(conferenceId, auth.ctx.userId);
    await logAuditEventSafe({
      action: "shipping_pickup_cancelled",
      entityType: "conference",
      entityId: conferenceId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {},
    });
    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: purolatorMessage(e) };
  }
}
