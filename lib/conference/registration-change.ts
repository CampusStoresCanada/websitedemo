import type { BuildEntity } from "../actions/conference-entities";
import { availability, canBuy, isFundedOffer, priceForTier } from "./entity-pricing";

/**
 * Which registrations a held one may be changed to (change_registration_offer).
 *
 * York University bought a Tuesday Day Pass for somebody coming on Wednesday
 * (2026-11-09); both are $199, and the only fix was a refund and a second
 * checkout. Staff can now change it in place.
 *
 * ⛔ Only at the price that was paid. No money moves in a change, so anything
 * dearer would be a free upgrade and anything cheaper a refund nobody issued.
 * A different-price change is a refund and a new purchase, which already exist.
 *
 * ⛔ Only what the org could have bought itself: the storefront's own gate
 * (canBuy), so a member pass never becomes a non-member one by the back door.
 * The CANCOLL-funded registration is never a target; it has its own switch,
 * with its own rules (conference-funded-conversion.ts).
 */
export type RegistrationChangeTarget = { id: string; name: string; priceCents: number };

export function registrationChangeTargets(params: {
  fromEntityId: string;
  /** What the org paid for one of the held registration. */
  paidUnitCents: number;
  buyerTier: string;
  byId: Map<string, BuildEntity>;
  /** Seats held of each registration, so a capped one that is sold out is not offered. */
  soldByEntity?: Map<string, number>;
}): RegistrationChangeTarget[] {
  const from = params.byId.get(params.fromEntityId);
  if (!from || from.kind !== "registration") return [];
  // A funded seat is moved by its own board, never here.
  if (isFundedOffer(from.attributes as Record<string, unknown> | null)) return [];

  const targets: RegistrationChangeTarget[] = [];
  for (const entity of params.byId.values()) {
    if (entity.kind !== "registration" || entity.id === from.id) continue;
    if (isFundedOffer(entity.attributes as Record<string, unknown> | null)) continue;
    if (!canBuy(entity, params.buyerTier, params.byId).ok) continue;
    if (availability(entity, params.soldByEntity?.get(entity.id) ?? 0).soldOut) continue;
    const price = priceForTier(entity, params.buyerTier);
    if (price !== params.paidUnitCents) continue;
    targets.push({ id: entity.id, name: entity.name, priceCents: price });
  }
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

/** What the database function's refusals mean to the person who clicked. */
export function registrationChangeErrorMessage(raw: string): string {
  if (raw.includes("SEAT_IS_ON_A_SCHEDULE")) {
    return "This person is already on the meeting schedule. Take them off it before changing their registration.";
  }
  if (raw.includes("SEAT_WAS_SWITCHED_TO_CANCOLL")) {
    return "This registration was switched to the CANCOLL-funded one. Change it from the CANCOLL panel instead.";
  }
  if (raw.includes("INCLUDED_SEAT_HELD_BY_SOMEONE_ELSE")) {
    return "Something this registration includes has been given to someone else. Unassign it first, then try again.";
  }
  if (raw.includes("ALREADY_THAT_REGISTRATION")) return "That is already their registration.";
  if (raw.includes("SEAT_NOT_FOUND")) return "That ticket could not be found. Refresh and try again.";
  return raw;
}
