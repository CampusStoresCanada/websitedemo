import { ENTITY_SELECT, buildEntityGraph } from "@/lib/conference/entity-rows";
import type { BuildEntity } from "@/lib/actions/conference-entities";

/**
 * THE answer to "who has assigned seats, and what type of seats are they?"
 *
 * `entity_balance_seats` is the only place a seat↔person link exists — it is FK
 * enforced to `conference_people`, and `allocateSeat` is the only writer of
 * `holder_person_id`. So the STORE was never in doubt. What was missing was a
 * single READER: before this module, 19 query sites across 12 files each wrote
 * their own select, in eight different shapes, including two different spellings
 * of the same join to reach the entity's kind.
 *
 * ⛔ Do not query `entity_balance_seats` directly. An eslint rule enforces this
 * (same mechanism that keeps `getClaims` behind lib/auth/guards.ts); this file
 * is the single exemption. If this function cannot answer your question, widen
 * it here so every caller gets the fix — do not open a twentieth query.
 */

/** The column list every seat read selects — kept beside the row type, as ENTITY_SELECT is. */
export const SEAT_SELECT =
  "id, conference_id, organization_id, entity_id, seat_index, holder_person_id";

export type SeatHolding = {
  seatId: string;
  conferenceId: string;
  organizationId: string;
  seatIndex: number | null;
  /** The catalogue thing this seat is for. */
  entityId: string;
  entityKind: string;
  entityName: string;
  /** Who is named to it. Null means the seat is sold but unassigned. */
  holderPersonId: string | null;
  /**
   * The holder's display name and login, resolved from conference_people.
   *
   * Widened in when the meeting system came off conference_registrations: three
   * separate places were each re-joining seat → person to put a name on a
   * meeting, which is how you get nineteen query shapes. Null when the seat is
   * unassigned, or when the person row is missing.
   */
  holderName: string | null;
  holderUserId: string | null;
};

export type SeatQuery = {
  conferenceId: string;
  /** Only this org's seats. */
  organizationId?: string;
  /** Only seats held by this person. */
  holderPersonId?: string;
  /** Only these catalogue kinds, e.g. ["registration"]. */
  entityKinds?: string[];
  /** Only seats nobody is named to, or only seats somebody is. */
  assigned?: boolean;
};

// The shape of the client this needs. Kept structural rather than importing a
// Supabase type so callers can pass an admin client or a scoped one.
type SeatDb = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (columns: string) => any;
  };
};

/**
 * Load seat holdings, resolved against the catalogue.
 *
 * Returns one row per seat — assigned or not — with its entity kind and name
 * already joined, because "what type of seat is it" is half the question and
 * every caller was answering it separately. The catalogue graph comes back too:
 * it had to be built to answer the question, and callers that go on to walk it
 * (access, obligations, what a type includes) would otherwise re-query for
 * something already in hand.
 *
 * Throws on a read failure. A seat list that cannot load is not an empty one,
 * and an empty one means "nobody is coming", which is a very expensive thing to
 * report by accident.
 */
export async function loadSeatHoldings(
  db: SeatDb,
  query: SeatQuery
): Promise<{ seats: SeatHolding[]; entitiesById: Map<string, BuildEntity> }> {
  let seatQuery = db.from("entity_balance_seats").select(SEAT_SELECT).eq("conference_id", query.conferenceId);
  if (query.organizationId) seatQuery = seatQuery.eq("organization_id", query.organizationId);
  if (query.holderPersonId) seatQuery = seatQuery.eq("holder_person_id", query.holderPersonId);
  if (query.assigned === true) seatQuery = seatQuery.not("holder_person_id", "is", null);
  if (query.assigned === false) seatQuery = seatQuery.is("holder_person_id", null);

  const [seatRes, entityRes, refRes] = await Promise.all([
    seatQuery,
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", query.conferenceId),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", query.conferenceId),
  ]);

  if (seatRes.error) throw new Error(`Could not load conference seats: ${seatRes.error.message}`);
  if (entityRes.error) throw new Error(`Could not load the conference catalog: ${entityRes.error.message}`);
  if (refRes.error) throw new Error(`Could not load the conference catalog: ${refRes.error.message}`);

  const byId = new Map<string, BuildEntity>(
    buildEntityGraph(entityRes.data ?? [], refRes.data ?? []).map((e) => [e.id, e])
  );

  const kinds = query.entityKinds ? new Set(query.entityKinds) : null;
  const out: SeatHolding[] = [];
  const orphaned: string[] = [];
  for (const row of (seatRes.data ?? []) as Array<Record<string, unknown>>) {
    const entityId = typeof row.entity_id === "string" ? row.entity_id : null;
    const seatId = typeof row.id === "string" ? row.id : null;
    if (!entityId || !seatId) continue;
    const entity = byId.get(entityId);
    // A seat pointing at an entity this conference does not have is a PAID seat
    // we cannot describe. Silently dropping it removes somebody's registration
    // from the run with no trace — the same failure mode as reporting an
    // unreadable roster as an empty one, which this module exists to prevent.
    if (!entity) {
      orphaned.push(seatId);
      continue;
    }
    if (kinds && !kinds.has(entity.kind)) continue;
    out.push({
      seatId,
      conferenceId: query.conferenceId,
      organizationId: typeof row.organization_id === "string" ? row.organization_id : "",
      seatIndex: typeof row.seat_index === "number" ? row.seat_index : null,
      entityId,
      entityKind: entity.kind,
      entityName: entity.name,
      holderPersonId: typeof row.holder_person_id === "string" ? row.holder_person_id : null,
      holderName: null,
      holderUserId: null,
    });
  }
  if (orphaned.length > 0) {
    throw new Error(
      `${orphaned.length} seat(s) reference an entity that is not in this conference's catalogue ` +
        `(first: ${orphaned[0]}). These are paid seats and must not be dropped silently.`
    );
  }
  /**
   * Resolve holder names in one pass. Callers that put a person's name against a
   * meeting, a badge or a roster all needed this join; doing it here is the
   * difference between one query shape and the nineteen this module replaced.
   */
  const holderIds = [...new Set(out.map((r) => r.holderPersonId).filter((id): id is string => !!id))];
  if (holderIds.length > 0) {
    const peopleRes = await db
      .from("conference_people")
      .select("id, display_name, user_id")
      .in("id", holderIds);
    if (peopleRes.error) {
      throw new Error(`Could not load seat holders: ${peopleRes.error.message}`);
    }
    const byPersonId = new Map(
      ((peopleRes.data ?? []) as Array<Record<string, unknown>>).map((r) => [
        r.id as string,
        {
          name: typeof r.display_name === "string" ? r.display_name : null,
          userId: typeof r.user_id === "string" ? r.user_id : null,
        },
      ])
    );
    for (const seat of out) {
      if (!seat.holderPersonId) continue;
      const person = byPersonId.get(seat.holderPersonId);
      if (!person) continue;
      seat.holderName = person.name;
      seat.holderUserId = person.userId;
    }
  }

  return { seats: out, entitiesById: byId };
}

/** The catalogue graph, for callers that also need to walk it (access, obligations). */
export { buildEntityGraph, ENTITY_SELECT };
