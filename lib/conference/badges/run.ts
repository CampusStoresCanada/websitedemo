import { createAdminClient } from "@/lib/supabase/admin";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { getBadgeScanRules } from "@/lib/conference/badges/rules";
import {
  summarizeAccess,
  summarizeAgenda,
  type AccessSummary,
  type AgendaItem,
} from "@/lib/conference/entity-commerce";

/**
 * A badge run, in the shape the rest of the site already speaks.
 *
 * Catalogue → transaction → seat → person. You author a registration type in
 * the Build tab; an org buys it; that mints seats; the org names people to those
 * seats. A badge run walks that chain forwards.
 *
 * ⛔ It used to walk BACKWARDS — start from `conference_people`, then
 * reconstruct which type each person "is". Every extra concept in this pipeline
 * came from that reconstruction: `BadgeRole`, `person_kind`, `deriveRegistrationTier`,
 * `tierLabel`, name-matching on "exhibitor". Starting from the type deletes the
 * question instead of answering it — the type is the loop variable, so nobody is
 * ever asked what kind of person they are.
 *
 * Consequences worth naming, because they are why this shape is right:
 *   - A blank is not a mode. It is a seat with no holder.
 *   - The layout variant is not derived. It IS the type you are iterating.
 *   - A conference with one ticket type produces one batch; a home show with
 *     Vendor / Public / VIP produces three. No code knows those words.
 */

export type BadgeRunPerson = {
  personId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  roleTitle: string;
  contactEmail: string | null;
  /** False when nothing links this person to a contact record — blocking for a
   *  print run, because a badge with no identity behind it is a guess. */
  hasIdentityLink: boolean;
};

export type BadgeRunSeat = {
  seatId: string;
  organizationId: string;
  organizationName: string;
  /** Place comes from the organization record — badges can bind it. */
  organizationCity: string;
  organizationProvince: string;
  /** When this seat was allocated. A sort key for the print file. */
  seatedAt: string | null;
  /** null when nobody has been named to this seat yet — print a blank. */
  person: BadgeRunPerson | null;
};

export type BadgeRunType = {
  /** The registration entity. Also the layout variant key — see resolveBadgeVariant. */
  entityId: string;
  /** The type's own name from the catalogue. Not parsed, not translated. */
  name: string;
  /** What this type grants — days, meals, events — via the shared graph walk. */
  accessSummary: AccessSummary;
  /** The same entitlement as a timed, day-ordered list — what the badge back prints. */
  agenda: AgendaItem[];
  seats: BadgeRunSeat[];
};

export type BadgeRun = {
  types: BadgeRunType[];
  /**
   * The street address this conference is held at, derived from its `venue`
   * entities. Rooms each carry their own address string; the one shared by the
   * most rooms is the building. Null when no venue carries an address.
   */
  venueAddress: string | null;
  /**
   * What each PERSON is admitted to, resolved over every entity they hold a
   * seat on — not just their registration type. Event seats are sold
   * separately, so a type-level summary under-reports the add-on holder.
   * An array rather than a Map so it survives serialization to a client.
   */
  entitlements: Array<{
    personId: string;
    access: AccessSummary;
    agenda: AgendaItem[];
  }>;
  /**
   * People named to seats of more than one registration type. One person gets
   * one badge, so which type's layout wins is a human decision, not something
   * to resolve silently by picking the first.
   */
  peopleInMultipleTypes: Array<{ personId: string; displayName: string; typeNames: string[] }>;
};

function compact(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function splitDisplayName(display: string): { firstName: string; lastName: string } {
  if (!display) return { firstName: "", lastName: "" };
  const parts = display.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/**
 * Resolve every badge this conference needs, grouped by registration type.
 *
 * Throws rather than returning empty on a read failure — an unreadable run is
 * not an empty one, and reporting "0 badges, success" is the bug this pipeline
 * shipped with.
 */
export async function resolveBadgeRun(conferenceId: string): Promise<BadgeRun> {
  const db = createAdminClient();

  // Seats come from the canonical reader — see lib/conference/seats.ts. This
  // file is not exempt from the lint rule, which is the point: there is one
  // shape for "who holds which seat of what type", and this asks for it.
  const [holdings, peopleRes] = await Promise.all([
    loadSeatHoldings(db, { conferenceId }),
    db
      .from("conference_people")
      .select(
        "id, canonical_person_id, contact_id, display_name, role_title, contact_email, assigned_email_snapshot"
      )
      .eq("conference_id", conferenceId)
      .neq("assignment_status", "canceled"),
  ]);

  if (peopleRes.error) throw new Error(`Could not load the conference roster: ${peopleRes.error.message}`);

  const byId = holdings.entitiesById;
  const registrationTypes = [...byId.values()].filter((e) => e.kind === "registration");
  const peopleRows = (peopleRes.data ?? []) as Array<Record<string, unknown>>;
  const seats = holdings.seats;

  // Identity and place come from the records that own them.
  // ⛔ `contact_id` FIRST. Both columns point at `contacts`, but only
  // `contact_id` has a foreign key — `canonical_person_id` has none, and on CSC
  // 2027 one row already points at a contact that does not exist. Reading the
  // unenforced column meant the badge resolved no identity for a real person and
  // silently fell back to splitting their display name.
  const identityIdOf = (p: Record<string, unknown>): string | null =>
    (typeof p.contact_id === "string" && p.contact_id) ||
    (typeof p.canonical_person_id === "string" && p.canonical_person_id) ||
    null;

  const canonicalIds = [
    ...new Set(peopleRows.map(identityIdOf).filter((v): v is string => Boolean(v))),
  ];
  const orgIds = [...new Set(seats.map((s) => s.organizationId).filter(Boolean))];

  const [contactsRes, orgsRes] = await Promise.all([
    canonicalIds.length
      ? db.from("contacts").select("id, first_name, last_name, role_title").in("id", canonicalIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? db.from("organizations").select("id, name, city, province").in("id", orgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (contactsRes.error) throw new Error(`Could not load badge identities: ${contactsRes.error.message}`);
  if (orgsRes.error) throw new Error(`Could not load badge organizations: ${orgsRes.error.message}`);

  const contactById = new Map(
    ((contactsRes.data ?? []) as Array<Record<string, unknown>>).map((c) => [c.id as string, c])
  );
  const orgById = new Map(
    ((orgsRes.data ?? []) as Array<Record<string, unknown>>).map((o) => [o.id as string, o])
  );

  const personById = new Map<string, BadgeRunPerson>();
  for (const row of peopleRows) {
    const personId = typeof row.id === "string" ? row.id : null;
    if (!personId) continue;
    const identityId = identityIdOf(row);
    const canonical = identityId ? contactById.get(identityId) ?? null : null;
    const displayName = compact(row.display_name);
    const fallback = splitDisplayName(displayName);
    personById.set(personId, {
      personId,
      displayName,
      firstName: compact(canonical?.first_name) || fallback.firstName,
      lastName: compact(canonical?.last_name) || fallback.lastName,
      roleTitle: compact(canonical?.role_title) || compact(row.role_title),
      contactEmail: compact(row.contact_email) || compact(row.assigned_email_snapshot) || null,
      hasIdentityLink: Boolean(canonical),
    });
  }

  const seatsByEntity = new Map<string, BadgeRunSeat[]>();
  const typeNamesByPerson = new Map<string, Set<string>>();
  for (const seat of seats) {
    // A badge is only ever for a registration seat. Meals and sessions are
    // things a registration includes, not things you wear.
    if (seat.entityKind !== "registration") continue;
    const { seatId, entityId, organizationId } = seat;

    const person = seat.holderPersonId ? personById.get(seat.holderPersonId) ?? null : null;
    if (person) {
      const names = typeNamesByPerson.get(person.personId) ?? new Set<string>();
      names.add(seat.entityName);
      typeNamesByPerson.set(person.personId, names);
    }

    const list = seatsByEntity.get(entityId) ?? [];
    list.push({
      seatId,
      organizationId,
      organizationName: compact(orgById.get(organizationId)?.name) || "—",
      organizationCity: compact(orgById.get(organizationId)?.city),
      organizationProvince: compact(orgById.get(organizationId)?.province),
      seatedAt: seat.seatedAt,
      person,
    });
    seatsByEntity.set(entityId, list);
  }

  // Which days print is the conference's decision, not a heuristic's. The
  // heuristic remains the DEFAULT ("derive"), not the only answer.
  const scanPolicy = await getBadgeScanRules(conferenceId);
  // Badges are collected on site, so pre- and post-conference items are
  // excluded. ⛔ The SAME filter the per-person entitlements below use. It was
  // applied only there, so the two agendas on one BadgeRun disagreed: a named
  // holder's back started at the first on-site day while anything falling back
  // to the type's agenda printed a pre-conference online Q&A the badge could not
  // possibly be used at. Blanks take the type's agenda by definition — nobody
  // holds the seat — so that disagreement printed on 152 cards.
  // ⛔ A BADGE PRINTS BLOCKS, NEVER ASSIGNMENTS — and that is what makes it safe
  // to print in January.
  //
  // summarizeAgenda walks the CATALOGUE: days, meals, sessions, events and
  // meeting BLOCKS. It renders "9:30 Meeting Block 1 · Mississauga Ballroom
  // A&D", never "9:30 you are meeting Boxercraft". Who somebody meets lives in
  // `schedules`, is re-runnable, and is deliberately not catalogue data.
  //
  // ⚠️ That is load-bearing. A post-freeze late add can give an ALREADY-SEATED
  // delegate a meeting they did not have — group minimum is 2, so a lone
  // latecomer has to be paired with somebody free, and the scheduler returns
  // those people in `alsoGained`. Their blocks were already on their badge, so
  // the card stays true. The day anything renders per-person meeting
  // assignments onto a printed artefact, that stops being true and a late add
  // silently invalidates a card nobody is going to reprint.
  //
  const onsiteAgendaOptions = {
    onsiteOnly: true,
    onsiteDayPolicy: {
      explicitDayIds: scanPolicy.onsiteDayIds,
      unlistedMode: scanPolicy.unlistedDayMode,
    },
  } as const;

  const types: BadgeRunType[] = registrationTypes
    .map((entity) => ({
      entityId: entity.id,
      name: entity.name,
      accessSummary: summarizeAccess(entity.id, byId),
      agenda: summarizeAgenda(entity.id, byId, onsiteAgendaOptions),
      seats: (seatsByEntity.get(entity.id) ?? []).sort(
        (a, b) =>
          a.organizationName.localeCompare(b.organizationName) ||
          (a.person?.lastName ?? "").localeCompare(b.person?.lastName ?? "") ||
          a.seatId.localeCompare(b.seatId)
      ),
    }))
    .sort((a, b) => b.seats.length - a.seats.length || a.name.localeCompare(b.name));

  const peopleInMultipleTypes = [...typeNamesByPerson.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([personId, names]) => ({
      personId,
      displayName: personById.get(personId)?.displayName ?? personId,
      typeNames: [...names].sort(),
    }));

  // Rooms each carry the building's address; the string shared by the most
  // rooms is the building. Ties resolve alphabetically so the value is stable
  // across runs rather than depending on catalogue insertion order.
  const addressCounts = new Map<string, number>();
  for (const entity of byId.values()) {
    if (entity.kind !== "venue") continue;
    const address = entity.attributes.address;
    if (typeof address !== "string" || !address.trim()) continue;
    const key = address.trim();
    addressCounts.set(key, (addressCounts.get(key) ?? 0) + 1);
  }
  const venueAddress =
    [...addressCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0]?.[0] ?? null;

  const heldByPerson = new Map<string, string[]>();
  for (const seat of seats) {
    if (!seat.holderPersonId) continue;
    const list = heldByPerson.get(seat.holderPersonId) ?? [];
    if (!list.includes(seat.entityId)) list.push(seat.entityId);
    heldByPerson.set(seat.holderPersonId, list);
  }
  const entitlements = [...heldByPerson.entries()].map(([personId, heldIds]) => ({
    personId,
    access: summarizeAccess(heldIds, byId),
    agenda: summarizeAgenda(heldIds, byId, onsiteAgendaOptions),
  }));

  return { types, peopleInMultipleTypes, venueAddress, entitlements };
}

/**
 * The single registration type a person's badge is for.
 *
 * A person has one face, so they get one badge even when they hold seats on
 * several types. Which type wins was previously decided three different ways —
 * the admin page counted per seat, the PDF took whichever seat it iterated last,
 * and `/me` used an unordered `.find()`. Three answers, so the count, the print
 * and the preview could all disagree about the same person.
 *
 * The rule: the first type in run order (most seats sold, then name). It is
 * deterministic, and it is only ever reached for people preflight has already
 * flagged — see `peopleInMultipleTypes`, which blocks the print run so a human
 * decides rather than the tie-break deciding silently.
 */
export function badgeTypeForPerson(run: BadgeRun, personId: string): BadgeRunType | null {
  return (
    run.types.find((type) => type.seats.some((seat) => seat.person?.personId === personId)) ?? null
  );
}

/** Every seat with somebody named to it — one badge each. */
export function namedSeats(run: BadgeRun): Array<{ type: BadgeRunType; seat: BadgeRunSeat }> {
  return run.types.flatMap((type) =>
    type.seats.filter((s) => s.person).map((seat) => ({ type, seat }))
  );
}

/** Every seat nobody has been named to — a blank, if the desk wants blanks. */
export function unnamedSeats(run: BadgeRun): Array<{ type: BadgeRunType; seat: BadgeRunSeat }> {
  return run.types.flatMap((type) =>
    type.seats.filter((s) => !s.person).map((seat) => ({ type, seat }))
  );
}
