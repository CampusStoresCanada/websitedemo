"use server";

import { requireAdmin, requireAuthenticated, canManageOrganization, isGlobalAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexById, openQuestions, effectiveRefs } from "@/lib/conference/entity-graph";
import { wouldCycleIncludes } from "@/lib/conference/entity-graph";
import { RELATIONSHIP_BY_ROLE } from "@/lib/conference/entity-kinds";
import { availability, canBuy, priceForTier } from "@/lib/conference/entity-pricing";
import { accessibleThings, offerGrants, summarizeAccess, type Grant, type AccessSummary } from "@/lib/conference/entity-commerce";
import { buildEntityGraph, ENTITY_SELECT } from "@/lib/conference/entity-rows";
import { MEMBERSHIP_RENEWAL_KIND } from "@/lib/conference/membership-gate";
import { getProgramsConfig, resolveConferenceTier } from "@/lib/policy/engine";
import {
  offerRequiresOwnershipOfEntityIds,
  expandWithInstanceOfParents,
  ownershipRequirementSatisfied,
} from "@/lib/conference/ownership-gate";

/**
 * Conference v3 catalog — generic entity + reference primitives.
 *
 * Everything is a THING (entity) you give a free kind-label. One universal
 * reference plugs any thing into any other with a ROLE and optional QUANTITY —
 * that single mechanism is composition ("includes 4× registration"),
 * participation ("involved in Trade Show"), when/where/who, and type→instance
 * ("instance_of Booth"). Per-kind scalar detail lives in one attributes jsonb.
 * "Sellable" is a capability (an Offer). The engine reasons over roles + the
 * for-sale flag — never over the kind label. See blueprint §6d.
 */

export type EntityKind = string;
export type EntityAttributes = Record<string, string | number | null>;

export type EntityRefView = {
  toEntityId: string;
  toName: string;
  toKind: EntityKind;
  role: string;
  quantity: number | null;
};

export type BuildEntity = {
  id: string;
  kind: EntityKind;
  name: string;
  isForSale: boolean;
  priceCents: number | null;
  currency: string;
  attributes: EntityAttributes;
  needsDefinition: boolean;
  inventory: number | null;
  tierPrices: Record<string, number>;
  /** QuickBooks item this entity's sales post to — usually set on the type
   * and inherited by instances (see effectiveQboItemId in entity-graph.ts). */
  qboItemId: string | null;
  /** Which scheduled open time the conference-sales-open cron gates this
   * entity's is_for_sale flip on — 'member' (registration_open_at),
   * 'vendor' (booth_sales_general_open_at), or null (manual only, no
   * automated scheduling). See lib/conference/sales-open.ts. */
  salesWindow: "member" | "vendor" | null;
  refs: EntityRefView[];
};

export type LinkedEvent = { id: string; slug: string; title: string; status: string };

export type BuildWorkspace = {
  entities: BuildEntity[];
  soldByOffer: Record<string, number>;
  /** Events rows already linked (via conference_entity_id) to an entity, keyed by entity id. */
  linkedEventByEntityId: Record<string, LinkedEvent>;
};

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** The website's people categories — inherited as starting-point audiences. */
const AUDIENCE_TIERS: ReadonlyArray<{ role: string; name: string }> = [
  { role: "public", name: "Public" },
  { role: "partner", name: "Partner" },
  { role: "member", name: "Member" },
  { role: "org_admin", name: "Org Admin" },
  { role: "admin", name: "Admin" },
  { role: "super_admin", name: "Super Admin" },
];

function cleanAttributes(input: EntityAttributes | undefined): EntityAttributes {
  const out: EntityAttributes = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Create / update / delete a thing
// ─────────────────────────────────────────────────────────────────

export async function createEntity(
  conferenceId: string,
  input: {
    kind: EntityKind;
    name: string;
    isForSale?: boolean;
    priceCents?: number | null;
    currency?: string;
    attributes?: EntityAttributes;
    needsDefinition?: boolean;
    inventory?: number | null;
    tierPrices?: Record<string, number>;
    qboItemId?: string | null;
    salesWindow?: "member" | "vendor" | null;
  }
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.name.trim()) return { success: false, error: "Name is required." };
  if (!input.kind.trim()) return { success: false, error: "Kind is required." };

  const db = createAdminClient();
  const { data: entity, error } = await db
    .from("conference_entities")
    .insert({
      conference_id: conferenceId,
      kind: input.kind.trim(),
      name: input.name.trim(),
      is_for_sale: input.isForSale ?? false,
      price_cents: input.priceCents ?? null,
      currency: input.currency ?? "CAD",
      attributes: cleanAttributes(input.attributes),
      needs_definition: input.needsDefinition ?? false,
      inventory: input.inventory ?? null,
      tier_prices: input.tierPrices ?? {},
      qbo_item_id: input.qboItemId ?? null,
      sales_window: input.salesWindow ?? null,
    })
    .select("id")
    .single();
  if (error || !entity) return { success: false, error: error?.message ?? "Failed to create thing." };
  return { success: true, data: { id: entity.id } };
}

export async function updateEntity(
  entityId: string,
  input: {
    kind?: EntityKind;
    name?: string;
    isForSale?: boolean;
    priceCents?: number | null;
    attributes?: EntityAttributes;
    needsDefinition?: boolean;
    inventory?: number | null;
    tierPrices?: Record<string, number>;
    qboItemId?: string | null;
    salesWindow?: "member" | "vendor" | null;
  }
): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.kind !== undefined) patch.kind = input.kind.trim();
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.isForSale !== undefined) patch.is_for_sale = input.isForSale;
  if (input.priceCents !== undefined) patch.price_cents = input.priceCents;
  if (input.attributes !== undefined) patch.attributes = cleanAttributes(input.attributes);
  if (input.needsDefinition !== undefined) patch.needs_definition = input.needsDefinition;
  if (input.inventory !== undefined) patch.inventory = input.inventory;
  if (input.tierPrices !== undefined) patch.tier_prices = input.tierPrices;
  if (input.qboItemId !== undefined) patch.qbo_item_id = input.qboItemId;
  if (input.salesWindow !== undefined) patch.sales_window = input.salesWindow;

  const { error } = await db.from("conference_entities").update(patch).eq("id", entityId);
  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}

export async function deleteEntity(entityId: string): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const { error } = await db.from("conference_entities").delete().eq("id", entityId);
  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}

// ─────────────────────────────────────────────────────────────────
// References: replace the set of references FROM a thing
// ─────────────────────────────────────────────────────────────────

export async function setEntityReferences(
  conferenceId: string,
  fromEntityId: string,
  refs: Array<{ toEntityId: string; role: string; quantity?: number | null }>
): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  // A thing can't reference itself.
  if (refs.some((r) => r.toEntityId === fromEntityId)) {
    return { success: false, error: "A thing can't reference itself." };
  }

  const db = createAdminClient();

  // "includes" must stay acyclic — no A includes … includes A.
  const includeRefs = refs.filter((r) => r.role === "includes");
  if (includeRefs.length > 0) {
    const { data: existing } = await db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id")
      .eq("conference_id", conferenceId)
      .eq("role", "includes")
      .neq("from_entity_id", fromEntityId);
    const graph = (existing ?? []).map((e) => ({ from: e.from_entity_id, to: e.to_entity_id }));
    for (const r of includeRefs) {
      if (wouldCycleIncludes(graph, fromEntityId, r.toEntityId)) {
        return { success: false, error: 'That "includes" would create a loop.' };
      }
      graph.push({ from: fromEntityId, to: r.toEntityId });
    }
  }

  const { error: delError } = await db
    .from("conference_entity_refs")
    .delete()
    .eq("from_entity_id", fromEntityId);
  if (delError) return { success: false, error: delError.message };

  if (refs.length > 0) {
    const { error: insError } = await db.from("conference_entity_refs").insert(
      refs.map((r) => ({
        conference_id: conferenceId,
        from_entity_id: fromEntityId,
        to_entity_id: r.toEntityId,
        role: r.role,
        // Quantity only means something on roles that carry it; clamp to ≥ 1.
        quantity: RELATIONSHIP_BY_ROLE[r.role]?.hasQuantity ? Math.max(1, Number(r.quantity ?? 1)) : null,
      }))
    );
    if (insError) return { success: false, error: insError.message };
  }
  return { success: true, data: null };
}

// ─────────────────────────────────────────────────────────────────
// Type → instances: stamp dozens of copies that point at one type
// ─────────────────────────────────────────────────────────────────

export async function stampInstances(
  conferenceId: string,
  typeId: string,
  names: string[]
): Promise<Result<{ created: Array<{ id: string; name: string }> }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: type, error: typeErr } = await db
    .from("conference_entities")
    .select("kind")
    .eq("id", typeId)
    .single();
  if (typeErr || !type) return { success: false, error: typeErr?.message ?? "Type not found." };

  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return { success: false, error: "No instance names given." };

  const created: Array<{ id: string; name: string }> = [];
  for (const name of clean) {
    const { data: inst, error: insErr } = await db
      .from("conference_entities")
      .insert({ conference_id: conferenceId, kind: type.kind, name, attributes: {} })
      .select("id")
      .single();
    if (insErr || !inst) return { success: false, error: insErr?.message ?? "Failed to create instance." };
    const { error: refErr } = await db.from("conference_entity_refs").insert({
      conference_id: conferenceId,
      from_entity_id: inst.id,
      to_entity_id: typeId,
      role: "instance_of",
      quantity: null,
    });
    if (refErr) return { success: false, error: refErr.message };
    created.push({ id: inst.id, name });
  }
  return { success: true, data: { created } };
}

// ─────────────────────────────────────────────────────────────────
// Backward references: seed pools from what we already know
// ─────────────────────────────────────────────────────────────────

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** "2027-03-04" → "Wed, Mar 4" (UTC so the date never shifts a day). */
function formatDayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

async function seedDayEntities(conferenceId: string, db: ReturnType<typeof createAdminClient>): Promise<void> {
  const { data: conf } = await db
    .from("conference_instances")
    .select("start_date, end_date")
    .eq("id", conferenceId)
    .single();
  if (!conf?.start_date || !conf?.end_date || conf.end_date < conf.start_date) return;

  const { data: existing } = await db
    .from("conference_entities")
    .select("attributes")
    .eq("conference_id", conferenceId)
    .eq("kind", "day");
  const have = new Set((existing ?? []).map((r) => (r.attributes as EntityAttributes)?.date).filter(Boolean));

  for (const iso of enumerateDates(conf.start_date, conf.end_date).filter((d) => !have.has(d))) {
    await db.from("conference_entities").insert({
      conference_id: conferenceId, kind: "day", name: formatDayLabel(iso), attributes: { date: iso },
    });
  }
}

async function seedAudienceEntities(conferenceId: string, db: ReturnType<typeof createAdminClient>): Promise<void> {
  const { data: existing } = await db
    .from("conference_entities")
    .select("attributes")
    .eq("conference_id", conferenceId)
    .eq("kind", "audience");
  const have = new Set((existing ?? []).map((r) => (r.attributes as EntityAttributes)?.source_role).filter(Boolean));

  for (const tier of AUDIENCE_TIERS) {
    if (have.has(tier.role)) continue;
    await db.from("conference_entities").insert({
      conference_id: conferenceId, kind: "audience", name: tier.name, attributes: { source_role: tier.role },
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Read: the whole Build workspace (one flat graph)
// ─────────────────────────────────────────────────────────────────

// RawEntityRow, RawRefRow, buildEntityGraph, and ENTITY_SELECT now live in
// lib/conference/entity-rows.ts (shared with the schedule service) and are
// imported at the top of this file.

/**
 * Launch-gate signal: how many things the conference's v3 catalog has, and how
 * many still have open questions. Does NOT seed (so a conference that never used
 * the Build interface reports zero things — the old product checks govern it).
 */
export async function getConferenceCatalogReadiness(
  conferenceId: string
): Promise<Result<{ thingCount: number; openQuestionCount: number; forSaleCount: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const [entitiesRes, refsRes] = await Promise.all([
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db.from("conference_entity_refs").select("from_entity_id, to_entity_id, role, quantity").eq("conference_id", conferenceId),
  ]);
  if (entitiesRes.error) return { success: false, error: entitiesRes.error.message };
  if (refsRes.error) return { success: false, error: refsRes.error.message };

  const entities = buildEntityGraph(entitiesRes.data ?? [], refsRes.data ?? []);
  const byId = indexById(entities);
  const openQuestionCount = entities.filter((e) => openQuestions(e, byId).length > 0).length;
  const forSaleCount = entities.filter((e) => e.isForSale).length;
  return { success: true, data: { thingCount: entities.length, openQuestionCount, forSaleCount } };
}

/** A for-sale thing as the storefront shows it to one buyer org. */
export type ConferenceOffer = {
  id: string;
  name: string;
  kind: EntityKind;
  unitPriceCents: number;
  eligible: boolean;
  ineligibleReason: string | null;
  remaining: number | null;
  soldOut: boolean;
  includes: Grant[];
  /** Persuasive summary of the same access graph — "all meals," not each one by name. */
  accessSummary: AccessSummary;
};

/**
 * The storefront: every for-sale thing in a conference, priced + gated for the
 * buyer org's tier, with what each Offer includes and how many remain. Reads the
 * same entity graph the Build step authors — the store is a VIEW of Describe.
 * The org-manager (or a global admin) buying for that org is the audience.
 */
export async function listConferenceOffers(
  conferenceId: string,
  organizationId: string
): Promise<Result<ConferenceOffer[]>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (
    !isGlobalAdmin(auth.ctx.globalRole) &&
    !auth.ctx.activeOrgIds.includes(organizationId)
  ) {
    return { success: false, error: "Not authorized for this organization." };
  }

  const db = createAdminClient();
  const [orgRes, entitiesRes, refsRes, salesRes, balancesRes, programs] = await Promise.all([
    db.from("organizations").select("type").eq("id", organizationId).maybeSingle(),
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conferenceId),
    db.from("entity_purchases").select("offer_entity_id, quantity").eq("conference_id", conferenceId),
    db
      .from("entity_balances")
      .select("entity_id")
      .eq("conference_id", conferenceId)
      .eq("organization_id", organizationId),
    getProgramsConfig(),
  ]);
  if (entitiesRes.error) return { success: false, error: entitiesRes.error.message };
  if (refsRes.error) return { success: false, error: refsRes.error.message };

  const buyerTier = resolveConferenceTier(orgRes.data?.type ?? null, programs);
  const entities = buildEntityGraph(entitiesRes.data ?? [], refsRes.data ?? []);
  const byId = indexById(entities);

  const soldByOffer = new Map<string, number>();
  for (const s of salesRes.data ?? []) {
    if (!s.offer_entity_id) continue;
    soldByOffer.set(s.offer_entity_id, (soldByOffer.get(s.offer_entity_id) ?? 0) + (s.quantity ?? 0));
  }

  // What this org already owns — offers that require ownership of a
  // specific thing (e.g. a Bronze-booth-bundled registration) stay off the
  // general storefront entirely for orgs that don't already hold it, rather
  // than merely appearing as ineligible. They're only reachable via the
  // org's own profile page once the prerequisite is held. Checked by
  // identity (own id or instance_of parent), not by kind — Bronze and plain
  // Exhibitor booths are both kind "booth" but are different products with
  // different bundled add-ons.
  const instanceOfParentByChild = new Map(
    (refsRes.data ?? []).filter((r) => r.role === "instance_of").map((r) => [r.from_entity_id, r.to_entity_id])
  );
  const heldIdentityIds = expandWithInstanceOfParents(
    (balancesRes.data ?? []).map((b) => b.entity_id).filter((id): id is string => Boolean(id)),
    instanceOfParentByChild
  );

  const offers: ConferenceOffer[] = entities
    // The membership-renewal entity is only ever attached automatically by
    // the booth-gating flow (lib/actions/conference-commerce.ts) — it's
    // never independently browsable/purchasable, and its catalog price is
    // deliberately null (real price is computed per-org at add/checkout time).
    .filter((e) => e.isForSale && e.kind !== MEMBERSHIP_RENEWAL_KIND)
    .filter((e) => {
      const requiredEntityIds = offerRequiresOwnershipOfEntityIds(effectiveRefs(e, byId));
      return ownershipRequirementSatisfied(requiredEntityIds, heldIdentityIds);
    })
    .map((offer) => {
      const elig = canBuy(offer, buyerTier, byId);
      const avail = availability(offer, soldByOffer.get(offer.id) ?? 0);
      return {
        id: offer.id,
        name: offer.name,
        kind: offer.kind,
        unitPriceCents: priceForTier(offer, buyerTier),
        eligible: elig.ok,
        ineligibleReason: elig.ok ? null : elig.reason ?? "Not eligible.",
        remaining: avail.remaining,
        soldOut: avail.soldOut,
        includes: offerGrants(offer.id, byId),
        accessSummary: summarizeAccess(offer.id, byId),
      };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name));

  return { success: true, data: offers };
}

// ─────────────────────────────────────────────────────────────────
// Floor plan — a VIEW over booth things. Positions live in each booth's
// attributes (x/y/w/h); status is derived from holdings. The map is not a
// separate data model — it renders the same entities the Catalog authors.
// ─────────────────────────────────────────────────────────────────

export type FloorPlanBooth = {
  id: string;
  name: string;
  number: string | null;
  size: string | null;
  /** Placement on the background, as fractions of the image (0..1) + degrees. */
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  rotation: number | null;
  /** Optional custom fill colour (hex). Overrides status colour when set. */
  color: string | null;
  isForSale: boolean;
  priceCents: number | null;
  status: "sold" | "reserved" | "available" | "draft";
  /** Org that purchased (sold) or reserved (in cart) this booth. */
  heldByOrg: string | null;
  /** Name of the type entity this booth is an instance_of, if any. */
  typeName: string | null;
  /** Short admin-authored blurb explaining what this booth's price buys, shown on the public card. */
  pitch: string | null;
  /** Identity of the org that purchased this booth, for the "who is there" card + map logo. Sold only. */
  soldOrg: { id: string; name: string; logoUrl: string | null; category: string | null; type: string } | null;
};

export type ConferenceFloorPlan = {
  /** Public URL of the uploaded venue background image, if any. */
  floorPlanUrl: string | null;
  booths: FloorPlanBooth[];
};

/** Public (authenticated) version — same data but org-manager or global-admin access. */
export async function getPublicConferenceFloorPlan(
  conferenceId: string
): Promise<Result<ConferenceFloorPlan>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  return _loadFloorPlan(conferenceId);
}

/**
 * Fully public version — no auth required. Booths are one of the things meant
 * to be freely purchasable by a brand-new prospect (see the anonymous
 * pay-first booth flow in prospective-booth-checkout.ts), so an anonymous
 * visitor needs to be able to load the map itself, not just an authenticated
 * org's view of it.
 */
export async function getFloorPlanForVisitor(conferenceId: string): Promise<Result<ConferenceFloorPlan>> {
  return _loadFloorPlan(conferenceId);
}

export type NonMemberDayPass = {
  id: string;
  name: string;
  priceCents: number;
  accessSummary: AccessSummary;
  /** Every entity id this pass grants (itself + everything reachable via includes/involved_in) — lets a caller filter the real schedule timeline down to exactly this pass's day, not a hand-picked list. */
  entityIds: string[];
};

const NON_MEMBER_AUDIENCE_ENTITY_ID = "a9581ad9-5e15-4cc8-a53c-178fcf5ce910";

/**
 * Fully public — the day passes a non-member (no CSC account) can buy,
 * with the same summarizeAccess() "what's included" the real member/partner
 * storefront (OfferCard.tsx) shows, so a buyer without portal access still
 * sees what a day actually grants (floor access, meals, evening event)
 * before paying, not just a name and a price.
 */
export async function getNonMemberDayPasses(conferenceId: string): Promise<NonMemberDayPass[]> {
  const db = createAdminClient();
  const [{ data: offerRows }, { data: entityRows }, { data: refRows }] = await Promise.all([
    db
      .from("conference_entity_refs")
      .select("from_entity:conference_entities!conference_entity_refs_from_entity_id_fkey(id, name, is_for_sale, price_cents, tier_prices)")
      .eq("conference_id", conferenceId)
      .eq("role", "who")
      .eq("to_entity_id", NON_MEMBER_AUDIENCE_ENTITY_ID),
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db.from("conference_entity_refs").select("from_entity_id, to_entity_id, role, quantity").eq("conference_id", conferenceId),
  ]);

  const byId = indexById(buildEntityGraph(entityRows ?? [], refRows ?? []));

  return (offerRows ?? [])
    .map((r) => (Array.isArray(r.from_entity) ? r.from_entity[0] : r.from_entity))
    .filter((e): e is { id: string; name: string; is_for_sale: boolean; price_cents: number | null; tier_prices: unknown } => !!e?.is_for_sale)
    .map((e) => {
      const tierPrices = (e.tier_prices as Record<string, number> | null) ?? {};
      const priceCents = typeof tierPrices.non_member === "number" ? tierPrices.non_member : e.price_cents ?? 0;
      const entityIds = [e.id, ...accessibleThings([e.id], byId).map((t) => t.id)];
      return { id: e.id, name: e.name, priceCents, accessSummary: summarizeAccess(e.id, byId), entityIds };
    });
}

export type ConfirmedExhibitor = { id: string; name: string; category: string | null; logoUrl: string | null };

/**
 * Fully public — orgs who've actually bought a booth for this conference, so
 * a non-member deciding whether a Day Pass is worth it can see *who* they'd
 * actually meet on the floor, not just a headline count. Sourced from
 * entity_balances (real purchases), not the catalog's for-sale inventory —
 * the same distinction floor-plan-viewer.tsx's soldOrg already draws.
 */
export async function getConfirmedExhibitors(conferenceId: string): Promise<ConfirmedExhibitor[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("entity_balances")
    .select("entity:conference_entities!entity_balances_entity_id_fkey(kind), organizations(id, name, primary_category, logo_url)")
    .eq("conference_id", conferenceId);

  const byId = new Map<string, ConfirmedExhibitor>();
  for (const row of data ?? []) {
    const entity = Array.isArray(row.entity) ? row.entity[0] : row.entity;
    if (entity?.kind !== "booth") continue;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (!org || byId.has(org.id)) continue;
    byId.set(org.id, { id: org.id, name: org.name, category: org.primary_category, logoUrl: org.logo_url });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function _loadFloorPlan(conferenceId: string): Promise<Result<ConferenceFloorPlan>> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const [boothsRes, salesRes, cartRes, pendingOrderRes, prospectRes, confRes, refsRes] = await Promise.all([
    db.from("conference_entities").select("id, name, is_for_sale, price_cents, attributes").eq("conference_id", conferenceId).eq("kind", "booth"),
    // Sold: entity_balances tells us which org holds each booth (1 row per purchase → entity).
    db.from("entity_balances")
      .select("entity_id, organization_id, organizations(id, name, logo_url, primary_category, type)")
      .eq("conference_id", conferenceId),
    // Active (non-expired) booth cart items show as "reserved" (amber on the map).
    db.from("cart_items").select("offer_entity_id, organization_id, organizations(name)")
      .eq("conference_id", conferenceId)
      .not("offer_entity_id", "is", null)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
    // A checkout in progress (order created, Stripe not yet confirmed) also holds
    // the booth — without this, the map would show it "available" mid-purchase.
    db.from("conference_orders")
      .select("organization_id, organizations(name), conference_order_items(offer_entity_id)")
      .eq("conference_id", conferenceId)
      .eq("status", "pending")
      .or(`expires_at.is.null,expires_at.gt.${now}`),
    // A paid "pay first, apply second" prospect (no org yet) holds the booth
    // too, from payment until their application is approved and it actually
    // mints — otherwise the map shows it available the whole time someone's
    // board review is pending, contradicting the "booth is reserved" promise
    // on the post-payment success page.
    //
    // Must include "linked", not just "paid": submitApplication flips the row
    // paid → linked the moment the prospect submits /apply/partner, which is
    // *earlier* than minting (that waits on approval). Matching only "paid"
    // dropped the booth out of this reserved set for the entire review
    // window while entity_balances was still empty, so it fell back to
    // "available" and could be sold a second time on top of a live payment.
    db.from("prospective_booth_payments")
      .select("booth_entity_id, company_name")
      .eq("conference_id", conferenceId)
      .in("status", ["paid", "linked"]),
    db.from("conference_instances").select("floor_plan_url").eq("id", conferenceId).maybeSingle(),
    // instance_of refs so we know which type each booth belongs to.
    db.from("conference_entity_refs").select("from_entity_id, to_entity_id")
      .eq("conference_id", conferenceId)
      .eq("role", "instance_of"),
  ]);
  if (boothsRes.error) return { success: false, error: boothsRes.error.message };

  // Build sold map: entity_id → org identity (first purchaser wins for display).
  type SoldOrgInfo = { id: string; name: string; logoUrl: string | null; category: string | null; type: string };
  const soldOrgByEntity = new Map<string, string>();
  const soldOrgInfoByEntity = new Map<string, SoldOrgInfo>();
  for (const row of salesRes.data ?? []) {
    if (!row.entity_id || soldOrgByEntity.has(row.entity_id)) continue;
    const org = (row as unknown as {
      organizations?: { id?: string; name?: string; logo_url?: string | null; primary_category?: string | null; type?: string };
    }).organizations;
    if (org?.name) {
      soldOrgByEntity.set(row.entity_id, org.name);
      if (org.id) {
        soldOrgInfoByEntity.set(row.entity_id, {
          id: org.id, name: org.name, logoUrl: org.logo_url ?? null, category: org.primary_category ?? null, type: org.type ?? "Vendor Partner",
        });
      }
    }
  }

  // Build reserved map: offer_entity_id → org name + org_id (for "your booth" detection).
  const reservedByEntity = new Map<string, { orgName: string; orgId: string }>();
  for (const row of cartRes.data ?? []) {
    if (!row.offer_entity_id || reservedByEntity.has(row.offer_entity_id)) continue;
    const orgName = (row as unknown as { organizations?: { name?: string } }).organizations?.name;
    if (orgName && row.organization_id) {
      reservedByEntity.set(row.offer_entity_id, { orgName, orgId: row.organization_id });
    }
  }
  // A pending checkout (order created, Stripe not yet confirmed) also reserves
  // the booth — folded into the same "reserved" map so the map doesn't show it
  // as available mid-purchase.
  for (const row of pendingOrderRes.data ?? []) {
    const orgName = (row as unknown as { organizations?: { name?: string } }).organizations?.name;
    const items = (row as unknown as { conference_order_items?: Array<{ offer_entity_id: string | null }> }).conference_order_items ?? [];
    if (!orgName || !row.organization_id) continue;
    for (const item of items) {
      if (item.offer_entity_id && !reservedByEntity.has(item.offer_entity_id)) {
        reservedByEntity.set(item.offer_entity_id, { orgName, orgId: row.organization_id });
      }
    }
  }
  // A paid prospective-booth payment reserves too, until it either mints
  // (moves to the sold map, which takes precedence below) or the prospect's
  // application is never approved and an admin manually frees it back up.
  // No org exists yet, so orgId is "" — never matches a real viewer org, so
  // this never mistakenly reads as "your booth."
  for (const row of prospectRes.data ?? []) {
    if (row.booth_entity_id && row.company_name && !reservedByEntity.has(row.booth_entity_id)) {
      reservedByEntity.set(row.booth_entity_id, { orgName: row.company_name, orgId: "" });
    }
  }

  // Build a map from booth entity id → type entity name via instance_of refs.
  const boothNameById = new Map((boothsRes.data ?? []).map(b => [b.id, b.name]));
  const typeNameByBoothId = new Map<string, string>();
  for (const ref of refsRes.data ?? []) {
    const typeName = boothNameById.get(ref.to_entity_id);
    if (typeName) typeNameByBoothId.set(ref.from_entity_id, typeName);
  }
  // Type entities themselves (booths that other booths point at via instance_of) have
  // no instance_of ref of their own, so typeName would be null. Assign their own name
  // so they sort and group with their instances.
  for (const ref of refsRes.data ?? []) {
    if (boothNameById.has(ref.to_entity_id) && !typeNameByBoothId.has(ref.to_entity_id)) {
      typeNameByBoothId.set(ref.to_entity_id, boothNameById.get(ref.to_entity_id)!);
    }
  }

  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  const booths: FloorPlanBooth[] = (boothsRes.data ?? []).map((b) => {
    const a = (b.attributes ?? {}) as Record<string, unknown>;
    const isSold = soldOrgByEntity.has(b.id);
    const reservedInfo = reservedByEntity.get(b.id);
    const status: FloorPlanBooth["status"] =
      isSold ? "sold" : reservedInfo ? "reserved" : b.is_for_sale ? "available" : "draft";
    const heldByOrg = isSold
      ? (soldOrgByEntity.get(b.id) ?? null)
      : (reservedInfo?.orgName ?? null);
    return { id: b.id, name: b.name, number: str(a.number), size: str(a.size), x: num(a.x), y: num(a.y), w: num(a.w), h: num(a.h), rotation: num(a.rotation), color: str(a.color), isForSale: b.is_for_sale, priceCents: b.price_cents, status, heldByOrg, typeName: typeNameByBoothId.get(b.id) ?? null, pitch: str(a.pitch), soldOrg: isSold ? (soldOrgInfoByEntity.get(b.id) ?? null) : null };
  });
  return { success: true, data: { floorPlanUrl: confRes.data?.floor_plan_url ?? null, booths } };
}

/** The booth things in a conference with their placement, plus the background image. */
export async function getConferenceFloorPlan(conferenceId: string): Promise<Result<ConferenceFloorPlan>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  return _loadFloorPlan(conferenceId);
}

/**
 * Place/move a booth on the floor plan. Geometry is stored as fractions of the
 * background image (x/y/w/h ∈ 0..1) plus rotation in degrees, merged into the
 * booth's attributes — so it stays aligned at any zoom or screen size.
 */
export async function setBoothLayout(
  boothId: string,
  layout: { x: number; y: number; w: number; h: number; rotation?: number; color?: string | null; pitch?: string | null }
): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: booth, error: readErr } = await db
    .from("conference_entities")
    .select("attributes")
    .eq("id", boothId)
    .single();
  if (readErr || !booth) return { success: false, error: readErr?.message ?? "Booth not found." };

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const round = (v: number) => Math.round(v * 100000) / 100000; // 5 dp is plenty for fractions
  const merged: Record<string, unknown> = {
    ...((booth.attributes as Record<string, unknown>) ?? {}),
    x: round(clamp01(layout.x)),
    y: round(clamp01(layout.y)),
    w: round(Math.min(1, Math.max(0.005, layout.w))),
    h: round(Math.min(1, Math.max(0.005, layout.h))),
    rotation: ((Math.round(layout.rotation ?? 0) % 360) + 360) % 360,
  };
  if ("color" in layout) {
    if (layout.color) merged.color = layout.color;
    else delete merged.color;
  }
  if ("pitch" in layout) {
    if (layout.pitch) merged.pitch = layout.pitch;
    else delete merged.pitch;
  }
  const { error } = await db
    .from("conference_entities")
    .update({ attributes: merged as EntityAttributes, updated_at: new Date().toISOString() })
    .eq("id", boothId);
  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}

// ─────────────────────────────────────────────────────────────────
// Badges — a person's badge access is DERIVED from the seats they hold, not a
// stored entitlement_type label. Reachability over the graph (includes /
// involved_in) is what they can get into. Same pure resolver the cockpit uses.
// ─────────────────────────────────────────────────────────────────

/**
 * For an org's conference people, the access each one's badge confers — the
 * things reachable from the seats allocated to them. Keyed by conference_people.id;
 * a person with no seats gets an empty list.
 */
export async function resolveConferenceBadges(
  conferenceId: string,
  organizationId: string
): Promise<Result<Map<string, { id: string; name: string; kind: string }[]>>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, organizationId) && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized for this organization." };
  }

  const db = createAdminClient();
  const [entitiesRes, refsRes, peopleRes] = await Promise.all([
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conferenceId),
    db
      .from("conference_people")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("organization_id", organizationId),
  ]);
  if (entitiesRes.error) return { success: false, error: entitiesRes.error.message };
  if (refsRes.error) return { success: false, error: refsRes.error.message };

  const byId = indexById(buildEntityGraph(entitiesRes.data ?? [], refsRes.data ?? []));
  const personIds = (peopleRes.data ?? []).map((p) => p.id);
  const result = new Map<string, { id: string; name: string; kind: string }[]>();
  if (personIds.length === 0) return { success: true, data: result };

  const { data: seats, error: seatsError } = await db
    .from("entity_balance_seats")
    .select("holder_person_id, entity_id")
    .eq("conference_id", conferenceId)
    .in("holder_person_id", personIds);
  if (seatsError) return { success: false, error: seatsError.message };

  const heldByPerson = new Map<string, string[]>();
  for (const s of seats ?? []) {
    if (!s.holder_person_id) continue;
    const arr = heldByPerson.get(s.holder_person_id) ?? [];
    arr.push(s.entity_id);
    heldByPerson.set(s.holder_person_id, arr);
  }
  for (const pid of personIds) {
    result.set(pid, accessibleThings(heldByPerson.get(pid) ?? [], byId));
  }
  return { success: true, data: result };
}

export async function getBuildWorkspace(conferenceId: string): Promise<Result<BuildWorkspace>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  await Promise.all([seedDayEntities(conferenceId, db), seedAudienceEntities(conferenceId, db)]);

  const [entitiesRes, refsRes, purchasesRes, linkedEventsRes] = await Promise.all([
    db
      .from("conference_entities")
      .select(ENTITY_SELECT)
      .eq("conference_id", conferenceId)
      .order("name"),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conferenceId),
    db
      .from("entity_purchases")
      .select("offer_entity_id, quantity")
      .eq("conference_id", conferenceId),
    db
      .from("events")
      .select("id, slug, title, status, conference_entity_id")
      .not("conference_entity_id", "is", null),
  ]);
  if (entitiesRes.error) return { success: false, error: entitiesRes.error.message };
  if (refsRes.error) return { success: false, error: refsRes.error.message };
  if (purchasesRes.error) return { success: false, error: purchasesRes.error.message };

  const soldByOffer: Record<string, number> = {};
  for (const p of purchasesRes.data ?? []) {
    soldByOffer[p.offer_entity_id] = (soldByOffer[p.offer_entity_id] ?? 0) + p.quantity;
  }

  const entityIds = new Set((entitiesRes.data ?? []).map((e) => e.id));
  const linkedEventByEntityId: Record<string, LinkedEvent> = {};
  for (const ev of linkedEventsRes.data ?? []) {
    if (ev.conference_entity_id && entityIds.has(ev.conference_entity_id)) {
      linkedEventByEntityId[ev.conference_entity_id] = { id: ev.id, slug: ev.slug ?? "", title: ev.title, status: ev.status };
    }
  }

  const entities = buildEntityGraph(entitiesRes.data ?? [], refsRes.data ?? []);
  return { success: true, data: { entities, soldByOffer, linkedEventByEntityId } };
}

// ─────────────────────────────────────────────────────────────────
// Meeting Setup — load and save the Day cadence + Suite count that
// drives loadConferenceMeetingGeometry → scheduler.
// ─────────────────────────────────────────────────────────────────

export type MeetingDaySetup = {
  id: string;
  date: string;
  label: string;
  isMeetingDay: boolean;
  meetingStartTime: string;
  meetingEndTime: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  /** Meal entities on this date that block meeting slots. */
  blockedPeriods: Array<{ name: string; start: string; end: string }>;
};

export type SuiteLocation = {
  suiteId: string;
  suiteName: string;
  /** Name of the location (venue via `where`, or booth via reverse `includes`). */
  locationName: string | null;
  /** How the location was resolved. */
  locationSource: "where" | "booth" | null;
};

export type MeetingSetup = {
  days: MeetingDaySetup[];
  suiteCount: number;
  suiteLocations: SuiteLocation[];
};

/** Load the current meeting configuration from Day + Suite + Meal entities. */
export async function getMeetingSetup(conferenceId: string): Promise<Result<MeetingSetup>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const [daysRes, suitesRes, mealsRes] = await Promise.all([
    db.from("conference_entities").select("id, name, attributes").eq("conference_id", conferenceId).eq("kind", "day").order("attributes->date"),
    db.from("conference_entities").select("id, name, attributes").eq("conference_id", conferenceId).eq("kind", "suite").order("name"),
    db.from("conference_entities").select("name, attributes").eq("conference_id", conferenceId).eq("kind", "meal"),
  ]);
  if (daysRes.error) return { success: false, error: daysRes.error.message };

  // Room/location lookup: two sources in priority order —
  // 1. Explicit `where` ref from the suite (could point to any venue/location entity)
  // 2. Reverse `includes` ref — which booth/entity includes this suite (implicit location)
  const suiteIds = (suitesRes.data ?? []).map(s => s.id);
  const [{ data: whereRefs }, { data: includesRefs }] = suiteIds.length > 0
    ? await Promise.all([
        db.from("conference_entity_refs")
          .select("from_entity_id, target:conference_entities!conference_entity_refs_to_entity_id_fkey(name)")
          .eq("conference_id", conferenceId).eq("role", "where").in("from_entity_id", suiteIds),
        db.from("conference_entity_refs")
          .select("to_entity_id, parent:conference_entities!conference_entity_refs_from_entity_id_fkey(name, kind)")
          .eq("conference_id", conferenceId).eq("role", "includes").in("to_entity_id", suiteIds),
      ])
    : [{ data: [] }, { data: [] }];

  // Build location map — `where` wins over `includes`.
  const locationBySuiteId = new Map<string, { name: string; source: "where" | "booth" }>();
  for (const ref of includesRefs ?? []) {
    const parent = Array.isArray(ref.parent) ? ref.parent[0] : ref.parent;
    if (parent?.name) locationBySuiteId.set(ref.to_entity_id, { name: parent.name, source: "booth" });
  }
  for (const ref of whereRefs ?? []) {
    const target = Array.isArray(ref.target) ? ref.target[0] : ref.target;
    if (target?.name) locationBySuiteId.set(ref.from_entity_id, { name: target.name, source: "where" });
  }

  const suiteLocations: SuiteLocation[] = (suitesRes.data ?? []).map(s => {
    const loc = locationBySuiteId.get(s.id);
    return { suiteId: s.id, suiteName: s.name, locationName: loc?.name ?? null, locationSource: loc?.source ?? null };
  });

  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
  const num = (v: unknown, fallback = 0) => (typeof v === "number" ? v : fallback);

  // Group meal blocked periods by date (meals whose name contains a day keyword).
  // We match meals to days by their `start_time`/`end_time` attributes.
  // Since meals don't carry a date attr, we group by day name heuristic.
  const dayLabels = (daysRes.data ?? []).map(d => ({ id: d.id, date: str((d.attributes as Record<string,unknown>)?.date), label: d.name }));

  // Build blocked periods per day-date by matching meal name keywords.
  const DAY_KEYWORDS: Record<string, string[]> = {
    monday:    ["monday", "mon"],
    tuesday:   ["tuesday", "tue"],
    wednesday: ["wednesday", "wed"],
    thursday:  ["thursday", "thu"],
    friday:    ["friday", "fri"],
  };
  const blockedByDate = new Map<string, Array<{ name: string; start: string; end: string }>>();
  for (const meal of mealsRes.data ?? []) {
    const a = (meal.attributes ?? {}) as Record<string, unknown>;
    const start = str(a.start_time); const end = str(a.end_time);
    if (!start || !end) continue;
    const nameLower = meal.name.toLowerCase();
    for (const dayInfo of dayLabels) {
      const dateObj = new Date(dayInfo.date + "T00:00:00Z");
      const dayName = dateObj.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();
      const keywords = DAY_KEYWORDS[dayName] ?? [];
      if (keywords.some(k => nameLower.includes(k))) {
        const list = blockedByDate.get(dayInfo.date) ?? [];
        list.push({ name: meal.name, start, end });
        blockedByDate.set(dayInfo.date, list);
      }
    }
  }

  const days: MeetingDaySetup[] = (daysRes.data ?? []).map(d => {
    const a = (d.attributes ?? {}) as Record<string, unknown>;
    const date = str(a.date);
    const hasCadence = !!(a.meeting_start_time || a.meeting_end_time);
    return {
      id: d.id,
      date,
      label: d.name,
      isMeetingDay: hasCadence,
      meetingStartTime: str(a.meeting_start_time, "09:00"),
      meetingEndTime: str(a.meeting_end_time, "17:00"),
      slotDurationMinutes: num(a.slot_duration_minutes, 30),
      bufferMinutes: num(a.meeting_buffer_minutes, 5),
      blockedPeriods: (blockedByDate.get(date) ?? []).sort((a, b) => a.start.localeCompare(b.start)),
    };
  });

  return { success: true, data: { days, suiteCount: suitesRes.data?.length ?? 0, suiteLocations } };
}

/** Save meeting cadence for one day (writes to Day entity attributes). */
export async function saveMeetingDayCadence(
  dayEntityId: string,
  cadence: {
    isMeetingDay: boolean;
    meetingStartTime: string;
    meetingEndTime: string;
    slotDurationMinutes: number;
    bufferMinutes: number;
  }
): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: entity, error: readErr } = await db
    .from("conference_entities").select("attributes").eq("id", dayEntityId).single();
  if (readErr || !entity) return { success: false, error: readErr?.message ?? "Day not found." };

  const base = (entity.attributes ?? {}) as Record<string, unknown>;
  let merged: Record<string, unknown>;

  if (!cadence.isMeetingDay) {
    // Strip cadence attrs — day reverts to non-meeting.
    const cadenceKeys = new Set(["meeting_start_time","meeting_end_time","slot_duration_minutes","meeting_buffer_minutes"]);
    merged = Object.fromEntries(Object.entries(base).filter(([k]) => !cadenceKeys.has(k)));
  } else {
    merged = {
      ...base,
      meeting_start_time: cadence.meetingStartTime,
      meeting_end_time: cadence.meetingEndTime,
      slot_duration_minutes: cadence.slotDurationMinutes,
      meeting_buffer_minutes: cadence.bufferMinutes,
    };
  }

  const { error } = await db.from("conference_entities")
    .update({ attributes: merged as EntityAttributes, updated_at: new Date().toISOString() })
    .eq("id", dayEntityId);
  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}

/**
 * Sync Suite entities to the target count: stamp new ones if needed,
 * delete unassigned ones if over (never deletes suites with suite_number set
 * by the user — only auto-numbered ones).
 */
export async function syncSuiteCount(
  conferenceId: string,
  targetCount: number
): Promise<Result<{ suiteCount: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: existing } = await db.from("conference_entities")
    .select("id, attributes").eq("conference_id", conferenceId).eq("kind", "suite");
  const current = existing ?? [];
  const diff = targetCount - current.length;

  if (diff > 0) {
    // Stamp new suites with sequential numbers following existing max.
    const maxNum = current.reduce((m, s) => {
      const n = Number((s.attributes as Record<string,unknown>)?.suite_number ?? 0);
      return Math.max(m, n);
    }, 0);
    for (let i = 1; i <= diff; i++) {
      const num = maxNum + i;
      const { data: inst, error } = await db.from("conference_entities")
        .insert({ conference_id: conferenceId, kind: "suite", name: String(num), attributes: { suite_number: num } })
        .select("id").single();
      if (error || !inst) return { success: false, error: error?.message ?? "Failed to create suite." };
    }
  } else if (diff < 0) {
    // Remove excess suites (those without a user-set suite_number are auto-numbered and safe to remove).
    const toRemove = current
      .filter(s => {
        const attrs = (s.attributes ?? {}) as Record<string, unknown>;
        return typeof attrs.suite_number === "number";
      })
      .sort((a, b) => {
        const na = Number((a.attributes as Record<string,unknown>)?.suite_number ?? 0);
        const nb = Number((b.attributes as Record<string,unknown>)?.suite_number ?? 0);
        return nb - na; // descending — remove highest numbers first
      })
      .slice(0, Math.abs(diff));
    for (const s of toRemove) {
      await db.from("conference_entities").delete().eq("id", s.id);
    }
  }

  const { count } = await db.from("conference_entities")
    .select("*", { count: "exact", head: true })
    .eq("conference_id", conferenceId).eq("kind", "suite");
  return { success: true, data: { suiteCount: count ?? targetCount } };
}
