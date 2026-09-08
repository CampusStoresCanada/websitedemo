import type { BuildEntity, ConferenceOffer, NonMemberDayPass } from "../actions/conference-entities";
import { effectiveIncludes, effectiveRefs } from "./entity-graph";
import { ACCESS_ROLES } from "./inclusion";

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
      if ((ACCESS_ROLES as readonly string[]).includes(r.role) && !access.has(r.toEntityId)) {
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
export function summarizeAccess(
  entityIds: string | string[],
  byId: Map<string, BuildEntity>
): AccessSummary {
  // A person's entitlement is everything they HOLD, not just their ticket type:
  // event seats are sold separately, so summarising the registration alone
  // under-reports what the badge actually admits them to.
  const held = Array.isArray(entityIds) ? entityIds : [entityIds];
  const things = accessibleThings(held, byId);
  const byDate = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => whenDate(a.id, byId).localeCompare(whenDate(b.id, byId)));

  // Several session entities can share the meeting day (Get Organized,
  // Meeting Block 1-5, Move-in - Tuesday, ...) — meetingSession is just
  // whichever one represents that day's name in the summary line, so
  // tradeShowDays must exclude every session on that day, not only the one
  // object meetingSession happens to point at (that left sibling meeting
  // blocks in tradeShowDays, leaking raw scheduler entities like "Meeting
  // Block 1" into the public "what's included" bullet list).
  const sessions = byDate(things.filter((t) => t.kind === "session"));
  const meetingSession = sessions.find((s) => isMeetingDay(s.id, byId));
  const tradeShowSessions = sessions.filter((s) => !isMeetingDay(s.id, byId));

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

/** The room a thing happens in, via its `where` ref. "TBD" is not a location. */
function whereVenueName(
  entityId: string,
  byId: Map<string, BuildEntity>
): string | null {
  const entity = byId.get(entityId);
  if (!entity) return null;
  const ref = effectiveRefs(entity, byId).find((r) => r.role === "where");
  const venue = ref ? byId.get(ref.toEntityId) : undefined;
  const name = venue?.name?.trim();
  if (!name || /^tbd$/i.test(name)) return null;
  return name;
}

/**
 * Item names repeat the day they sit under — "Breakfast - Wednesday" beneath a
 * "Wed, Feb 3" heading. On a 3x5in card that echo costs width that a room name
 * needs. Trimmed by comparing against the RESOLVED DAY's own name, so it works
 * for any naming convention rather than matching a hardcoded weekday list.
 */
function trimDayEcho(name: string, dayName: string): string {
  const dayKey = dayName.trim().slice(0, 3).toLowerCase();
  if (dayKey.length < 3) return name;
  const trimmed = name.replace(/\s*[-–—]\s*([A-Za-z]+)\s*$/, (whole, token: string) =>
    token.slice(0, 3).toLowerCase() === dayKey ? "" : whole
  );
  if (trimmed !== name) return trimmed.trim();
  // Also handles "Trade Show Thursday", where no separator precedes the echo.
  const words = name.trim().split(/\s+/);
  if (words.length > 1 && words[words.length - 1].slice(0, 3).toLowerCase() === dayKey) {
    return words.slice(0, -1).join(" ");
  }
  return name;
}

/**
 * The day ids that make up the conference proper.
 *
 * Catalogues carry pre- and post-conference days too — CSC 2027 has a January 7
 * webinar sitting 25 days before the February body. A printed badge is an ONSITE
 * artifact, so it should not advertise something that happened a month before it
 * was collected. Derived as the largest run of days no more than one day apart,
 * so it holds for any conference without hardcoding dates.
 */
export type OnsiteDayPolicy = {
  /** Days an admin has explicitly chosen to print. */
  explicitDayIds?: string[];
  /** What happens to a day they have not chosen. */
  unlistedMode?: "derive" | "include" | "exclude";
};

export function onsiteDayIds(
  byId: Map<string, BuildEntity>,
  policy: OnsiteDayPolicy = {}
): Set<string> {
  const allDayIds = [...byId.values()].filter((e) => e.kind === "day").map((e) => e.id);
  const explicit = new Set((policy.explicitDayIds ?? []).filter((id) => byId.has(id)));
  const mode = policy.unlistedMode ?? "derive";

  // An admin who has listed days has answered the question; the mode only says
  // what to do with the ones they did NOT list.
  if (mode === "include") return new Set(allDayIds);
  if (mode === "exclude") return explicit;
  // "derive" — fall through to the heuristic below, then union with anything
  // explicitly chosen, so a deliberate pick is never overruled by a guess.
  return new Set([...explicit, ...deriveOnsiteDayIds(byId)]);
}

/** The heuristic: the main run of consecutive conference days. */
function deriveOnsiteDayIds(byId: Map<string, BuildEntity>): Set<string> {
  const days = [...byId.values()]
    .filter((e) => e.kind === "day" && typeof e.attributes.date === "string")
    .map((e) => ({ id: e.id, date: String(e.attributes.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return new Set();

  const runs: Array<Array<{ id: string; date: string }>> = [[days[0]]];
  for (let i = 1; i < days.length; i += 1) {
    const previous = Date.parse(`${days[i - 1].date}T00:00:00Z`);
    const current = Date.parse(`${days[i].date}T00:00:00Z`);
    const gapDays = (current - previous) / 86_400_000;
    if (Number.isFinite(gapDays) && gapDays <= 1) runs[runs.length - 1].push(days[i]);
    else runs.push([days[i]]);
  }
  const best = runs.reduce((a, b) => (b.length > a.length ? b : a));
  return new Set(best.map((d) => d.id));
}

export type AgendaItem = {
  id: string;
  /** Display name with the day echo trimmed — "Breakfast", not "Breakfast - Wednesday". */
  name: string;
  kind: string;
  /** Room from the `where` ref. Null when unset or still "TBD". */
  venueName: string | null;
  /** Name of the day this resolves onto, or "" when untimed. */
  dayName: string;
  /** `YYYY-MM-DD`, or "" when untimed. Primary sort key. */
  date: string;
  /** `HH:MM` as authored on the entity, or null when it carries no time. */
  startTime: string | null;
  endTime: string | null;
};

/**
 * The timed agenda that holding one thing grants — every session, meal and
 * event it reaches, resolved onto its day and ordered.
 *
 * `summarizeAccess` answers "what does this include" for a storefront card, so
 * it collapses to names and a meals boolean. A printed badge back needs the
 * opposite projection: each item, on its day, at its time. Same traversal, so
 * it lives here beside `summarizeAccess` — a private copy in the badge module
 * would eventually disagree with the storefront about what a pass covers.
 */
export function summarizeAgenda(
  entityIds: string | string[],
  byId: Map<string, BuildEntity>,
  options: { onsiteOnly?: boolean; onsiteDayPolicy?: OnsiteDayPolicy } = {}
): AgendaItem[] {
  // `meeting` earns its place: the meeting-day blocks are what tell someone to
  // be somewhere at 9:30. WHO they are meeting is not catalogue data — it lives
  // in `schedules`, is re-runnable, and is far too long for a card.
  const TIMED = new Set(["session", "meal", "event", "meeting"]);
  const held = Array.isArray(entityIds) ? entityIds : [entityIds];
  const onsite = options.onsiteOnly ? onsiteDayIds(byId, options.onsiteDayPolicy) : null;
  return accessibleThings(held, byId)
    .filter((t) => TIMED.has(t.kind))
    // Admin override: anything explicitly flagged off is kept off the badge,
    // whatever its kind. The card is small and what belongs on it is a
    // judgement call, so the catalogue owner gets to make it per entity.
    .filter((t) => {
      // Attribute values arrive untyped from JSON, so accept the literal false
      // and the string "false" a form would submit.
      const flag: unknown = byId.get(t.id)?.attributes.show_on_badge;
      return !(flag === false || flag === "false");
    })
    .map((t) => {
      const entity = byId.get(t.id);
      const start = entity?.attributes.start_time;
      const end = entity?.attributes.end_time;
      const day = resolvedDay(t.id, byId);
      const dayName = day?.name ?? "";
      return {
        id: t.id,
        name: trimDayEcho(t.name, dayName),
        kind: t.kind,
        venueName: whereVenueName(t.id, byId),
        dayName,
        dayId: day?.id ?? null,
        date: whenDate(t.id, byId),
        startTime: typeof start === "string" && start.trim() ? start.trim() : null,
        endTime: typeof end === "string" && end.trim() ? end.trim() : null,
      };
    })
    .filter((item) => !onsite || (item.dayId !== null && onsite.has(item.dayId)))
    // dayId exists only to test the onsite filter above; it is not part of the
    // printed shape, so it is dropped explicitly rather than spread away.
    .map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      venueName: item.venueName,
      dayName: item.dayName,
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
    }))
    // Untimed items sort last rather than silently leading the list.
    .sort(
      (a, b) =>
        (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99") ||
        (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99") ||
        a.name.localeCompare(b.name)
    );
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
