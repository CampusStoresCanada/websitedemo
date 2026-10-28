/**
 * What the check-in desk needs to know about the person it just scanned.
 *
 * ⛔ Derived from `resolveBadgeRun` — the SAME catalogue → seats → holder walk
 * the badge itself is printed from. The desk previously labelled people with
 * `conference_people.person_kind`, a three-value legacy vocabulary (delegate /
 * staff / exhibitor) that the v3 badge pipeline deliberately stopped using. On
 * this conference that put all nine Board Registration holders under
 * "delegate", and it would put a Thursday Day Pass holder there too — so at the
 * one moment somebody is standing in front of you, the desk could not tell a
 * four-day attendee from a one-day pass.
 *
 * Reading the run means the desk and the badge cannot disagree about what a
 * person holds. Anything else is a fourth independent answer to "what kind of
 * badge is this", which is the drift preflight already had to be rescued from.
 */

import {
  resolveBadgeRun,
  badgeTypeForPerson,
  type BadgeRun,
} from "@/lib/conference/badges/run";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORG_TYPE } from "@/lib/constants/org-types";
import { localIsoDate, todayVerdict, verdictForDay } from "@/lib/conference/badges/checkin-verdict";
import { loadActiveBadgeTemplate } from "@/lib/conference/badges/document";
import { badgeLookKey } from "@/lib/conference/badges/template";
import {
  getBadgePrintStock,
  loadSpareStacks,
  type SpareStack,
} from "@/lib/conference/badges/print-stock";
import { blankCardKey, suggestStock, type BadgeStock, type CardsOnHand } from "@/lib/conference/badges/reprint-plan";
import { admittedDates, entityWhen, resolveAccess, type AccessSummary } from "@/lib/conference/entity-commerce";
import { ENTITY_SELECT, buildEntityGraph, loadSeatHoldings } from "@/lib/conference/seats";
import { capacityOf } from "@/lib/conference/attendance";
import type { DoorEvent } from "@/lib/conference/door";

export type CheckInFacts = {
  /** Who they are here with. The card used to show a bare name. */
  organizationName: string | null;
  /** The registration type from the catalogue — the words on the Build tab. */
  registrationType: string | null;
  /** The days this badge admits them to, in order. The day-pass question. */
  days: string[];
  /**
   * Those same days as ISO dates, so the desk can answer "is that TODAY?"
   * rather than making an operator compare a list of names against a calendar
   * while somebody waits. Empty when a day carries no date.
   */
  dayDates: string[];
  /** Short lines for the rest of it — meals, meetings, evening events. */
  admittedTo: string[];
  /**
   * What a reprint for this person actually has to produce.
   *
   * ⛔ Resolved HERE, not in the desk component. It depends on which companies
   * still have unnamed seats, which is a fact about the whole print run — the
   * desk has one scanned person and no way to know it. Handing the component a
   * computed answer also keeps the print-stock module (and the database work
   * behind it) out of a client bundle.
   */
  reprintStock: BadgeStock;
  /** Why, in words an operator can act on. */
  reprintReason: string;
  /** The cards that exist for them — what "Which card are you holding?" offers. */
  reprintCards?: CardsOnHand;
  /**
   * Hand them a CANCOLL pin at pickup: their SCHOOL is in the CANCOLL
   * purchasing group (Stephen, 2026-10-27). A school, not a vendor partner,
   * though partners carry the flag too.
   */
  cancollPin?: boolean;
};

/**
 * The desk's version of the badge's access block: shorter.
 *
 * A badge back has a whole card to fill and prints the agenda item by item. A
 * scan card is a few lines over a live camera feed and is read in about two
 * seconds, so this says what is included and never what time it starts.
 */
function deskAccessLines(access: AccessSummary | null): string[] {
  if (!access) return [];
  const lines: string[] = [];
  if (access.mealsIncluded) lines.push("Meals included");
  if (access.meetingDay) lines.push(`Curated meetings — ${access.meetingDay}`);
  if (access.tradeShowDays.length) {
    lines.push(`Trade show — ${access.tradeShowDays.map((d) => d.name).join(", ")}`);
  }
  if (access.events.length) {
    lines.push(
      access.events.length === 1 ? "1 evening event" : `${access.events.length} evening events`
    );
  }
  return lines;
}

export { localIsoDate, todayVerdict, verdictForDay };

/** Build the desk's facts from an already-resolved run. */
export function checkInFactsFromRun(
  run: BadgeRun,
  /** Day entity name → ISO date, for the "is today included" answer. */
  dateByDayName: Map<string, string> = new Map(),
  /** The run's spare stacks, one per badge look. Empty when spares are off. */
  spareStacks: ReadonlyArray<SpareStack> = [],
  /** Schools in the CANCOLL purchasing group: their people get a pin. */
  cancollSchoolIds: ReadonlySet<string> = new Set()
): Record<string, CheckInFacts> {
  const entitlementByPerson = new Map(run.entitlements.map((e) => [e.personId, e]));
  const facts: Record<string, CheckInFacts> = {};

  // ⛔ Companies with a seat nobody has been named to. A blank card for each of
  // these went into the print run carrying that company's name, logo and map —
  // so a reprint for one of their people only has to add the variable part,
  // which is a job the on-site thermal printer can do in monochrome.
  // ⛔ Keyed by company AND type: the blank's back carries that type's schedule.
  const unnamedSeatKeys = new Set<string>();
  for (const type of run.types) {
    for (const seat of type.seats) {
      if (!seat.person && seat.organizationId) unnamedSeatKeys.add(blankCardKey(seat.organizationId, type.entityId));
    }
  }

  for (const type of run.types) {
    for (const seat of type.seats) {
      const person = seat.person;
      if (!person || facts[person.personId]) continue;
      // ⛔ badgeTypeForPerson, not the type being iterated. Somebody holding
      // seats on two registration types must get the same answer here as the
      // printed badge gives, not whichever type happened to come first.
      const resolved = badgeTypeForPerson(run, person.personId) ?? type;
      // Per PERSON, not per type: event seats are sold separately, so a
      // type-level summary under-reports whoever bought an add-on — and an
      // add-on is exactly the thing a door is checking for.
      const entitlement = entitlementByPerson.get(person.personId);
      const access = entitlement?.access ?? resolved.accessSummary ?? null;
      const days = access?.days ?? [];
      facts[person.personId] = {
        organizationName: seat.organizationName || null,
        registrationType: resolved.name,
        days,
        // ⛔ The check-in rule's dates (admittedDates): days AND the days of
        // sessions/events granted. Falls back to named days for a type-level
        // summary, which has no person behind it.
        dayDates:
          entitlement?.admittedDates ??
          days.map((name) => dateByDayName.get(name)).filter((date): date is string => Boolean(date)),
        admittedTo: deskAccessLines(access),
        ...(() => {
          const { stock, reason, cards } = suggestStock({
            organizationId: seat.organizationId || null,
            unnamedSeatKeys,
            registrationTypeId: resolved.entityId,
            registrationTypeName: resolved.name,
            spareStacks,
          });
          return { reprintStock: stock, reprintReason: reason, reprintCards: cards };
        })(),
        cancollPin: Boolean(seat.organizationId && cancollSchoolIds.has(seat.organizationId)),
      };
    }
  }

  return facts;
}

/**
 * A registration seat a company has bought and nobody is named to yet. A blank
 * badge for it went into the print run, so a walk-up from that company is named
 * to it and gets a label on that blank, not a sale.
 */
export type OpenSeat = {
  seatId: string;
  organizationId: string;
  organizationName: string;
  /** The catalogue thing the seat is for: a registration type, or an event. */
  registrationTypeId: string;
  registrationTypeName: string;
  /**
   * An event seat is a company's spare ticket to one event (a Meet & Greet
   * it bought for its people). The door names somebody to it; the badge desk
   * names people to registrations.
   */
  entityKind: "registration" | "event";
};

/** Every open registration seat in the run, from the same walk as the badges. */
export function openSeatsFromRun(run: BadgeRun): OpenSeat[] {
  const open: OpenSeat[] = [];
  for (const type of run.types) {
    for (const seat of type.seats) {
      if (seat.person || !seat.organizationId) continue;
      open.push({
        seatId: seat.seatId,
        organizationId: seat.organizationId,
        organizationName: seat.organizationName,
        registrationTypeId: type.entityId,
        registrationTypeName: type.name,
        entityKind: "registration",
      });
    }
  }
  return open;
}

export type CheckInFactsPayload = {
  facts: Record<string, CheckInFacts>;
  /** Open seats per company — what "Find" shows when it matches a company. */
  openSeats: OpenSeat[];
  /**
   * Every date this conference runs on.
   *
   * ⛔ The desk needs this to know whether to show a today verdict AT ALL.
   * Without it, a badge scanned in September — during setup, or while somebody
   * is testing the desk — would be stamped "NOT VALID TODAY", which is true and
   * completely useless. The verdict only means something on a conference day.
   */
  conferenceDates: string[];
  /** Every timed event, for the door picker (lib/conference/door.ts). */
  doorEvents: DoorEvent[];
  /** The venue's timezone: an event's window is judged on its clock. */
  timeZone: string;
};

/**
 * ⚠️ Costs one full badge run (~800ms on the 2027 catalogue), so this is NOT
 * something to hang off the desk's 30-second roster poll — an eight-hour desk
 * would run it a thousand times during the busiest day of the conference. It is
 * loaded once when the desk opens and refreshed only when a scan lands on
 * somebody the desk has never heard of, which is what a walk-up registration
 * looks like.
 */
export async function loadCheckInFacts(
  conferenceId: string
): Promise<CheckInFactsPayload> {
  const db = createAdminClient();
  const [run, dateByDayName, printStock] = await Promise.all([
    // The desk rehearses on test organisations, so it sees them.
    resolveBadgeRun(conferenceId, { includeTestOrganizations: true }),
    loadDayDates(db, conferenceId),
    getBadgePrintStock(conferenceId),
  ]);

  // The spare stacks, by the printer's own rule — the manifest is not stored.
  // ⚠️ A failure here costs the spare suggestion, never the desk.
  const spareStackList = printStock.enabled
    ? await loadActiveBadgeTemplate(db, conferenceId)
        .then((template) =>
          loadSpareStacks({ db, conferenceId, run, stock: printStock, lookOf: (typeId) => badgeLookKey(template, typeId) })
        )
        .catch(() => [])
    : [];


  // ⚠️ A failure here costs the door picker, never the desk.
  const door = await loadDoorEvents(db, conferenceId).catch(() => ({ doorEvents: [], timeZone: DEFAULT_DOOR_TIME_ZONE }));
  // ⚠️ A failure here costs naming at a door, never the desk.
  const eventSeats = await openEventSeats(db, conferenceId).catch(() => [] as OpenSeat[]);
  // ⚠️ A failure here costs the pin prompt, never the desk.
  const cancollSchoolIds = await loadCancollSchoolIds(db).catch(() => new Set<string>());

  return {
    facts: checkInFactsFromRun(run, dateByDayName, spareStackList, cancollSchoolIds),
    openSeats: [...openSeatsFromRun(run), ...eventSeats],
    conferenceDates: [...new Set(dateByDayName.values())].sort(),
    ...door,
  };
}

const DEFAULT_DOOR_TIME_ZONE = "America/Toronto";

/**
 * Companies' spare event tickets: event seats nobody is named to (Jenna at the
 * door, 2026-10-21). Somebody from that company who is not on the event can
 * be put on the company's own ticket instead of being sold another.
 *
 * ⛔ A seat a registration INCLUDES is not spare. Buying a Full Conference
 * Registration mints a Meet & Greet seat beside it, and that seat waits for
 * whoever the company names to the registration (included-seats.ts). So per
 * purchase, as many open event seats as there are unnamed registrations are
 * held back; only the rest (tickets bought on their own) can go to the door.
 */
export async function openEventSeats(
  db: ReturnType<typeof createAdminClient>,
  conferenceId: string
): Promise<OpenSeat[]> {
  const { seats: open } = await loadSeatHoldings(db, {
    conferenceId,
    assigned: false,
    entityKinds: ["event", "registration"],
  });
  const openEvents = open.filter((seat) => seat.entityKind === "event" && seat.organizationId && seat.balanceId);
  if (openEvents.length === 0) return [];

  const balanceIds = [...new Set(open.map((seat) => seat.balanceId).filter((id): id is string => Boolean(id)))];
  const { data: balances, error } = await db.from("entity_balances").select("id, purchase_id").in("id", balanceIds);
  if (error) throw new Error(error.message);
  const purchaseOf = new Map((balances ?? []).map((b) => [b.id as string, b.purchase_id as string]));

  // Unnamed registrations per purchase: that many of each event are held back.
  const heldBack = new Map<string, number>();
  for (const seat of open) {
    if (seat.entityKind !== "registration" || !seat.balanceId) continue;
    const purchase = purchaseOf.get(seat.balanceId);
    if (purchase) heldBack.set(purchase, (heldBack.get(purchase) ?? 0) + 1);
  }
  const used = new Map<string, number>();
  const spare = [...openEvents]
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0) || a.seatId.localeCompare(b.seatId))
    .filter((seat) => {
      const purchase = purchaseOf.get(seat.balanceId as string);
      if (!purchase) return true;
      const key = `${purchase}:${seat.entityId}`;
      const taken = used.get(key) ?? 0;
      used.set(key, taken + 1);
      return taken >= (heldBack.get(purchase) ?? 0);
    });
  if (spare.length === 0) return [];

  const { data: orgs } = await db
    .from("organizations")
    .select("id, name")
    .in("id", [...new Set(spare.map((seat) => seat.organizationId))]);
  const nameById = new Map((orgs ?? []).map((org) => [org.id as string, org.name as string]));
  return spare.map((seat) => ({
    seatId: seat.seatId,
    organizationId: seat.organizationId,
    organizationName: nameById.get(seat.organizationId) ?? "",
    registrationTypeId: seat.entityId,
    registrationTypeName: seat.entityName,
    entityKind: "event" as const,
  }));
}

/**
 * The conference's timed events, for the door picker. Capped ones are the
 * doors the desk offers on its own; the rest can still be picked by hand.
 */
async function loadDoorEvents(
  db: ReturnType<typeof createAdminClient>,
  conferenceId: string
): Promise<{ doorEvents: DoorEvent[]; timeZone: string }> {
  const [entityRes, refRes, confRes] = await Promise.all([
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db.from("conference_entity_refs").select("from_entity_id, to_entity_id, role, quantity").eq("conference_id", conferenceId),
    db.from("conference_instances").select("timezone").eq("id", conferenceId).maybeSingle(),
  ]);
  if (entityRes.error) throw new Error(entityRes.error.message);
  if (refRes.error) throw new Error(refRes.error.message);
  const byId = new Map(buildEntityGraph(entityRes.data ?? [], refRes.data ?? []).map((e) => [e.id, e]));
  const doorEvents: DoorEvent[] = [];
  for (const entity of byId.values()) {
    if (entity.kind !== "event") continue;
    const when = entityWhen(entity.id, byId);
    if (!when.date || !when.startTime || !when.endTime) continue;
    doorEvents.push({ id: entity.id, name: entity.name, ...when, capped: capacityOf(entity) !== null });
  }
  doorEvents.sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  return {
    doorEvents,
    timeZone: (confRes.data?.timezone as string | null) || DEFAULT_DOOR_TIME_ZONE,
  };
}

/**
 * Does this person's access reach this event? The door's one question.
 * ⛔ resolveAccess over every seat they hold — the same closure the attendance
 * numbers count, so the door and the caterer's number cannot disagree.
 */
export async function personReachesEntity(conferenceId: string, personId: string, entityId: string): Promise<boolean> {
  const { seats, entitiesById } = await loadSeatHoldings(createAdminClient(), {
    conferenceId,
    holderPersonId: personId,
  });
  const heldIds = [...new Set(seats.map((seat) => seat.entityId))];
  if (heldIds.length === 0) return false;
  return resolveAccess(heldIds, entitiesById).has(entityId);
}

/**
 * Does this person hold anything their registration does not include? Their
 * seats' access, minus what the registration seats alone reach. The same
 * resolveAccess walk as personReachesEntity.
 */
export async function personHoldsExtras(conferenceId: string, personId: string): Promise<boolean> {
  const { seats, entitiesById } = await loadSeatHoldings(createAdminClient(), {
    conferenceId,
    holderPersonId: personId,
  });
  const registrations = seats.filter((seat) => seat.entityKind === "registration").map((seat) => seat.entityId);
  const covered = resolveAccess([...new Set(registrations)], entitiesById);
  return seats.some((seat) => seat.entityKind !== "registration" && !covered.has(seat.entityId));
}

/**
 * Schools in the CANCOLL purchasing group (`is_cancoll_member`): member and
 * non-member stores alike. Vendor partners carry the flag too and are left out:
 * the pins are for schools.
 */
async function loadCancollSchoolIds(db: ReturnType<typeof createAdminClient>): Promise<Set<string>> {
  const { data, error } = await db
    .from("organizations")
    .select("id")
    .eq("is_cancoll_member", true)
    .neq("type", ORG_TYPE.vendorPartner);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.id));
}

/** Day entity name → ISO date, for this conference. */
async function loadDayDates(
  db: ReturnType<typeof createAdminClient>,
  conferenceId: string
): Promise<Map<string, string>> {
  const { data: dayRows } = await db
    .from("conference_entities")
    .select("name, attributes")
    .eq("conference_id", conferenceId)
    .eq("kind", "day");
  const dateByDayName = new Map<string, string>();
  for (const row of (dayRows ?? []) as Array<Record<string, unknown>>) {
    const name = typeof row.name === "string" ? row.name : null;
    const attributes = (row.attributes ?? {}) as Record<string, unknown>;
    const date = typeof attributes.date === "string" ? attributes.date.trim() : "";
    if (name && date) dateByDayName.set(name, date);
  }
  return dateByDayName;
}

/**
 * The dates one person may be on site — the check-in rule (admittedDates) over
 * every seat they hold. ⛔ The SAME walk as the badge run's per-person
 * entitlements, without paying for a whole run. Empty when they hold nothing.
 */
export async function personAdmittedDates(conferenceId: string, personId: string): Promise<string[]> {
  // ⛔ Through the one seat reader: it throws on a failed read (never "holds
  // nothing"), and it already builds the catalogue graph this walk needs.
  const { seats, entitiesById } = await loadSeatHoldings(createAdminClient(), {
    conferenceId,
    holderPersonId: personId,
  });
  const heldIds = [...new Set(seats.map((seat) => seat.entityId))];
  if (heldIds.length === 0) return [];
  return admittedDates(heldIds, entitiesById);
}

/**
 * Is this person's badge good for `today`? For the scan, one person at a time.
 * Null when today is not a conference day or they hold nothing.
 */
export async function personVerdictToday(
  conferenceId: string,
  personId: string,
  today: string
): Promise<{ admitted: boolean } | null> {
  const [dates, dateByDayName] = await Promise.all([
    personAdmittedDates(conferenceId, personId),
    loadDayDates(createAdminClient(), conferenceId),
  ]);
  return verdictForDay(dates, [...new Set(dateByDayName.values())], today);
}
