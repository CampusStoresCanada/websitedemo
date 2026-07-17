import type { BuildEntity, ConferenceOffer, NonMemberDayPass } from "../actions/conference-entities";
import { effectiveIncludes, effectiveRefs } from "./entity-graph";

/**
 * Pure sell/fulfill logic for the v3 catalog — what a purchase grants, and what
 * a holder can get into. No I/O: the cockpit preview, and the unit tests share
 * this with the DB-side RPCs (mint_entity_offer_purchase / resolve_holder_access),
 * which are the authoritative persisted path. Access + money ride on the
 * reference graph (includes / involved_in), never on the kind label.
 */

export type Grant = { entityId: string; name: string; kind: string; quantity: number };

/**
 * What buying `quantity` of an Offer grants: the offer itself plus everything it
 * `includes`, recursively, with quantity multiplying down each edge and summing
 * across paths (4 booths × 1 table = 4 tables; a diamond is counted once per
 * path). Uses effective includes, so an instance grants what its type bundles.
 * Mirrors the mint RPC (which expands own `includes`); this preview additionally
 * follows instance inheritance.
 */
export function expandOffer(
  offerId: string,
  byId: Map<string, BuildEntity>,
  quantity = 1
): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (id: string, qty: number, ancestors: Set<string>) => {
    out.set(id, (out.get(id) ?? 0) + qty);
    const entity = byId.get(id);
    if (!entity) return;
    const next = new Set(ancestors).add(id);
    for (const inc of effectiveIncludes(entity, byId)) {
      if (next.has(inc.toEntityId)) continue; // cycle guard (defensive)
      walk(inc.toEntityId, qty * (inc.quantity ?? 1), next);
    }
  };
  walk(offerId, Math.max(1, quantity), new Set());
  return out;
}

/** As {@link expandOffer} but resolved to named grants, with the offer itself dropped. */
export function offerGrants(offerId: string, byId: Map<string, BuildEntity>, quantity = 1): Grant[] {
  const grants: Grant[] = [];
  for (const [entityId, qty] of expandOffer(offerId, byId, quantity)) {
    if (entityId === offerId) continue;
    const e = byId.get(entityId);
    if (e) grants.push({ entityId, name: e.name, kind: e.kind, quantity: qty });
  }
  return grants.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What a set of held things lets you into: everything reachable from them via
 * `includes` and `involved_in`. This is the bundling rule, generalized — hold an
 * Exhibitor Registration that is involved_in the Trade Show and you can attend
 * it, no special case. Returns the reachable entity ids (held ids included).
 */
export function resolveAccess(heldIds: Iterable<string>, byId: Map<string, BuildEntity>): Set<string> {
  const access = new Set<string>();
  const queue: string[] = [];
  for (const id of heldIds) {
    if (!access.has(id)) {
      access.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const entity = byId.get(id);
    if (!entity) continue;
    for (const r of effectiveRefs(entity, byId)) {
      if ((r.role === "includes" || r.role === "involved_in") && !access.has(r.toEntityId)) {
        access.add(r.toEntityId);
        queue.push(r.toEntityId);
      }
    }
  }
  return access;
}

/** Access resolved to named things the holder can get into (held things dropped). */
export function accessibleThings(heldIds: string[], byId: Map<string, BuildEntity>): Array<{ id: string; name: string; kind: string }> {
  const held = new Set(heldIds);
  const out: Array<{ id: string; name: string; kind: string }> = [];
  for (const id of resolveAccess(heldIds, byId)) {
    if (held.has(id)) continue;
    const e = byId.get(id);
    if (e) out.push({ id, name: e.name, kind: e.kind });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** An entity's resolved Day, or undefined if untimed — itself if it IS a day, else its `when` day. */
function resolvedDay(entityId: string, byId: Map<string, BuildEntity>): BuildEntity | undefined {
  const entity = byId.get(entityId);
  if (!entity) return undefined;
  if (typeof entity.attributes.date === "string") return entity;
  const whenRef = effectiveRefs(entity, byId).find((r) => r.role === "when");
  return whenRef ? byId.get(whenRef.toEntityId) : undefined;
}

/** An entity's resolved day date, `YYYY-MM-DD`, or "" if untimed. */
function whenDate(entityId: string, byId: Map<string, BuildEntity>): string {
  const date = resolvedDay(entityId, byId)?.attributes.date;
  return typeof date === "string" ? date : "";
}

/** A Day carries meeting cadence (`meeting_start_time`) exactly when it's configured as a scheduler meeting day — same signal schedule-service.ts uses to find meeting days. */
function isMeetingDay(entityId: string, byId: Map<string, BuildEntity>): boolean {
  const day = resolvedDay(entityId, byId);
  const start = day?.attributes.meeting_start_time;
  return typeof start === "string" && start.trim().length > 0;
}

export type AccessSummary = {
  /** Day names this grants, chronological (e.g. ["Tue, Feb 2"] or all three trade-show days). */
  days: string[];
  /** Whether any meal is included — a persuasive card says "all meals," not each one by name. */
  mealsIncluded: boolean;
  /** Name of the curated-meetings session (Tuesday), if reachable — kept distinct from open trade-show floor days, not folded into one generic "trade show" bullet. */
  meetingDay: string | null;
  /** Trade-show/floor sessions on non-meeting days, chronological — id kept so display can single out a specific day (e.g. Wednesday's exhibitor count) without matching on name text. */
  tradeShowDays: Array<{ id: string; name: string }>;
  /** Off-agenda events (receptions, offsite nights) this grants, chronological. */
  events: string[];
  /** Total for-sale booths this conference — "all N exhibitors" on the trade-show floor. */
  exhibitorCount: number;
};

/**
 * A human-facing summary of what holding one thing (e.g. a registration)
 * gets you — the persuasive counterpart to {@link offerGrants}, which lists
 * every bundled item individually. Built from the same access graph
 * ({@link accessibleThings}) so it can't drift from what's actually granted.
 */
export function summarizeAccess(entityId: string, byId: Map<string, BuildEntity>): AccessSummary {
  const things = accessibleThings([entityId], byId);
  const byDate = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => whenDate(a.id, byId).localeCompare(whenDate(b.id, byId)));

  const sessions = byDate(things.filter((t) => t.kind === "session"));
  const meetingSession = sessions.find((s) => isMeetingDay(s.id, byId));
  const tradeShowSessions = sessions.filter((s) => s !== meetingSession);

  const exhibitorCount = [...byId.values()].filter((e) => e.kind === "booth" && e.isForSale).length;

  return {
    days: byDate(things.filter((t) => t.kind === "day")).map((t) => t.name),
    mealsIncluded: things.some((t) => t.kind === "meal"),
    meetingDay: meetingSession?.name ?? null,
    tradeShowDays: tradeShowSessions.map((t) => ({ id: t.id, name: t.name })),
    events: byDate(things.filter((t) => t.kind === "event")).map((t) => t.name),
    exhibitorCount,
  };
}

/**
 * Adapts a NonMemberDayPass into the ConferenceOffer shape DayPassOfferCard
 * already expects — the same card Members/Partners see. There's no
 * inventory/eligibility concept modeled for these (every pass returned by
 * getNonMemberDayPasses is already eligible by construction), so those
 * fields are just sensible constants, not a second parallel computation.
 */
export function nonMemberDayPassToOffer(pass: NonMemberDayPass): ConferenceOffer {
  return {
    id: pass.id,
    name: pass.name,
    kind: "registration",
    unitPriceCents: pass.priceCents,
    eligible: true,
    ineligibleReason: null,
    remaining: null,
    soldOut: false,
    includes: [],
    accessSummary: pass.accessSummary,
  };
}
