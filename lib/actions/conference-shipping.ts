"use server";

/**
 * The conference shipping desk's actions. Desk staff only, as the check-in
 * desk is. See lib/conference/shipping.ts for the rules; Purolator is called
 * only through lib/purolator/.
 */

import { requireConferenceDeskAccess, requireConferenceOpsAccess } from "@/lib/auth/guards";
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
  loadShippingOrigin,
  personForBadge,
  toPurolatorAddress,
  voidRecordedShipment,
  type DeskShipment,
  type ShippingLabelQueue,
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
  destination: ShippingDestination;
  boxes: PurolatorBox[];
}): Promise<Result<PurolatorQuote[]>> {
  const auth = await requireConferenceDeskAccess(params.conferenceId);
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
  const auth = await requireConferenceDeskAccess(params.conferenceId);
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
      bookedBy: auth.ctx.userId,
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
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { conferenceId: params.conferenceId, reference: booked.reference, payer: params.payer },
    });
    return { success: true, data: booked };
  } catch (e) {
    return { success: false, error: purolatorMessage(e) };
  }
}

export async function voidConferenceShipment(params: {
  conferenceId: string;
  shipmentId: string;
}): Promise<Result<null>> {
  const auth = await requireConferenceDeskAccess(params.conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    await voidRecordedShipment({ ...params, voidedBy: auth.ctx.userId });
    await logAuditEventSafe({
      action: "conference_shipment_voided",
      entityType: "conference_shipment",
      entityId: params.shipmentId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { conferenceId: params.conferenceId },
    });
    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: purolatorMessage(e) };
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
