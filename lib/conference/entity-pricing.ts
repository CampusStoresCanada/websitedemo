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

/**
 * Every tier a buyer effectively satisfies.
 *
 * ⛔ Staff satisfy `member`. CSC's own staff function as members inside this
 * organisation, so giving them their own tier must not quietly take capability
 * away: without this, naming Staff would lock them out of the six member-gated
 * offers — both $99 socials, all three day passes and Full Conference
 * Registration — which is a reduction nobody asked for and which fails silently
 * at the point of purchase.
 *
 * The alternative was adding a Staff audience to the `who` of every member
 * offer. That is six catalogue edits today and one forgotten edit every time
 * somebody adds a member offer later. This is the rule stated once.
 */
export function effectiveBuyerTiers(buyerTier: string): string[] {
  return buyerTier === "staff" ? ["staff", "member"] : [buyerTier];
}

/** Can a buyer of the given permission tier purchase this Offer? */
export function canBuy(offer: BuildEntity, buyerTier: string, byId: Map<string, BuildEntity>): Eligibility {
  if (!offer.isForSale) return { ok: false, reason: "Not for sale." };
  const tiers = eligibleTiers(offer, byId);
  if (tiers.length === 0) return { ok: true }; // open to all
  if (effectiveBuyerTiers(buyerTier).some((tier) => tiers.includes(tier))) return { ok: true };
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

// ─────────────────────────────────────────────────────────────────
// Direct-purchase offers
// ─────────────────────────────────────────────────────────────────

/** The buyer facts a direct-purchase gate needs. */
export type DirectPurchaseBuyer = {
  id: string;
  type: string | null;
  primary_category: string | null;
};

/**
 * Some offers are deliberately kept off the general storefront and sold only to
 * named buyers — the $500 Book Partner registration, the Big Ideas Day rates.
 *
 * ⛔ ONE implementation, used by both `addOfferToCart` (which refuses) and
 * `listConferenceOffers` (which decides whether to show it). Two copies of
 * "may this org buy this" is how an offer becomes visible to someone who is
 * then refused at the till, or invisible to someone entitled to it.
 *
 * Two independent gates, AND-ed, both optional:
 *
 *   `direct_purchase_category` matches `organizations.primary_category` by
 *   EXACT equality. That is deliberate and must stay: the Book Partner
 *   registration was specified as "primary category is books" and is meant to
 *   be narrow and invisible. Loosening it to a substring would open a hidden
 *   offer to every org with "Books" somewhere in a comma-jammed list.
 *
 *   `direct_purchase_org_ids` names the buyers outright. For Big Ideas Day,
 *   operations and publisher partners pay different rates and NOTHING in the
 *   data separates them — both resolve to the `partner` tier, and
 *   primary_category is free text that matches 2 of the 7 orgs named. The list
 *   is a human decision recorded where the offer lives, not a taxonomy invented
 *   so seven companies can self-select.
 */
export function directPurchaseAllowed(
  attributes: Record<string, unknown> | null | undefined,
  buyer: DirectPurchaseBuyer | null | undefined
): boolean {
  if (!buyer) return false;
  // Every direct-purchase offer is a partner product. Nothing currently sells
  // this way to members, and a member reaching one would be a mistake.
  if (buyer.type !== "Vendor Partner") return false;

  const attrs = attributes ?? {};

  const requiredCategory = attrs.direct_purchase_category;
  const categoryOk =
    requiredCategory == null ||
    (typeof requiredCategory === "string" && buyer.primary_category === requiredCategory) ||
    (Array.isArray(requiredCategory) && requiredCategory.includes(buyer.primary_category));

  const allowedOrgIds = attrs.direct_purchase_org_ids;
  const orgOk =
    allowedOrgIds == null ||
    (Array.isArray(allowedOrgIds) && allowedOrgIds.includes(buyer.id));

  return categoryOk && orgOk;
}

/**
 * Is this offer sold only to named buyers rather than from the storefront?
 *
 * ⚠️ Reads a boolean, and the stored value has been the STRING "true" at least
 * once (Big Ideas Presentations, 2026-10). A string is not accepted here on
 * purpose: accepting it would hide the data error rather than fix it, and the
 * gate failing closed is the safe direction.
 */
export function isDirectPurchaseOnly(attributes: Record<string, unknown> | null | undefined): boolean {
  return (attributes ?? {}).direct_purchase_only === true;
}
