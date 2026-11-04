// Purolator pickups: one for the whole conference (Steve, 2026-11-04).
//
//   schedulePickup  book it, with everything added up
//   modifyPickup    change the totals or window; ⛔ returns a NEW confirmation
//                   number (seen in the sandbox 2026-11-04), so keep the latest
//   voidPickup      cancel it
//
// Shapes from docs/purolator/openapi/pickup.json, proven in the sandbox.

import "server-only";
import { getPurolatorConfig, purolatorRequest } from "./client";
import type { PurolatorAddress } from "./types";

export type PickupLocation = "LoadingDock" | "FrontDesk" | "Shipping" | "Receiving" | "Lobby" | "Reception";

export interface PickupRequest {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24h, the venue's local time */
  anyTimeAfter: string;
  untilTime: string;
  location: PickupLocation;
  instructions?: string;
  address: PurolatorAddress;
  contact: { name: string; company?: string; phone: string };
  /** Boxes and pounds, split by how they travel. */
  ground: { pieces: number; weightLb: number };
  air: { pieces: number; weightLb: number };
}

function pickupBody(p: PickupRequest) {
  const { billingAccount } = getPurolatorConfig();
  const totalWeight = Math.ceil(p.ground.weightLb + p.air.weightLb);
  // ⛔ ONE summary line per destination: Purolator refuses a Ground line and an
  // Air line together ("9001-21", sandbox 2026-11-04). Mixed is "Air/Ground".
  const summary = [
    {
      destinationCode: "DOM",
      totalPieces: p.ground.pieces + p.air.pieces,
      totalWeight,
      modeOfTransport: p.air.pieces && p.ground.pieces ? "Air/Ground" : p.air.pieces ? "Air" : "Ground",
    },
  ];
  return {
    lineOfBusiness: "Courier",
    registeredAccountNumber: billingAccount,
    pickupInstructions: {
      date: p.date,
      anyTimeAfter: p.anyTimeAfter,
      untilTime: p.untilTime,
      measurementUnit: "Imperial",
      totalWeight,
      pickupLocation: p.location,
      ...(p.instructions ? { additionalInstructions: p.instructions.slice(0, 100) } : {}),
    },
    pickupAddress: {
      address: p.address.streetAddress,
      province: p.address.provinceStateCode,
      city: p.address.city,
      country: "CA",
      postalCode: p.address.postalZipCode.replace(/\s+/g, "").toUpperCase(),
    },
    shipmentSummary: summary,
    contactInfo: {
      name: p.contact.name,
      ...(p.contact.company ? { company: p.contact.company } : {}),
      phoneNumber: p.contact.phone.replace(/\D/g, ""),
    },
  };
}

type ConfirmationResponse = { pickupConfirmationNumber?: string | number };

function confirmation(res: ConfirmationResponse, what: string): string {
  if (res.pickupConfirmationNumber == null) throw new Error(`Purolator ${what} the pickup but returned no confirmation number.`);
  return String(res.pickupConfirmationNumber);
}

export async function schedulePickup(p: PickupRequest): Promise<string> {
  if (p.ground.pieces + p.air.pieces === 0) throw new Error("There are no boxes to pick up.");
  const res = await purolatorRequest<ConfirmationResponse>("POST", "/pickup/v1/schedule", pickupBody(p));
  return confirmation(res, "booked");
}

/** Returns the NEW confirmation number: Purolator issues one on every change. */
export async function modifyPickup(confirmationNumber: string, p: PickupRequest): Promise<string> {
  const res = await purolatorRequest<ConfirmationResponse>("PUT", "/pickup/v1/modify", {
    ...pickupBody(p),
    pickupConfirmationNumber: confirmationNumber,
  });
  return confirmation(res, "changed");
}

export async function voidPickup(confirmationNumber: string): Promise<void> {
  const res = await purolatorRequest<{ pickupVoided?: boolean | string }>("PUT", "/pickup/v1/void", {
    lineOfBusiness: "Courier",
    pickupConfirmationNumber: confirmationNumber,
  });
  if (String(res.pickupVoided) !== "true") throw new Error(`Purolator did not cancel pickup ${confirmationNumber}.`);
}
