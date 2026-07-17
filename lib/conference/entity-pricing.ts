import type { BuildEntity } from "../actions/conference-entities";
import { effectiveRefs } from "./entity-graph";

/**
 * Pure sellability rules — who may buy an Offer, at what price, and whether any
 * are left. No I/O, so the cockpit, the purchase action, and tests share one
 * source of truth. Eligibility rides on the reference graph (`who` audiences);
 * tier prices override a base; inventory caps the count. Fork-agnostic: a
 * compile step (A) or a repointed checkout (B) can both read these.
 */

export type Eligibility = { ok: boolean; reason?: string };
export type Availability = { cap: number | null; sold: number; remaining: number | null; soldOut: boolean };

/**
 * The permission tiers an Offer is restricted to — the source_role of each
 * `who` audience it points at. Empty set = open to anyone.
 */
export function eligibleTiers(offer: BuildEntity, byId: Map<string, BuildEntity>): string[] {
  const tiers = new Set<string>();
  for (const r of effectiveRefs(offer, byId)) {
    if (r.role !== "who") continue;
    const tier = byId.get(r.toEntityId)?.attributes.source_role;
    if (typeof tier === "string") tiers.add(tier);
  }
  return [...tiers];
}

/** Can a buyer of the given permission tier purchase this Offer? */
export function canBuy(offer: BuildEntity, buyerTier: string, byId: Map<string, BuildEntity>): Eligibility {
  if (!offer.isForSale) return { ok: false, reason: "Not for sale." };
  const tiers = eligibleTiers(offer, byId);
  if (tiers.length === 0) return { ok: true }; // open to all
  if (tiers.includes(buyerTier)) return { ok: true };
  return { ok: false, reason: `Only ${tiers.join(", ")} can buy this.` };
}

/** Price for a buyer's tier: the tier override if set, else the base price. */
export function priceForTier(offer: BuildEntity, buyerTier: string): number {
  const override = offer.tierPrices?.[buyerTier];
  return typeof override === "number" ? override : offer.priceCents ?? 0;
}

/** Distinct prices this Offer can charge, by tier — for display. */
export function priceTable(offer: BuildEntity, byId: Map<string, BuildEntity>): Array<{ tier: string; cents: number }> {
  const tiers = eligibleTiers(offer, byId);
  if (tiers.length === 0) return [{ tier: "everyone", cents: offer.priceCents ?? 0 }];
  return tiers.map((tier) => ({ tier, cents: priceForTier(offer, tier) }));
}

/** How many remain, given how many are already sold. */
export function availability(offer: BuildEntity, sold: number): Availability {
  const cap = offer.inventory ?? null;
  if (cap == null) return { cap: null, sold, remaining: null, soldOut: false };
  const remaining = Math.max(0, cap - sold);
  return { cap, sold, remaining, soldOut: remaining <= 0 };
}
