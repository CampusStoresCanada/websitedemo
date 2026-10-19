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
import {
  getBadgePrintStock,
  spareCountsByType,
  spareCountsForJob,
} from "@/lib/conference/badges/print-stock";
import { suggestStock, type BadgeStock } from "@/lib/conference/badges/reprint-plan";
import { admittedDates, type AccessSummary } from "@/lib/conference/entity-commerce";
import { buildEntityGraph, ENTITY_SELECT } from "@/lib/conference/entity-rows";
import { indexById } from "@/lib/conference/entity-graph";

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

/** Today where the DESK is standing, as an ISO date. */
export function localIsoDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Does this badge cover today?
 *
 * ⛔ Returns null unless today is a conference day. Listing the days is only
 * half an answer — the operator still has to compare them to a calendar with
 * somebody waiting — but stamping "NOT VALID TODAY" on every badge scanned
 * during setup, or while somebody tests the desk in September, is worse than
 * saying nothing. The verdict only means something once the doors are open.
 *
 * ⚠️ Local dates, not UTC. The desk is a laptop on a table in Mississauga and
 * "today" is the day the people in the room are having; a UTC comparison flips
 * the answer for everything after 7pm local.
 */
export function todayVerdict(
  facts: Pick<CheckInFacts, "dayDates"> | null,
  conferenceDates: string[],
  now: Date = new Date()
): { admitted: boolean } | null {
  if (!facts) return null;
  return verdictForDay(facts.dayDates, conferenceDates, localIsoDate(now));
}

/**
 * The rule itself, for a known "today". ⛔ ONE rule: the desk card shows it and
 * the scan enforces it (personVerdictToday) — a badge for another day is
 * REFUSED at pickup, not checked in with a warning (Stephen, 2026-10-19).
 */
export function verdictForDay(
  dayDates: string[],
  conferenceDates: string[],
  today: string
): { admitted: boolean } | null {
  if (dayDates.length === 0) return null;
  if (!conferenceDates.includes(today)) return null;
  return { admitted: dayDates.includes(today) };
}

/** Build the desk's facts from an already-resolved run. */
export function checkInFactsFromRun(
  run: BadgeRun,
  /** Day entity name → ISO date, for the "is today included" answer. */
  dateByDayName: Map<string, string> = new Map(),
  /** Spares the run printed, per registration type. Empty when spares are off. */
  sparesByType: ReadonlyArray<{ entityId: string; name: string; count: number }> = []
): Record<string, CheckInFacts> {
  const entitlementByPerson = new Map(run.entitlements.map((e) => [e.personId, e]));
  const facts: Record<string, CheckInFacts> = {};

  // ⛔ Companies with a seat nobody has been named to. A blank card for each of
  // these went into the print run carrying that company's name, logo and map —
  // so a reprint for one of their people only has to add the variable part,
  // which is a job the on-site thermal printer can do in monochrome.
  const unnamedSeatOrganizationIds = new Set<string>();
  for (const type of run.types) {
    for (const seat of type.seats) {
      if (!seat.person && seat.organizationId) unnamedSeatOrganizationIds.add(seat.organizationId);
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
          const { stock, reason } = suggestStock({
            organizationId: seat.organizationId || null,
            unnamedSeatOrganizationIds,
            registrationTypeId: resolved.entityId,
            sparesByType,
          });
          return { reprintStock: stock, reprintReason: reason };
        })(),
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
  registrationTypeId: string;
  registrationTypeName: string;
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
    resolveBadgeRun(conferenceId),
    loadDayDates(db, conferenceId),
    getBadgePrintStock(conferenceId),
  ]);

  // Spares by type, by the printer's own rule — the manifest is not stored.
  // ⚠️ A failure here costs the spare suggestion, never the desk.
  const sparesByType = printStock.enabled
    ? await spareCountsForJob(db, conferenceId, run, printStock)
        .then((counts) => spareCountsByType(run, counts.total))
        .catch(() => [])
    : [];


  return {
    facts: checkInFactsFromRun(run, dateByDayName, sparesByType),
    openSeats: openSeatsFromRun(run),
    conferenceDates: [...new Set(dateByDayName.values())].sort(),
  };
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
  const db = createAdminClient();
  const [entitiesRes, refsRes, seatsRes] = await Promise.all([
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conferenceId),
    db
      .from("entity_balance_seats")
      .select("entity_id")
      .eq("conference_id", conferenceId)
      .eq("holder_person_id", personId),
  ]);
  if (entitiesRes.error || refsRes.error || seatsRes.error) {
    throw new Error("Could not read what this badge covers.");
  }
  const heldIds = [...new Set((seatsRes.data ?? []).map((s) => s.entity_id as string))];
  if (heldIds.length === 0) return [];
  const byId = indexById(buildEntityGraph(entitiesRes.data ?? [], refsRes.data ?? []));
  return admittedDates(heldIds, byId);
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
