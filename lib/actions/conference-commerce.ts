"use server";

import crypto from "node:crypto";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { stripe } from "@/lib/stripe/client";
import { resolveConferenceOrderTaxRates } from "@/lib/stripe/tax";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
import { logAuditEventSafe } from "@/lib/ops/audit";
// Relative imports: these pure modules are pulled in unmocked by vitest, where
// the "@/" alias isn't resolved (see project notes on the test setup).
import { availability, canBuy, priceForTier } from "../conference/entity-pricing";
import {
  MEMBERSHIP_RENEWAL_KIND,
  membershipCoversConference,
  offerRequiresMembershipRenewal,
} from "../conference/membership-gate";
import {
  offerRequiresOwnershipOfEntityIds,
  expandWithInstanceOfParents,
  ownershipRequirementSatisfied,
  OWNERSHIP_ROLE,
} from "../conference/ownership-gate";
// computeMembershipAssessment has no import-time side effects (createAdminClient
// is only a function reference), so a relative import is safe here.
import { computeMembershipAssessment } from "../membership/pricing";
import {
  computeNewExpiresAt,
  nextCycleStartOnOrAfter,
  cyclesNeededFrom,
  isWithinPreRenewalSkipWindow,
} from "../membership/renewal-activation";
// getRenewalConfig has no import-time side effects (createAdminClient is only
// a function reference), so a relative import is safe here.
import { getRenewalConfig } from "../policy/engine";
// getPartnershipRateCents/applyProration use the "@/" alias so they can be
// mocked wholesale in tests — lib/stripe/billing.ts transitively imports the
// real Stripe client via a relative path that an alias-keyed mock can't
// intercept, so loading the real file would throw on a missing
// STRIPE_SECRET_KEY in test environments.
import { getPartnershipRateCents, applyProration } from "@/lib/stripe/billing";
import { createSponsorAgreementFromBoothPurchase } from "../sponsorship/booth-agreement";
import { buildEntityGraph, ENTITY_SELECT } from "../conference/entity-rows";
import { indexById } from "../conference/entity-graph";
import { findOverlappingRegistration } from "../conference/registration-overlap";
import { mintRegistrationAttendeesFromOrder } from "../conference/registration-mint";
import { enqueueQBConferenceRefund } from "../quickbooks/conference-export";
import type { BuildEntity, EntityRefView } from "./conference-entities";
import { SALES_OPEN_STATUSES } from "@/lib/constants/conference";

// Board decision: orgs can hold multiple booths, but not the whole floor.
const MAX_BOOTHS_PER_CART = 4;

/**
 * Conference commerce — v3 Offers only.
 *
 * The catalog is the v3 entity graph: things flagged `is_for_sale` are Offers.
 * Orgs add Offers to the cart (who-can-buy gated by the Offer's `who` audiences,
 * priced at the buyer's tier) and check out through Stripe. The paid webhook
 * mints v3 grants via process_conference_order_paid → mint_v3_for_order.
 *
 * The old product/grant catalog, its rules engine, and wishlist deferred billing
 * were retired in the v3 cutover. See docs/CONFERENCE_V2_BLUEPRINT.md.
 */

type CartRow = Database["public"]["Tables"]["cart_items"]["Row"];
type OrderRow = Database["public"]["Tables"]["conference_orders"]["Row"];
type OrderItemRow = Database["public"]["Tables"]["conference_order_items"]["Row"];

type CommerceFailure = { success: false; error: string; code?: string };
type CommerceSuccess<T> = { success: true; data: T };

interface CheckoutInput {
  conferenceId: string;
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey?: string;
}

async function assertUserCanManageOrg(params: {
  organizationId: string;
}): Promise<
  | { ok: true; userId: string; userEmail: string | null }
  | { ok: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: auth.error };

  const canAccess =
    isGlobalAdmin(auth.ctx.globalRole) || auth.ctx.activeOrgIds.includes(params.organizationId);

  if (!canAccess) {
    return { ok: false, error: "You are not authorized to manage commerce for this organization." };
  }

  return { ok: true, userId: auth.ctx.userId, userEmail: auth.ctx.userEmail };
}

/** Map an organization's type to the permission tier the v3 Offer pricing uses. */
function orgTypeToTier(orgType: string | null): string {
  if (orgType === "Member") return "member";
  if (orgType === "Vendor Partner") return "partner";
  if (orgType === "Non-Member") return "non_member";
  return "public";
}

async function loadBuyerTier(organizationId: string): Promise<string> {
  const adminClient = createAdminClient();
  const { data: org } = await adminClient
    .from("organizations")
    .select("type")
    .eq("id", organizationId)
    .single();
  return orgTypeToTier(org?.type ?? null);
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * An offer's effective refs for one role, walking one level of `instance_of`
 * inheritance — a booth INSTANCE (e.g. "Booth 601") inherits the refs set on
 * its TYPE entity, matching how effectiveRefs() in
 * lib/conference/entity-graph.ts resolves inheritance for the admin Build
 * tab. That function needs the full workspace graph loaded; this is a narrow,
 * targeted version for the buyer-facing commerce path, which only ever loads
 * one entity at a time. Without this, marking a ref on a booth TYPE (the
 * natural place an admin would do it) would silently fail to gate any actual
 * booth instance a buyer purchases. Shared by the membership-renewal
 * `requires` gate and the `requires_ownership_of` gate — both need the same
 * instance_of-aware lookup, just for a different role.
 */
async function loadEffectiveRefsByRole(
  adminClient: AdminClient,
  offerEntityId: string,
  role: string
): Promise<Array<{ toEntityId: string; toKind: string }>> {
  const { data: ownRefs } = await adminClient
    .from("conference_entity_refs")
    .select("role, to_entity_id, target:conference_entities!conference_entity_refs_to_entity_id_fkey(kind)")
    .eq("from_entity_id", offerEntityId)
    .in("role", [role, "instance_of"]);

  const matched: Array<{ toEntityId: string; toKind: string }> = [];
  let typeId: string | null = null;
  for (const r of ownRefs ?? []) {
    if (r.role === "instance_of") {
      typeId = r.to_entity_id;
      continue;
    }
    const target = Array.isArray(r.target) ? r.target[0] : r.target;
    if (target) matched.push({ toEntityId: r.to_entity_id, toKind: target.kind });
  }

  if (typeId) {
    const { data: typeRefs } = await adminClient
      .from("conference_entity_refs")
      .select("to_entity_id, target:conference_entities!conference_entity_refs_to_entity_id_fkey(kind)")
      .eq("from_entity_id", typeId)
      .eq("role", role);
    for (const r of typeRefs ?? []) {
      const target = Array.isArray(r.target) ? r.target[0] : r.target;
      // Instance's own refs win over the type's, same precedence
      // effectiveRefs() uses for every other role.
      if (target && !matched.some((x) => x.toEntityId === r.to_entity_id)) {
        matched.push({ toEntityId: r.to_entity_id, toKind: target.kind });
      }
    }
  }

  return matched;
}

/**
 * A membership-renewal offer has no catalog price (price_cents is
 * deliberately null) — its real price is always computed per-org, mirroring
 * the same FTE-tier / partnership-rate logic the invoice-based renewal flow
 * uses (createMembershipInvoice/createPartnershipInvoice in
 * lib/stripe/billing.ts), just without actually issuing a Stripe Invoice.
 *
 * persist:false for cart previews (repeated renders shouldn't clobber a
 * frozen cron-computed assessment for the org's year); persist:true exactly
 * once, at checkout time, when the price is about to actually be charged.
 *
 * Three cases, in order:
 * 1. Lapsed org (membership_status grace/locked) — they had a membership
 *    cycle they never paid for. Charge that missed cycle in FULL (no
 *    discount — they had the full year's access, or should have), plus full
 *    price for the upcoming cycle(s) needed to cover the conference.
 * 2. No backlog, but within renewal.pre_renewal_skip_stub_days of the next
 *    cycle start — not worth billing a small prorated stub for the dying
 *    cycle's last few days. Skip it; charge only the upcoming cycle(s), full
 *    price.
 * 3. No backlog, outside that window, and genuinely joining fresh (no valid
 *    expiry to extend from) — bill the existing billing.proration_rules
 *    stub for the current partial cycle, plus full price for any ADDITIONAL
 *    cycles bridged to reach a further-future conference (the discount
 *    compensates for a short first period, not a free extra year).
 *
 * An org with a currently-valid (non-lapsed) expiry that's simply being
 * extended further isn't a late join at all — always full price, matching
 * how the renewal cron's own on-time renewals never apply proration either.
 */
async function priceMembershipRenewalForOrg(
  organizationId: string,
  conferenceEndDate: string | null,
  opts: { persist: boolean; assumePartnership?: boolean }
): Promise<number> {
  const adminClient = createAdminClient();
  const { data: org } = await adminClient
    .from("organizations")
    .select("type, membership_status, membership_expires_at")
    .eq("id", organizationId)
    .single();

  // Re-check coverage against the CURRENT membership_expires_at, not just
  // whatever was true when this line was added to the cart. A renewal line
  // can sit in a cart while someone else at the org pays the outstanding
  // invoice directly via its hosted Stripe link — that already advances
  // membership_expires_at (lib/membership/renewal-activation.ts), so by the
  // time checkout runs this line may no longer be owed. Charging it anyway
  // would double-bill the same coverage period.
  if (conferenceEndDate && membershipCoversConference(org?.membership_expires_at ?? null, conferenceEndDate)) {
    return 0;
  }

  const priceForCycle = async (cycleBillingPeriodStart: string): Promise<number> => {
    // A booth is a Partner-track purchase — the renewal it drags along is
    // always priced as partnership dues, regardless of the buying org's
    // current type (a Member org buying its first booth still owes the flat
    // partnership rate, not FTE-tiered member dues).
    if (opts.assumePartnership || org?.type === "Vendor Partner") return getPartnershipRateCents();
    const assessment = await computeMembershipAssessment(organizationId, {
      billingPeriodStart: cycleBillingPeriodStart,
      persist: opts.persist,
    });
    return assessment.computedAmountCents;
  };

  const { billingPeriodStart, isLateJoin, cyclesBridged } = await computeNewExpiresAt(
    org?.membership_expires_at ?? null,
    conferenceEndDate
  );
  const perCycleCents = await priceForCycle(billingPeriodStart);
  const upcomingCents = perCycleCents * cyclesBridged;

  if (!isLateJoin) {
    // Currently-valid membership just being extended further — never a
    // discount, regardless of the day count.
    return upcomingCents;
  }

  // Case 1: genuinely lapsed with an unpaid prior cycle. Once that missed
  // cycle is paid, the org is "caught up" as of its OLD expiry — bridge
  // forward from THERE (a real cycle boundary), not from today, and drop
  // the first bridge step: it's the same span as the missed cycle just
  // billed, not a new additional one.
  if (
    (org?.membership_status === "grace" || org?.membership_status === "locked") &&
    org?.membership_expires_at
  ) {
    const missedCycleStart = org.membership_expires_at.split("T")[0];
    const missedCycleCents = await priceForCycle(missedCycleStart);
    const cyclesFromMissed = await cyclesNeededFrom(missedCycleStart, conferenceEndDate);
    const additionalCycles = cyclesFromMissed - 1;
    return missedCycleCents + perCycleCents * additionalCycles;
  }

  // Case 2 vs 3: no backlog — is this close enough to the next cycle start
  // that billing a stub for the remainder isn't worth it?
  const { cycle_start_month_day: cycleStartMonthDay, pre_renewal_skip_stub_days: skipStubDays } =
    await getRenewalConfig();
  const now = new Date();
  const cycleStartDate = nextCycleStartOnOrAfter(now, cycleStartMonthDay);

  if (isWithinPreRenewalSkipWindow(now, cycleStartMonthDay, skipStubDays)) {
    // Case 2: skip the stub — price starting from the upcoming cycle start
    // (a real boundary), not from today, so the very next cycle counts as
    // cycle 1 rather than stacking on top of an uncounted stub.
    const cyclesFromCycleStart = await cyclesNeededFrom(cycleStartDate, conferenceEndDate);
    return perCycleCents * cyclesFromCycleStart;
  }

  // Case 3: still meaningfully far from the reset — prorate the stub itself,
  // then full price for however many additional full cycles are needed
  // beyond it (cyclesBridged from today already counts the stub as step 1).
  const { amountCents: proratedStubCents } = await applyProration(perCycleCents, now);
  return proratedStubCents + perCycleCents * (cyclesBridged - 1);
}

/**
 * The unit price for a cart/order line — the membership-renewal offer's
 * price is always computed per-org (its catalog price_cents is deliberately
 * null), everything else uses the normal tier price.
 */
async function effectiveUnitPriceCents(
  offer: BuildEntity,
  buyerTier: string,
  organizationId: string,
  conferenceEndDate: string | null,
  opts: { persist: boolean; assumePartnership?: boolean }
): Promise<number> {
  if (offer.kind === MEMBERSHIP_RENEWAL_KIND) {
    return priceMembershipRenewalForOrg(organizationId, conferenceEndDate, opts);
  }
  return priceForTier(offer, buyerTier);
}

// Build a minimal BuildEntity so the pure pricing/eligibility rules can run
// over a single Offer loaded from the DB (no full workspace needed here).
function minimalOfferEntity(input: {
  id: string;
  kind: string;
  name: string;
  priceCents: number | null;
  currency: string;
  inventory: number | null;
  tierPrices: Record<string, number>;
  refs: EntityRefView[];
}): BuildEntity {
  return {
    id: input.id, kind: input.kind, name: input.name, isForSale: true,
    priceCents: input.priceCents, currency: input.currency, attributes: {},
    needsDefinition: false, inventory: input.inventory, tierPrices: input.tierPrices,
    qboItemId: null, salesWindow: null, refs: input.refs,
  };
}

/**
 * A membership-renewal line can be required by more than one cart item at
 * once (an org can hold multiple booths — each booth requiring the same
 * renewal). `linked_to` is stored as an array of the requiring cart item
 * ids so the renewal line is only ever removed once ALL of them are gone —
 * reads a legacy single-string value too, from before this was an array.
 */
function linkedToIds(metadata: unknown): string[] {
  const raw = (metadata as { linked_to?: unknown } | null)?.linked_to;
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") return [raw];
  return [];
}

export type AttendeeRef = { name: string; email: string | null };

/**
 * A registration cart line holds one attendee slot per unit of quantity —
 * buying 4 Day Passes in one line means 4 people, not 1. `null` at an index
 * means that unit is explicitly deferred ("assign later"), same meaning as
 * never having set it. Always read through this so a short/missing array
 * (e.g. before any assignment, or right after a quantity bump) reads as
 * "every slot open" rather than throwing on a missing index.
 */
function parseAttendees(metadata: unknown, quantity: number): (AttendeeRef | null)[] {
  const raw = (metadata as { attendees?: unknown } | null)?.attendees;
  const list = Array.isArray(raw) ? raw : [];
  const slots: (AttendeeRef | null)[] = [];
  for (let i = 0; i < quantity; i++) {
    const entry = list[i];
    slots.push(
      entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string"
        ? { name: (entry as { name: string }).name, email: (entry as { email?: string | null }).email ?? null }
        : null
    );
  }
  return slots;
}

/** Load the v3 Offer cart lines (as BuildEntities) so eligibility + tier pricing can run. */
async function getOfferCartRows(params: {
  conferenceId: string;
  organizationId: string;
  userId: string;
}): Promise<{
  rows: Array<{
    cartItemId: string;
    cartQuantity: number;
    offer: BuildEntity;
    linkedToCartItemIds: string[];
    attendees: (AttendeeRef | null)[];
  }>;
  byId: Map<string, BuildEntity>;
}> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  const { data: cartRows } = await adminClient
    .from("cart_items")
    .select("id, quantity, offer_entity_id, metadata")
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .eq("user_id", params.userId)
    .not("offer_entity_id", "is", null)
    // Exclude expired reservations — they'll be cleaned up lazily on next add.
    .or(`expires_at.is.null,expires_at.gt.${now}`);

  const offerIds = (cartRows ?? []).map((r) => r.offer_entity_id).filter((x): x is string => Boolean(x));
  if (offerIds.length === 0) return { rows: [], byId: new Map() };

  const [{ data: offers }, { data: whoRefs }] = await Promise.all([
    adminClient
      .from("conference_entities")
      .select("id, kind, name, price_cents, currency, inventory, tier_prices")
      .in("id", offerIds),
    adminClient
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, audience:conference_entities!conference_entity_refs_to_entity_id_fkey(id, attributes)")
      .in("from_entity_id", offerIds)
      .eq("role", "who"),
  ]);

  const byId = new Map<string, BuildEntity>();
  const whoByFrom = new Map<string, EntityRefView[]>();
  for (const r of whoRefs ?? []) {
    const aud = Array.isArray(r.audience) ? r.audience[0] : r.audience;
    if (!aud) continue;
    const audEntity = minimalOfferEntity({ id: aud.id, kind: "audience", name: "", priceCents: null, currency: "CAD", inventory: null, tierPrices: {}, refs: [] });
    audEntity.attributes = (aud.attributes as Record<string, string | number | null>) ?? {};
    byId.set(aud.id, audEntity);
    const list = whoByFrom.get(r.from_entity_id) ?? [];
    list.push({ toEntityId: aud.id, toName: "", toKind: "audience", role: "who", quantity: null });
    whoByFrom.set(r.from_entity_id, list);
  }

  const offerById = new Map((offers ?? []).map((o) => [o.id, o]));
  const rows = (cartRows ?? [])
    .map((cr) => {
      const o = cr.offer_entity_id ? offerById.get(cr.offer_entity_id) : undefined;
      if (!o) return null;
      const offer = minimalOfferEntity({
        id: o.id, kind: o.kind, name: o.name, priceCents: o.price_cents, currency: o.currency,
        inventory: o.inventory, tierPrices: (o.tier_prices as Record<string, number>) ?? {}, refs: whoByFrom.get(o.id) ?? [],
      });
      byId.set(o.id, offer);
      const linkedToCartItemIds = linkedToIds(cr.metadata);
      const attendees = o.kind === "registration" ? parseAttendees(cr.metadata, cr.quantity) : [];
      return { cartItemId: cr.id, cartQuantity: cr.quantity, offer, linkedToCartItemIds, attendees };
    })
    .filter(
      (
        x
      ): x is {
        cartItemId: string;
        cartQuantity: number;
        offer: BuildEntity;
        linkedToCartItemIds: string[];
        attendees: (AttendeeRef | null)[];
      } => x !== null
    );

  return { rows, byId };
}

/**
 * Best-effort pre-add hint for the floor plan / offers pages: is ANY offer
 * in this conference gated on membership, and if so, does this org already
 * cover the conference's dates? Checks whether a `requires` ref to a
 * membership-renewal entity exists anywhere in the conference's catalog
 * (typically set once, on a booth's type entity) — a cheap existence check,
 * not the authoritative per-purchase gate (that's addOfferToCart, which
 * additionally walks instance_of per R1). This is purely informational, so
 * a booth this check misses would still be correctly gated at add time.
 */
export async function getConferenceMembershipGateInfo(params: {
  conferenceId: string;
  organizationId: string;
}): Promise<
  | CommerceSuccess<{
      gated: boolean;
      coversConference: boolean;
      previewPriceCents: number | null;
      newExpiresAt: string | null;
    }>
  | CommerceFailure
> {
  const authz = await assertUserCanManageOrg({ organizationId: params.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  try {
    const adminClient = createAdminClient();

    const { data: requiresRefs } = await adminClient
      .from("conference_entity_refs")
      .select("to_entity_id, target:conference_entities!conference_entity_refs_to_entity_id_fkey(kind)")
      .eq("conference_id", params.conferenceId)
      .eq("role", "requires");

    const gated = (requiresRefs ?? []).some(
      (r) => (Array.isArray(r.target) ? r.target[0] : r.target)?.kind === MEMBERSHIP_RENEWAL_KIND
    );

    if (!gated) {
      return { success: true, data: { gated: false, coversConference: true, previewPriceCents: null, newExpiresAt: null } };
    }

    const [{ data: conference }, { data: org }] = await Promise.all([
      adminClient.from("conference_instances").select("end_date").eq("id", params.conferenceId).maybeSingle(),
      adminClient.from("organizations").select("membership_expires_at").eq("id", params.organizationId).single(),
    ]);

    const coversConference = conference?.end_date
      ? membershipCoversConference(org?.membership_expires_at ?? null, conference.end_date)
      : true;

    if (coversConference) {
      return { success: true, data: { gated, coversConference, previewPriceCents: null, newExpiresAt: null } };
    }

    const { billingPeriodEnd } = await computeNewExpiresAt(org?.membership_expires_at ?? null, conference?.end_date ?? null);
    // Only ever called from the floor-plan page (booths) — always a Partner-track preview.
    const previewPriceCents = await priceMembershipRenewalForOrg(
      params.organizationId,
      conference?.end_date ?? null,
      { persist: false, assumePartnership: true }
    );

    return {
      success: true,
      data: { gated, coversConference, previewPriceCents, newExpiresAt: billingPeriodEnd },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getConferenceCart(
  conferenceId: string,
  organizationId: string
): Promise<CommerceSuccess<{
  offerItems: Array<{
    cartItemId: string;
    offerEntityId: string;
    name: string;
    kind: string;
    quantity: number;
    unitPriceCents: number;
    linkedToCartItemIds: string[];
    attendees: (AttendeeRef | null)[];
  }>;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  try {
    const adminClient = createAdminClient();
    const [offerCart, conference, buyerTier, taxRates] = await Promise.all([
      getOfferCartRows({ conferenceId, organizationId, userId: authz.userId }),
      adminClient
        .from("conference_instances")
        .select("tax_rate_pct, end_date")
        .eq("id", conferenceId)
        .single()
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data;
        }),
      loadBuyerTier(organizationId),
      // Must use the same two-rate split as create_conference_order_from_cart,
      // or the total quoted in the cart won't match what checkout charges.
      resolveConferenceOrderTaxRates(adminClient, { conferenceId, organizationId }),
    ]);

    let subtotalCents = 0;
    let taxCents = 0;
    // A membership-renewal line linked to a booth is always Partner-track dues,
    // regardless of the buying org's current type.
    const cartItemKindById = new Map(offerCart.rows.map((r) => [r.cartItemId, r.offer.kind]));

    // v3 Offer lines: priced at the buyer's tier (or, for a membership-renewal
    // line, per-org — see effectiveUnitPriceCents), taxed at the conference rate.
    const offerItems = await Promise.all(
      offerCart.rows.map(async ({ cartItemId, cartQuantity, offer, linkedToCartItemIds, attendees }) => {
        const linkedToBooth = linkedToCartItemIds.some((id) => cartItemKindById.get(id) === "booth");
        const unitPriceCents = await effectiveUnitPriceCents(
          offer,
          buyerTier,
          organizationId,
          conference.end_date ?? null,
          { persist: false, assumePartnership: linkedToBooth }
        );
        const lineSubtotal = cartQuantity * unitPriceCents;
        subtotalCents += lineSubtotal;
        // Dues are taxed at the buyer's own province, everything else at the
        // conference's — see the two-treatment note in lib/stripe/tax.ts.
        const lineRatePct =
          offer.kind === MEMBERSHIP_RENEWAL_KIND
            ? taxRates.membershipRatePct
            : taxRates.conferenceRatePct;
        taxCents += Math.round(lineSubtotal * (lineRatePct / 100));
        return {
          cartItemId,
          offerEntityId: offer.id,
          name: offer.name,
          kind: offer.kind,
          quantity: cartQuantity,
          unitPriceCents,
          linkedToCartItemIds,
          attendees,
        };
      })
    );

    return {
      success: true,
      data: { offerItems, subtotalCents, taxCents, totalCents: subtotalCents + taxCents },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Add a v3 Offer to the cart — the gate is the same model the cockpit shows:
 * the buyer's tier must be eligible (canBuy over the Offer's `who` audiences)
 * and inventory must not be exceeded.
 */
export async function addOfferToCart(params: {
  conferenceId: string;
  organizationId: string;
  offerEntityId: string;
  quantity?: number;
  /** One slot per unit being added — `null`/omitted entries are "assign later." Registration offers only. */
  attendees?: (AttendeeRef | null)[];
}): Promise<
  | CommerceSuccess<{
      unitPriceCents: number;
      membershipRenewalAdded?: { cartItemId: string; priceCents: number };
    }>
  | CommerceFailure
> {
  const authz = await assertUserCanManageOrg({ organizationId: params.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  const quantity = Math.max(1, params.quantity ?? 1);

  try {
    const adminClient = createAdminClient();

    // Look up the conference's cart reservation timeout (default 15 min) and
    // end date (needed for the membership-coverage gate below).
    const { data: confRow } = await adminClient
      .from("conference_instances")
      .select("cart_reservation_minutes, end_date, status")
      .eq("id", params.conferenceId)
      .maybeSingle();
    if (!confRow || !(SALES_OPEN_STATUSES as readonly string[]).includes(confRow.status)) {
      return { success: false, error: "This conference isn't open for purchases yet." };
    }
    const reservationMinutes = confRow?.cart_reservation_minutes ?? 15;
    const expiresAt = new Date(Date.now() + reservationMinutes * 60 * 1000).toISOString();

    // Lazy cleanup: remove this org's own expired cart items before adding a new one.
    await adminClient
      .from("cart_items")
      .delete()
      .eq("conference_id", params.conferenceId)
      .eq("organization_id", params.organizationId)
      .eq("user_id", authz.userId)
      .lt("expires_at", new Date().toISOString());

    const { data: offerRow, error: offerError } = await adminClient
      .from("conference_entities")
      .select("id, kind, name, is_for_sale, price_cents, currency, inventory, tier_prices, attributes")
      .eq("id", params.offerEntityId)
      .eq("conference_id", params.conferenceId)
      .single();
    if (offerError || !offerRow) return { success: false, error: offerError?.message ?? "Offer not found." };

    // Some offers are deliberately kept off the general storefront
    // (is_for_sale: false) but still directly purchasable by an org that
    // knows the entity id — e.g. the $500 Book Partner registration, which
    // only Vendor Partner orgs in a specific category should ever reach, and
    // never via listConferenceOffers(). Gated on category here since the
    // generic who-audience/tier system has no concept of primary_category.
    const offerAttrs = (offerRow.attributes as Record<string, unknown> | null) ?? {};
    const directPurchaseOnly = offerAttrs.direct_purchase_only === true;
    if (!offerRow.is_for_sale && !directPurchaseOnly) {
      return { success: false, error: "This thing isn't for sale." };
    }
    if (directPurchaseOnly) {
      const requiredCategory = offerAttrs.direct_purchase_category;
      const { data: buyerOrg } = await adminClient
        .from("organizations")
        .select("type, primary_category")
        .eq("id", params.organizationId)
        .single();
      // direct_purchase_category may be a single category (string) or a list
      // of eligible categories (string[]) — e.g. Big Ideas Presentations
      // slots are open to both "Store Operations" and "Books".
      const categoryOk =
        requiredCategory == null ||
        (typeof requiredCategory === "string" && buyerOrg?.primary_category === requiredCategory) ||
        (Array.isArray(requiredCategory) && requiredCategory.includes(buyerOrg?.primary_category));
      if (buyerOrg?.type !== "Vendor Partner" || !categoryOk) {
        return { success: false, error: "Not eligible for this registration." };
      }
    }

    // The membership-renewal entity is only ever attached automatically by
    // this gate — never independently addable, even via a direct call.
    if (offerRow.kind === MEMBERSHIP_RENEWAL_KIND) {
      return { success: false, error: "Membership renewal can't be added directly — it's attached automatically when required by another purchase." };
    }

    // Orgs can hold multiple booths (board decision), capped at
    // MAX_BOOTHS_PER_CART so one org can't lock up the whole floor plan.
    // What still has to hold is per-booth exclusivity: this specific booth
    // can't be held by a DIFFERENT org's active cart reservation, nor
    // already sold to anyone (checked below via entity_purchases/inventory).
    // The exclusivity check + the cap check + writing the hold all happen
    // atomically inside one Postgres function (advisory-locked on the booth
    // id, and separately on the org id for the cap) — doing this as a plain
    // check-then-insert here would leave the same race window that let two
    // buyers both reserve the same booth, or an org's own rapid double-click
    // slip past the cap.
    let boothCartItemId!: string;
    if (offerRow.kind === "booth") {
      const { data: reserveResult, error: reserveError } = await adminClient.rpc("reserve_booth_cart_item", {
        p_conference_id: params.conferenceId,
        p_organization_id: params.organizationId,
        p_user_id: authz.userId,
        p_offer_entity_id: params.offerEntityId,
        p_expires_at: expiresAt,
        p_max_booths: MAX_BOOTHS_PER_CART,
      });
      if (reserveError) return { success: false, error: reserveError.message };
      const result = reserveResult as
        | { success: true; cart_item_id: string }
        | { success: false; code: "BOOTH_RESERVED"; org_name: string | null }
        | { success: false; code: "TOO_MANY_BOOTHS"; max: number };
      if (!result.success) {
        if (result.code === "BOOTH_RESERVED") {
          return {
            success: false,
            code: "BOOTH_RESERVED",
            error: `This booth is currently reserved by ${result.org_name ?? "another organization"}. Try again once their hold expires.`,
          };
        }
        return {
          success: false,
          code: "TOO_MANY_BOOTHS",
          error: `Your organization can hold at most ${result.max} booths in cart at once.`,
        };
      }
      boothCartItemId = result.cart_item_id;
    }

    // The Offer's `who` audiences carry the permission tiers that may buy it.
    const { data: whoRefs } = await adminClient
      .from("conference_entity_refs")
      .select("to_entity_id, audience:conference_entities!conference_entity_refs_to_entity_id_fkey(id, attributes)")
      .eq("from_entity_id", params.offerEntityId)
      .eq("role", "who");

    const byId = new Map<string, BuildEntity>();
    const offerRefs: EntityRefView[] = [];
    for (const r of whoRefs ?? []) {
      const aud = Array.isArray(r.audience) ? r.audience[0] : r.audience;
      if (!aud) continue;
      byId.set(aud.id, minimalOfferEntity({
        id: aud.id, kind: "audience", name: "", priceCents: null, currency: "CAD",
        inventory: null, tierPrices: {}, refs: [],
      }));
      // carry the audience's source_role via attributes for eligibleTiers()
      byId.get(aud.id)!.attributes = (aud.attributes as Record<string, string | number | null>) ?? {};
      offerRefs.push({ toEntityId: aud.id, toName: "", toKind: "audience", role: "who", quantity: null });
    }

    const offer = minimalOfferEntity({
      id: offerRow.id, kind: offerRow.kind, name: offerRow.name, priceCents: offerRow.price_cents,
      currency: offerRow.currency, inventory: offerRow.inventory,
      tierPrices: (offerRow.tier_prices as Record<string, number>) ?? {}, refs: offerRefs,
    });

    const buyerTier = await loadBuyerTier(params.organizationId);

    const eligible = canBuy(offer, buyerTier, byId);
    if (!eligible.ok) return { success: false, code: "INELIGIBLE", error: eligible.reason ?? "Not eligible to buy this." };

    // Ownership gate: some offers (e.g. a booth-bundled registration) only
    // make sense once the org already holds a specific thing (e.g. a Bronze
    // booth, not just any booth) — set directly on this offer, or inherited
    // from its instance_of type. Checked by identity (own id or instance_of
    // parent), not by kind, since e.g. Bronze and plain Exhibitor booths are
    // both kind "booth" but bundle different add-ons. A prerequisite already
    // in the SAME cart counts as held too, since both can ride the same checkout.
    const ownershipRefs = await loadEffectiveRefsByRole(adminClient, params.offerEntityId, OWNERSHIP_ROLE);
    const requiredEntityIds = offerRequiresOwnershipOfEntityIds(
      ownershipRefs.map((r) => ({ role: OWNERSHIP_ROLE, ...r }))
    );
    if (requiredEntityIds.length > 0) {
      const [{ data: ownedBalances }, { data: cartOffers }] = await Promise.all([
        adminClient
          .from("entity_balances")
          .select("entity_id")
          .eq("conference_id", params.conferenceId)
          .eq("organization_id", params.organizationId),
        adminClient
          .from("cart_items")
          .select("offer_entity_id")
          .eq("conference_id", params.conferenceId)
          .eq("organization_id", params.organizationId)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
      ]);
      const heldEntityIds = [
        ...(ownedBalances ?? []).map((b) => b.entity_id),
        ...(cartOffers ?? []).map((c) => c.offer_entity_id),
      ].filter((id): id is string => Boolean(id));
      const { data: instanceOfRows } =
        heldEntityIds.length > 0
          ? await adminClient
              .from("conference_entity_refs")
              .select("from_entity_id, to_entity_id")
              .eq("role", "instance_of")
              .in("from_entity_id", heldEntityIds)
          : { data: [] as Array<{ from_entity_id: string; to_entity_id: string }> };
      const instanceOfParentByChild = new Map((instanceOfRows ?? []).map((r) => [r.from_entity_id, r.to_entity_id]));
      const heldIdentityIds = expandWithInstanceOfParents(heldEntityIds, instanceOfParentByChild);
      if (!ownershipRequirementSatisfied(requiredEntityIds, heldIdentityIds)) {
        return {
          success: false,
          code: "REQUIRES_OWNERSHIP",
          error: "Your organization needs to already hold the prerequisite for this.",
        };
      }
    }

    // Inventory at add time = already sold + what's already in this cart line.
    const [{ data: sales }, { data: existing }] = await Promise.all([
      adminClient.from("entity_purchases").select("quantity").eq("offer_entity_id", params.offerEntityId),
      adminClient.from("cart_items").select("id, quantity, metadata")
        .eq("conference_id", params.conferenceId)
        .eq("organization_id", params.organizationId)
        .eq("user_id", authz.userId)
        .eq("offer_entity_id", params.offerEntityId)
        .maybeSingle(),
    ]);
    const sold = (sales ?? []).reduce((n, s) => n + s.quantity, 0);
    // A booth is one physical space, not a countable commodity — re-adding the
    // same booth just refreshes the reservation, it never bumps the quantity.
    const wanted = offerRow.kind === "booth" ? 1 : (existing?.quantity ?? 0) + quantity;
    const avail = availability(offer, sold);
    if (avail.remaining != null && wanted > avail.remaining) {
      return {
        success: false,
        code: "SOLD_OUT",
        error: avail.soldOut ? "Sold out." : `Only ${avail.remaining} left.`,
      };
    }

    // New attendee slots for the units being added this call — padded/trimmed
    // to exactly `quantity` so the stored array always lines up with how many
    // units it's actually appended for (extra/missing entries would drift the
    // seat↔attendee zip at mint time).
    const newSlots: (AttendeeRef | null)[] = Array.from({ length: quantity }, (_, i) => params.attendees?.[i] ?? null);

    if (offerRow.kind !== "booth") {
      if (existing) {
        // Refresh expires_at on every re-add so the reservation window extends,
        // and append this call's attendee slots after whatever's already there —
        // topping up quantity must not clobber attendees already assigned to
        // earlier units in the line.
        const existingAttendees = parseAttendees(existing.metadata, existing.quantity);
        const nextMetadata =
          offerRow.kind === "registration" ? { attendees: [...existingAttendees, ...newSlots] } : existing.metadata;
        const { error: updErr } = await adminClient
          .from("cart_items")
          .update({
            quantity: wanted,
            updated_at: new Date().toISOString(),
            expires_at: expiresAt,
            metadata: nextMetadata,
          })
          .eq("id", existing.id);
        if (updErr) return { success: false, error: updErr.message };
        boothCartItemId = existing.id;
      } else {
        const { data: inserted, error: insErr } = await adminClient
          .from("cart_items")
          .insert({
            conference_id: params.conferenceId,
            organization_id: params.organizationId,
            user_id: authz.userId,
            offer_entity_id: params.offerEntityId,
            quantity: wanted,
            expires_at: expiresAt,
            metadata: offerRow.kind === "registration" ? { attendees: newSlots } : null,
          })
          .select("id")
          .single();
        if (insErr || !inserted) return { success: false, error: insErr?.message ?? "Failed to add to cart." };
        boothCartItemId = inserted.id;
      }
    }

    // Membership gate: if this offer `requires` a membership-renewal entity
    // (set directly, or inherited from its instance_of type) and this org's
    // membership doesn't cover the conference's dates, auto-attach a linked
    // membership-renewal cart line so both ride the same checkout. Only
    // applies to member/partner buyers — a non_member-tier org has no
    // membership to renew (membership_expires_at is null by definition), so
    // without this guard the coverage check always fails and silently bills
    // them for a renewal on top of the offer itself. Some Day Pass entities
    // (e.g. "Wednesday Day Pass") are shared across both audiences with the
    // same `requires` ref, since the requirement is real for the member side.
    let membershipRenewalAdded: { cartItemId: string; priceCents: number } | undefined;
    const requiresRefs = await loadEffectiveRefsByRole(adminClient, params.offerEntityId, "requires");
    const membershipEntityId = offerRequiresMembershipRenewal(
      requiresRefs.map((r) => ({ role: "requires", ...r }))
    );
    if (membershipEntityId && confRow?.end_date && (buyerTier === "member" || buyerTier === "partner")) {
      const { data: orgRow } = await adminClient
        .from("organizations")
        .select("membership_expires_at")
        .eq("id", params.organizationId)
        .single();

      if (!membershipCoversConference(orgRow?.membership_expires_at ?? null, confRow.end_date)) {
        // A self-serve "Renew Now" (lib/actions/renewal.ts) or the renewal
        // cron may have already generated and sent a real Stripe invoice for
        // this org that just hasn't been paid yet — membership_expires_at
        // only advances on invoice.paid, so membershipCoversConference above
        // can't see that it exists. Rather than blocking the purchase on it,
        // fold the same renewal into this cart/checkout: activateMembershipRenewal
        // (lib/membership/renewal-activation.ts) voids any other outstanding
        // renewal invoice for the org the moment this payment succeeds, so
        // there's no double-billing risk from letting both exist momentarily.
        const priceCents = await priceMembershipRenewalForOrg(params.organizationId, confRow.end_date, {
          persist: false,
          assumePartnership: offerRow.kind === "booth",
        });

        const { data: existingMembershipItem } = await adminClient
          .from("cart_items")
          .select("id, metadata")
          .eq("conference_id", params.conferenceId)
          .eq("organization_id", params.organizationId)
          .eq("user_id", authz.userId)
          .eq("offer_entity_id", membershipEntityId)
          .maybeSingle();

        if (existingMembershipItem) {
          // A second booth (an org can hold multiple) can require the same
          // renewal line — add to the set of requiring items rather than
          // overwriting it, so removing just one booth later doesn't strip
          // the renewal out from under the other(s).
          const existingLinks = linkedToIds(existingMembershipItem.metadata);
          const linkedTo = existingLinks.includes(boothCartItemId) ? existingLinks : [...existingLinks, boothCartItemId];
          await adminClient
            .from("cart_items")
            .update({
              expires_at: expiresAt,
              updated_at: new Date().toISOString(),
              metadata: { linked_to: linkedTo },
            })
            .eq("id", existingMembershipItem.id);
          membershipRenewalAdded = { cartItemId: existingMembershipItem.id, priceCents };
        } else {
          const { data: insertedMembership, error: membershipInsErr } = await adminClient
            .from("cart_items")
            .insert({
              conference_id: params.conferenceId,
              organization_id: params.organizationId,
              user_id: authz.userId,
              offer_entity_id: membershipEntityId,
              quantity: 1,
              expires_at: expiresAt,
              metadata: { linked_to: [boothCartItemId] },
            })
            .select("id")
            .single();
          if (!membershipInsErr && insertedMembership) {
            membershipRenewalAdded = { cartItemId: insertedMembership.id, priceCents };
          }
        }
      }
    }

    return {
      success: true,
      data: { unitPriceCents: priceForTier(offer, buyerTier), membershipRenewalAdded },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateCartItemQuantity(params: {
  cartItemId: string;
  quantity: number;
}): Promise<CommerceSuccess<CartRow> | CommerceFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const adminClient = createAdminClient();
    const { data: item, error: itemError } = await adminClient
      .from("cart_items")
      .select("*")
      .eq("id", params.cartItemId)
      .single();

    if (itemError || !item) return { success: false, error: itemError?.message ?? "Cart item not found" };

    if (
      !isGlobalAdmin(auth.ctx.globalRole) &&
      item.user_id !== auth.ctx.userId &&
      !auth.ctx.activeOrgIds.includes(item.organization_id)
    ) {
      return { success: false, error: "Not authorized" };
    }

    if (params.quantity <= 0) {
      const { error: deleteError } = await adminClient.from("cart_items").delete().eq("id", item.id);
      if (deleteError) return { success: false, error: deleteError.message };
      return { success: true, data: { ...item, quantity: 0, updated_at: new Date().toISOString() } };
    }

    // A booth is one physical space, not a countable commodity — its quantity is immutably 1.
    let nextQuantity = params.quantity;
    let isRegistration = false;
    if (item.offer_entity_id) {
      const { data: offerRow } = await adminClient
        .from("conference_entities")
        .select("kind")
        .eq("id", item.offer_entity_id)
        .maybeSingle();
      if (offerRow?.kind === "booth") nextQuantity = 1;
      isRegistration = offerRow?.kind === "registration";
    }

    // Resize the attendee-slot array to match — growing pads with open
    // ("assign later") slots, shrinking drops from the end. There's no
    // "which unit are you removing" signal from a bare quantity edit, so the
    // last slot(s) are what go; if one was assigned, that assignment is lost,
    // same as removing a physical seat would be.
    const nextMetadata = isRegistration
      ? { attendees: parseAttendees(item.metadata, nextQuantity) }
      : item.metadata;

    const { data: updated, error: updateError } = await adminClient
      .from("cart_items")
      .update({ quantity: nextQuantity, updated_at: new Date().toISOString(), metadata: nextMetadata })
      .eq("id", item.id)
      .select("*")
      .single();

    if (updateError || !updated) {
      return { success: false, error: updateError?.message ?? "Failed to update cart item" };
    }

    return { success: true, data: updated };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Set (or clear) who a single unit of a registration cart line is for — the
 * cart-side counterpart of the org/slug seat-assignment matrix, just applied
 * before checkout instead of after. `attendee: null` means "assign later,"
 * same meaning as never having set that slot.
 */
/** email if present, else the trimmed lowercased name — the identity key used to spot the same person picked twice. */
function attendeeKey(attendee: AttendeeRef): string {
  return (attendee.email?.trim().toLowerCase() || attendee.name.trim().toLowerCase());
}

export async function setCartItemAttendee(params: {
  cartItemId: string;
  index: number;
  attendee: AttendeeRef | null;
}): Promise<CommerceSuccess<{ warning: string | null }> | CommerceFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: item, error: itemError } = await adminClient
    .from("cart_items")
    .select("id, user_id, organization_id, conference_id, quantity, metadata, offer_entity_id")
    .eq("id", params.cartItemId)
    .single();
  if (itemError || !item) return { success: false, error: itemError?.message ?? "Cart item not found" };

  if (
    !isGlobalAdmin(auth.ctx.globalRole) &&
    item.user_id !== auth.ctx.userId &&
    !auth.ctx.activeOrgIds.includes(item.organization_id)
  ) {
    return { success: false, error: "Not authorized" };
  }

  if (params.index < 0 || params.index >= item.quantity) {
    return { success: false, error: "That unit doesn't exist on this cart line." };
  }

  const slots = parseAttendees(item.metadata, item.quantity);

  // Same person, two units of the same line — never legitimate (both units
  // grant the exact same access), so this is a hard block, not a warning.
  if (params.attendee) {
    const key = attendeeKey(params.attendee);
    const dupIndex = slots.findIndex((s, i) => i !== params.index && s && attendeeKey(s) === key);
    if (dupIndex !== -1) {
      return {
        success: false,
        error: `${params.attendee.name} is already assigned to unit #${dupIndex + 1} of this line — pick someone else.`,
      };
    }
  }

  slots[params.index] = params.attendee;

  const { error } = await adminClient
    .from("cart_items")
    .update({ metadata: { attendees: slots }, updated_at: new Date().toISOString() })
    .eq("id", item.id);
  if (error) return { success: false, error: error.message };

  // Cross-registration overlap: warn (don't block) if this person already
  // holds — or is staged elsewhere in this same cart for — a registration
  // that covers the same day as this one (e.g. already has Full Conference,
  // which already includes Wednesday, and is now also being given a
  // Wednesday Day Pass).
  let warning: string | null = null;
  if (params.attendee?.email && item.offer_entity_id) {
    const email = params.attendee.email.trim().toLowerCase();

    const [{ data: people }, { data: siblingItems }, entitiesRes, refsRes] = await Promise.all([
      adminClient
        .from("conference_people")
        .select("id")
        .eq("conference_id", item.conference_id)
        .eq("organization_id", item.organization_id)
        .ilike("contact_email", email),
      adminClient
        .from("cart_items")
        .select("offer_entity_id, quantity, metadata")
        .eq("conference_id", item.conference_id)
        .eq("organization_id", item.organization_id)
        .eq("user_id", item.user_id)
        .neq("id", item.id)
        .not("offer_entity_id", "is", null)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
      adminClient.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", item.conference_id),
      adminClient.from("conference_entity_refs").select("from_entity_id, to_entity_id, role, quantity").eq("conference_id", item.conference_id),
    ]);

    const personIds = (people ?? []).map((p) => p.id);
    const { data: heldSeats } =
      personIds.length > 0
        ? await adminClient
            .from("entity_balance_seats")
            .select("entity_id")
            .eq("conference_id", item.conference_id)
            .in("holder_person_id", personIds)
        : { data: [] as Array<{ entity_id: string }> };

    const siblingEntityIds = (siblingItems ?? [])
      .filter((row) => parseAttendees(row.metadata, row.quantity).some((a) => a && a.email?.trim().toLowerCase() === email))
      .map((row) => row.offer_entity_id)
      .filter((id): id is string => Boolean(id));

    const otherEntityIds = [...(heldSeats ?? []).map((s) => s.entity_id), ...siblingEntityIds];
    const byId = indexById(buildEntityGraph(entitiesRes.data ?? [], refsRes.data ?? []));
    const overlap = findOverlappingRegistration(item.offer_entity_id, otherEntityIds, byId);
    if (overlap.overlapping) {
      warning = `${params.attendee.name} already holds "${overlap.conflictingEntityName}", which already covers the same day — you may want to fix this assignment.`;
    }
  }

  return { success: true, data: { warning } };
}

export async function removeCartItem(cartItemId: string): Promise<CommerceSuccess<null> | CommerceFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: item, error: itemError } = await adminClient
    .from("cart_items")
    .select("id, user_id, organization_id, metadata")
    .eq("id", cartItemId)
    .single();

  if (itemError || !item) return { success: false, error: itemError?.message ?? "Cart item not found" };

  if (
    !isGlobalAdmin(auth.ctx.globalRole) &&
    item.user_id !== auth.ctx.userId &&
    !auth.ctx.activeOrgIds.includes(item.organization_id)
  ) {
    return { success: false, error: "Not authorized" };
  }

  // A membership-renewal line auto-attached to a booth can't be removed on
  // its own — removing just the top-up while keeping the booth would
  // silently reintroduce the ungated state. Remove the linked booth instead.
  if (linkedToIds(item.metadata).length > 0) {
    return {
      success: false,
      code: "LINKED_ITEM",
      error: "This is required by another item in your cart — remove that item to remove this one too.",
    };
  }

  // Removing a booth also removes any membership-renewal line IT required —
  // but that line can be shared by more than one booth (an org can hold
  // multiple), so only drop this booth from the shared line's requiring set,
  // and only delete the line once every requiring booth is gone.
  const { data: linkedItems } = await adminClient
    .from("cart_items")
    .select("id, metadata")
    .contains("metadata", { linked_to: [cartItemId] });
  for (const linkedItem of linkedItems ?? []) {
    const remaining = linkedToIds(linkedItem.metadata).filter((id) => id !== cartItemId);
    if (remaining.length > 0) {
      await adminClient.from("cart_items").update({ metadata: { linked_to: remaining } }).eq("id", linkedItem.id);
    } else {
      await adminClient.from("cart_items").delete().eq("id", linkedItem.id);
    }
  }

  const { error } = await adminClient.from("cart_items").delete().eq("id", cartItemId);
  if (error) return { success: false, error: error.message };

  return { success: true, data: null };
}

export async function clearCart(params: {
  conferenceId: string;
  organizationId: string;
}): Promise<CommerceSuccess<null> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId: params.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("cart_items")
    .delete()
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .eq("user_id", authz.userId);

  if (error) return { success: false, error: error.message };

  // A checkout may already be in flight (pending order created, Stripe never
  // confirmed) — clearing the cart should release that capacity immediately
  // too, not leave it locked until the order's own expiry catches up.
  await adminClient
    .from("conference_orders")
    .update({ status: "canceled" })
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .eq("user_id", authz.userId)
    .eq("status", "pending");

  return { success: true, data: null };
}

export async function createConferenceCheckout(
  input: CheckoutInput
): Promise<CommerceSuccess<{ checkoutUrl: string; orderId: string; checkoutSessionId: string }> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId: input.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  try {
    const adminClient = createAdminClient();

    const offerCart = await getOfferCartRows({
      conferenceId: input.conferenceId,
      organizationId: input.organizationId,
      userId: authz.userId,
    });

    if (offerCart.rows.length === 0) {
      return { success: false, code: "EMPTY_CART", error: "Cart is empty." };
    }

    const { data: conference, error: conferenceError } = await adminClient
      .from("conference_instances")
      .select("tax_rate_pct, stripe_tax_rate_id, end_date, status")
      .eq("id", input.conferenceId)
      .single();

    if (conferenceError || !conference) {
      return { success: false, error: conferenceError?.message ?? "Conference not found" };
    }
    if (!(SALES_OPEN_STATUSES as readonly string[]).includes(conference.status)) {
      return { success: false, error: "This conference isn't open for purchases yet." };
    }

    // v3 Offer lines: eligibility (who-can-buy) + the buyer's tier price (or,
    // for a membership-renewal line, its per-org price). persist:true here —
    // this is the actual checkout, the moment the assessment should freeze.
    const buyerTier = await loadBuyerTier(input.organizationId);

    // Ownership gate re-check (defense in depth — addOfferToCart already
    // checked this at add time, but a prerequisite item could have been
    // removed from the cart since). A prerequisite elsewhere in this SAME
    // cart still counts as held, since both ride the same checkout. Checked
    // by identity (own id or instance_of parent), not by kind — Bronze and
    // plain Exhibitor booths are both kind "booth" but bundle different add-ons.
    const [{ data: ownedBalances }] = await Promise.all([
      adminClient
        .from("entity_balances")
        .select("entity_id")
        .eq("conference_id", input.conferenceId)
        .eq("organization_id", input.organizationId),
    ]);
    const heldEntityIds = [
      ...(ownedBalances ?? []).map((b) => b.entity_id),
      ...offerCart.rows.map((r) => r.offer.id),
    ].filter((id): id is string => Boolean(id));
    const { data: instanceOfRows } =
      heldEntityIds.length > 0
        ? await adminClient
            .from("conference_entity_refs")
            .select("from_entity_id, to_entity_id")
            .eq("role", "instance_of")
            .in("from_entity_id", heldEntityIds)
        : { data: [] as Array<{ from_entity_id: string; to_entity_id: string }> };
    const instanceOfParentByChild = new Map((instanceOfRows ?? []).map((r) => [r.from_entity_id, r.to_entity_id]));
    const heldIdentityIds = expandWithInstanceOfParents(heldEntityIds, instanceOfParentByChild);
    // A membership-renewal line linked to a booth is always Partner-track dues,
    // regardless of the buying org's current type — look up what each linked
    // cart item actually is.
    const cartItemKindById = new Map(offerCart.rows.map((r) => [r.cartItemId, r.offer.kind]));

    const offerPrices: Record<string, number> = {};
    for (const { offer, linkedToCartItemIds } of offerCart.rows) {
      const eligible = canBuy(offer, buyerTier, offerCart.byId);
      if (!eligible.ok) {
        return { success: false, code: "INELIGIBLE", error: `${offer.name}: ${eligible.reason ?? "Not eligible to buy this."}` };
      }

      const ownershipRefs = await loadEffectiveRefsByRole(adminClient, offer.id, OWNERSHIP_ROLE);
      const requiredEntityIds = offerRequiresOwnershipOfEntityIds(
        ownershipRefs.map((r) => ({ role: OWNERSHIP_ROLE, ...r }))
      );
      if (!ownershipRequirementSatisfied(requiredEntityIds, heldIdentityIds)) {
        return {
          success: false,
          code: "REQUIRES_OWNERSHIP",
          error: `${offer.name}: your organization needs to already hold the prerequisite to check out with this.`,
        };
      }

      const linkedToBooth = linkedToCartItemIds.some((id) => cartItemKindById.get(id) === "booth");
      offerPrices[offer.id] = await effectiveUnitPriceCents(
        offer,
        buyerTier,
        input.organizationId,
        conference.end_date ?? null,
        { persist: true, assumePartnership: linkedToBooth }
      );
    }

    const idempotencyKey =
      input.idempotencyKey ??
      `${input.conferenceId}:${input.organizationId}:${authz.userId}:${crypto.randomUUID()}`;

    const taxRates = await resolveConferenceOrderTaxRates(adminClient, {
      conferenceId: input.conferenceId,
      organizationId: input.organizationId,
    });

    const { data: order, error: orderError } = await adminClient.rpc(
      "create_conference_order_from_cart",
      {
        p_user_id: authz.userId,
        p_organization_id: input.organizationId,
        p_conference_id: input.conferenceId,
        p_checkout_idempotency_key: idempotencyKey,
        p_tax_rate_pct: taxRates.conferenceRatePct,
        p_membership_tax_rate_pct: taxRates.membershipRatePct,
        p_currency: "CAD",
        p_offer_prices: Object.keys(offerPrices).length > 0 ? offerPrices : null,
      }
    );

    if (orderError || !order) {
      return {
        success: false,
        code: orderError?.code,
        error: orderError?.message ?? "Failed to create pending conference order.",
      };
    }

    const { data: offerOrderItems, error: offerOrderItemsError } = await adminClient
      .from("conference_order_items")
      .select("quantity, unit_price_cents, offer:conference_entities!conference_order_items_offer_entity_id_fkey(name, kind)")
      .eq("order_id", order.id)
      .not("offer_entity_id", "is", null);
    if (offerOrderItemsError) return { success: false, error: offerOrderItemsError.message };

    if ((offerOrderItems?.length ?? 0) === 0) {
      return { success: false, error: "Order items not found for checkout session." };
    }

    const lineItems = (offerOrderItems ?? []).map((item) => {
      const offer = (item as unknown as { offer: { name: string; kind: string } | null }).offer;
      // Must mirror the per-line branch create_conference_order_from_cart just
      // used to price this order. If Stripe taxes a dues line at the
      // conference's rate while the order priced it at the buyer's province,
      // the customer is charged a total the order doesn't record.
      const stripeTaxRateId =
        offer?.kind === MEMBERSHIP_RENEWAL_KIND
          ? taxRates.membershipStripeTaxRateId
          : taxRates.conferenceStripeTaxRateId;
      return {
        quantity: item.quantity,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: item.unit_price_cents,
          product_data: { name: offer?.name ?? "Conference offer" },
        },
        ...(stripeTaxRateId ? { tax_rates: [stripeTaxRateId] } : {}),
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      line_items: lineItems,
      client_reference_id: order.id,
      payment_intent_data: {
        metadata: {
          checkout_kind: "conference",
          conference_id: input.conferenceId,
          conference_order_id: order.id,
          organization_id: input.organizationId,
          user_id: authz.userId,
        },
      },
      metadata: {
        checkout_kind: "conference",
        conference_id: input.conferenceId,
        conference_order_id: order.id,
        organization_id: input.organizationId,
        user_id: authz.userId,
      },
    });

    const { error: updateOrderError } = await adminClient
      .from("conference_orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", order.id);

    if (updateOrderError) {
      return { success: false, error: updateOrderError.message };
    }

    if (!session.url) {
      return { success: false, error: "Stripe checkout URL was not returned." };
    }

    await logAuditEventSafe({
      action: "conference_checkout_create",
      entityType: "conference_order",
      entityId: order.id,
      actorId: authz.userId,
      actorType: "user",
      details: {
        success: true,
        conferenceId: input.conferenceId,
        organizationId: input.organizationId,
        checkoutSessionId: session.id,
      },
    });

    return {
      success: true,
      data: { checkoutUrl: session.url, orderId: order.id, checkoutSessionId: session.id },
    };
  } catch (error) {
    await logAuditEventSafe({
      action: "conference_checkout_create",
      entityType: "conference_order",
      actorId: authz.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId: input.conferenceId,
        organizationId: input.organizationId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listConferenceOrdersForOrganization(params: {
  conferenceId: string;
  organizationId: string;
}): Promise<CommerceSuccess<OrderRow[]> | CommerceFailure> {
  const authz = await assertUserCanManageOrg({ organizationId: params.organizationId });
  if (!authz.ok) return { success: false, error: authz.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_orders")
    .select("*")
    .eq("conference_id", params.conferenceId)
    .eq("organization_id", params.organizationId)
    .order("created_at", { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

export async function getConferenceOrderDetails(orderId: string): Promise<
  | CommerceSuccess<{
      order: OrderRow;
      items: Array<OrderItemRow & { product_name: string | null; product_slug: string | null }>;
    }>
  | CommerceFailure
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: order, error: orderError } = await adminClient
    .from("conference_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { success: false, error: orderError?.message ?? "Order not found." };
  }

  const canRead =
    isGlobalAdmin(auth.ctx.globalRole) ||
    order.user_id === auth.ctx.userId ||
    auth.ctx.activeOrgIds.includes(order.organization_id);
  if (!canRead) return { success: false, error: "Not authorized" };

  const { data: items, error: itemsError } = await adminClient
    .from("conference_order_items")
    .select("*, offer:conference_entities!conference_order_items_offer_entity_id_fkey(name, kind)")
    .eq("order_id", orderId);

  if (itemsError) return { success: false, error: itemsError.message };

  const normalizedItems = (items ?? []).map((item) => ({
    ...(item as unknown as OrderItemRow),
    product_name:
      (item as unknown as { offer?: { name?: string } }).offer?.name ?? null,
    product_slug:
      (item as unknown as { offer?: { kind?: string } }).offer?.kind ?? null,
  }));

  return { success: true, data: { order, items: normalizedItems } };
}

export async function calculateConferenceRefund(
  orderId: string
): Promise<CommerceSuccess<{ refundPct: number; refundAmountCents: number; eligible: boolean; daysUntilConference: number }> | CommerceFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: order, error: orderError } = await adminClient
    .from("conference_orders")
    .select("id, conference_id, organization_id, user_id, status, total_cents")
    .eq("id", orderId)
    .single();

  if (orderError || !order) return { success: false, error: orderError?.message ?? "Order not found" };

  const canRead =
    isGlobalAdmin(auth.ctx.globalRole) ||
    order.user_id === auth.ctx.userId ||
    auth.ctx.activeOrgIds.includes(order.organization_id);

  if (!canRead) return { success: false, error: "Not authorized" };

  if (!["paid", "partially_refunded"].includes(order.status)) {
    return {
      success: true,
      data: { refundPct: 0, refundAmountCents: 0, eligible: false, daysUntilConference: -1 },
    };
  }

  const { data: conference, error: conferenceError } = await adminClient
    .from("conference_instances")
    .select("start_date")
    .eq("id", order.conference_id)
    .single();

  if (conferenceError || !conference?.start_date) {
    return { success: false, error: conferenceError?.message ?? "Conference date unavailable" };
  }

  const startDate = new Date(`${conference.start_date}T00:00:00Z`);
  const now = new Date();
  const daysUntilConference = Math.floor((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  let refundPct = 0;
  if (daysUntilConference > 90) refundPct = 100;
  else if (daysUntilConference >= 30) refundPct = 50;

  // A membership renewal bundled into this order is non-refundable once
  // paid — reverting membership_expires_at on a later refund is operationally
  // risky (no clean "undo" for anything that legitimately happened while
  // membership was active in the meantime), and matches how the normal
  // invoice-refund path (processRefund in lib/stripe/billing.ts) also never
  // reverts membership state on refund. Only the rest of the order refunds.
  const { data: membershipLines } = await adminClient
    .from("conference_order_items")
    .select("total_cents, offer:conference_entities!conference_order_items_offer_entity_id_fkey(kind)")
    .eq("order_id", orderId);
  const membershipLineCents = (membershipLines ?? [])
    .filter((l) => (Array.isArray(l.offer) ? l.offer[0] : l.offer)?.kind === MEMBERSHIP_RENEWAL_KIND)
    .reduce((sum, l) => sum + l.total_cents, 0);
  const refundableBaseCents = Math.max(0, order.total_cents - membershipLineCents);

  const refundAmountCents = Math.round(refundableBaseCents * (refundPct / 100));

  return {
    success: true,
    data: { refundPct, refundAmountCents, eligible: refundPct > 0, daysUntilConference },
  };
}

export async function requestConferenceRefund(
  orderId: string,
  overrideAmountCents?: number,
  options?: {
    allowManagedOverride?: boolean;
    overrideReason?: string;
  }
): Promise<
  CommerceSuccess<{
    orderId: string;
    refundAmountCents: number;
    refundPct: number;
    totalRefundedCents: number;
    stripeRefundId: string;
  }> | CommerceFailure
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: order, error: orderError } = await adminClient
    .from("conference_orders")
    .select("id, organization_id, user_id, stripe_payment_intent_id, total_cents, refund_amount_cents")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { success: false, error: orderError?.message ?? "Order not found." };
  }

  const canManage =
    isGlobalAdmin(auth.ctx.globalRole) ||
    order.user_id === auth.ctx.userId ||
    auth.ctx.activeOrgIds.includes(order.organization_id);
  if (!canManage) return { success: false, error: "Not authorized" };

  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);
  const alreadyRefunded = order.refund_amount_cents ?? 0;
  const remainingRefundable = Math.max(0, order.total_cents - alreadyRefunded);
  if (remainingRefundable <= 0) {
    return {
      success: false,
      error: "Order has already been fully refunded.",
      code: "REFUND_NOT_ELIGIBLE",
    };
  }

  const refundQuote = await calculateConferenceRefund(orderId);
  if (!refundQuote.success) return refundQuote;
  if (!refundQuote.data.eligible && !isAdmin) {
    return {
      success: false,
      error: "Order is not eligible for a refund under current policy.",
      code: "REFUND_NOT_ELIGIBLE",
    };
  }

  let requestedRefundAmount = refundQuote.data.refundAmountCents;
  if (typeof overrideAmountCents === "number") {
    const managedOverrideAllowed = Boolean(options?.allowManagedOverride);
    if (!isAdmin && !managedOverrideAllowed) {
      return {
        success: false,
        error: "Only admins can override refund amounts.",
        code: "REFUND_OVERRIDE_FORBIDDEN",
      };
    }
    if (!Number.isInteger(overrideAmountCents) || overrideAmountCents <= 0) {
      return {
        success: false,
        error: "Override refund amount must be a positive integer (cents).",
        code: "REFUND_OVERRIDE_INVALID",
      };
    }
    requestedRefundAmount = overrideAmountCents;
  }

  if (requestedRefundAmount <= 0) {
    return {
      success: false,
      error: "Refund amount must be greater than zero.",
      code: "REFUND_NOT_ELIGIBLE",
    };
  }

  if (requestedRefundAmount > remainingRefundable) {
    return {
      success: false,
      error: `Refund exceeds remaining refundable amount (${remainingRefundable} cents).`,
      code: "REFUND_OVERRIDE_INVALID",
    };
  }

  if (!order.stripe_payment_intent_id) {
    return {
      success: false,
      error: "Stripe payment intent is missing for this order.",
      code: "STRIPE_REFERENCE_MISSING",
    };
  }

  try {
    const stripeRefund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent_id,
      amount: requestedRefundAmount,
      reason: "requested_by_customer",
      metadata: {
        checkout_kind: "conference",
        conference_order_id: orderId,
      },
    });

    const { error: refundUpdateError } = await adminClient.rpc("process_conference_order_refund", {
      p_order_id: orderId,
      p_refund_amount_cents: alreadyRefunded + requestedRefundAmount,
    });

    if (refundUpdateError) {
      await logAuditEventSafe({
        action: "conference_refund_request",
        entityType: "conference_order",
        entityId: orderId,
        actorId: auth.ctx.userId,
        actorType: "user",
        details: {
          success: false,
          reason: "refund_update_failed",
          error: refundUpdateError.message,
          requestedRefundAmount,
        },
      });
      return { success: false, error: refundUpdateError.message };
    }

    // Idempotency key is stripeRefund.id — the same refund's charge.refunded
    // webhook will also fire and try to enqueue, but the unique constraint on
    // qbo_conference_refund_queue.stripe_refund_id makes the second insert a no-op.
    await enqueueQBConferenceRefund(orderId, stripeRefund.id, requestedRefundAmount);

    await logAuditEventSafe({
      action: "conference_refund_request",
      entityType: "conference_order",
      entityId: orderId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: true,
        requestedRefundAmount,
        totalRefundedCents: alreadyRefunded + requestedRefundAmount,
        stripeRefundId: stripeRefund.id,
        overrideReason: options?.overrideReason ?? null,
        usedManagedOverride: Boolean(
          typeof overrideAmountCents === "number" && !isAdmin && options?.allowManagedOverride
        ),
      },
    });

    return {
      success: true,
      data: {
        orderId,
        refundAmountCents: requestedRefundAmount,
        refundPct: refundQuote.data.refundPct,
        totalRefundedCents: alreadyRefunded + requestedRefundAmount,
        stripeRefundId: stripeRefund.id,
      },
    };
  } catch (error) {
    await logAuditEventSafe({
      action: "conference_refund_request",
      entityType: "conference_order",
      entityId: orderId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        reason: "stripe_refund_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getConferenceReceiptUrl(
  orderId: string
): Promise<CommerceSuccess<{ url: string | null }> | CommerceFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: order, error: orderError } = await adminClient
    .from("conference_orders")
    .select("id, organization_id, user_id, stripe_payment_intent_id")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { success: false, error: orderError?.message ?? "Order not found." };
  }

  const canRead =
    isGlobalAdmin(auth.ctx.globalRole) ||
    order.user_id === auth.ctx.userId ||
    auth.ctx.activeOrgIds.includes(order.organization_id);
  if (!canRead) return { success: false, error: "Not authorized" };

  if (!order.stripe_payment_intent_id) {
    return { success: true, data: { url: null } };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id, {
      expand: ["latest_charge"],
    });

    const latestCharge = paymentIntent.latest_charge;
    if (!latestCharge || typeof latestCharge === "string") {
      return { success: true, data: { url: null } };
    }

    return { success: true, data: { url: latestCharge.receipt_url ?? null } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * DEV ONLY: complete the current Offer cart without Stripe. Runs the exact RPCs
 * the live Stripe webhook drives (create_conference_order_from_cart →
 * process_conference_order_paid → mint_v3_for_order), plus the same
 * attendee-minting step (mintRegistrationAttendeesFromOrder) the webhook runs
 * afterward — so cart attendee assignments actually seat, not just mint
 * unassigned, and the whole buy → assign loop is testable end-to-end in dev.
 * Global-admin gated and blocked in production; the real buyer path is
 * createConferenceCheckout + Stripe.
 */
export async function devCompleteConferenceCheckout(params: {
  conferenceId: string;
  organizationId: string;
}): Promise<CommerceSuccess<{ orderId: string }> | CommerceFailure> {
  if (process.env.NODE_ENV === "production") {
    return { success: false, error: "Dev checkout is not available in production." };
  }
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Dev checkout requires a global admin." };
  }

  try {
    const adminClient = createAdminClient();
    const offerCart = await getOfferCartRows({
      conferenceId: params.conferenceId,
      organizationId: params.organizationId,
      userId: auth.ctx.userId,
    });
    if (offerCart.rows.length === 0) {
      return { success: false, code: "EMPTY_CART", error: "Cart is empty." };
    }

    const { data: conference, error: conferenceError } = await adminClient
      .from("conference_instances")
      .select("tax_rate_pct, end_date")
      .eq("id", params.conferenceId)
      .single();
    if (conferenceError || !conference) {
      return { success: false, error: conferenceError?.message ?? "Conference not found" };
    }

    const buyerTier = await loadBuyerTier(params.organizationId);
    const cartItemKindById = new Map(offerCart.rows.map((r) => [r.cartItemId, r.offer.kind]));
    const offerPrices: Record<string, number> = {};
    for (const { offer, linkedToCartItemIds } of offerCart.rows) {
      const eligible = canBuy(offer, buyerTier, offerCart.byId);
      if (!eligible.ok) {
        return { success: false, code: "INELIGIBLE", error: `${offer.name}: ${eligible.reason ?? "Not eligible to buy this."}` };
      }
      const linkedToBooth = linkedToCartItemIds.some((id) => cartItemKindById.get(id) === "booth");
      offerPrices[offer.id] = await effectiveUnitPriceCents(
        offer,
        buyerTier,
        params.organizationId,
        conference.end_date ?? null,
        { persist: true, assumePartnership: linkedToBooth }
      );
    }

    const devTaxRates = await resolveConferenceOrderTaxRates(adminClient, {
      conferenceId: params.conferenceId,
      organizationId: params.organizationId,
    });

    const { data: order, error: orderError } = await adminClient.rpc("create_conference_order_from_cart", {
      p_user_id: auth.ctx.userId,
      p_organization_id: params.organizationId,
      p_conference_id: params.conferenceId,
      p_checkout_idempotency_key: `dev-${crypto.randomUUID()}`,
      p_tax_rate_pct: devTaxRates.conferenceRatePct,
      p_membership_tax_rate_pct: devTaxRates.membershipRatePct,
      p_currency: "CAD",
      p_offer_prices: offerPrices,
    });
    if (orderError || !order) {
      return { success: false, code: orderError?.code, error: orderError?.message ?? "Failed to create order." };
    }

    const { error: paidError } = await adminClient.rpc("process_conference_order_paid", {
      p_order_id: order.id,
      p_checkout_session_id: `dev_${order.id}`,
    });
    if (paidError) return { success: false, error: paidError.message };

    // Mirrors the real webhook's attendee-minting step — without this, cart
    // attendee assignments would silently mint as unassigned seats, making
    // this button useless for testing the assignment flow.
    await mintRegistrationAttendeesFromOrder(adminClient, order.id, params.conferenceId, params.organizationId);

    // Mirrors the real webhook's Bronze/Connected-tier auto-agreement hook,
    // so this dev path is testable without a real Stripe payment. A cart can
    // hold more than one booth (an org can hold multiple), so every booth
    // line needs its own call, not just the first.
    const boothOffers = offerCart.rows.map((r) => r.offer).filter((o) => o.kind === "booth");
    for (const boothOffer of boothOffers) {
      if (boothOffer.priceCents != null) {
        await createSponsorAgreementFromBoothPurchase({
          organizationId: params.organizationId,
          boothEntityId: boothOffer.id,
          boothEntityName: boothOffer.name,
          boothPriceCents: boothOffer.priceCents,
        });
      }
    }

    // Cart consumed by the completed order.
    await adminClient
      .from("cart_items")
      .delete()
      .eq("conference_id", params.conferenceId)
      .eq("organization_id", params.organizationId)
      .eq("user_id", auth.ctx.userId);

    await logAuditEventSafe({
      action: "conference_dev_checkout_complete",
      entityType: "conference_order",
      entityId: order.id,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { conferenceId: params.conferenceId, organizationId: params.organizationId, dev: true },
    });

    return { success: true, data: { orderId: order.id } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Cron: cancel pending conference_orders whose reservation window has lapsed
 * (checkout started, Stripe never confirmed) so their capacity frees back up
 * for real. create_conference_order_from_cart already stops COUNTING a
 * pending order past its expires_at — this is what actually flips the status
 * so it stops needing that special-casing everywhere else. The underlying
 * Stripe Checkout Session isn't touched here; it expires on its own 24h timer.
 */
export async function expireStalePendingConferenceOrders(): Promise<{ success: boolean; expiredCount?: number }> {
  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("conference_orders")
    .update({ status: "canceled" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    console.error("[conference-commerce] expireStalePendingConferenceOrders failed:", error);
    return { success: false };
  }

  const count = data?.length ?? 0;

  if (count > 0) {
    await logAuditEventSafe({
      action: "conference_orders_expired",
      entityType: "system",
      entityId: "system",
      actorId: "system",
      actorType: "system",
      details: { expiredCount: count },
    });
  }

  return { success: true, expiredCount: count };
}
