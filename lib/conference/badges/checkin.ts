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
import type { AccessSummary } from "@/lib/conference/entity-commerce";

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
  if (!facts || facts.dayDates.length === 0) return null;
  const today = localIsoDate(now);
  if (!conferenceDates.includes(today)) return null;
  return { admitted: facts.dayDates.includes(today) };
}

/** Build the desk's facts from an already-resolved run. */
export function checkInFactsFromRun(
  run: BadgeRun,
  /** Day entity name → ISO date, for the "is today included" answer. */
  dateByDayName: Map<string, string> = new Map()
): Record<string, CheckInFacts> {
  const entitlementByPerson = new Map(run.entitlements.map((e) => [e.personId, e]));
  const facts: Record<string, CheckInFacts> = {};

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
        dayDates: days
          .map((name) => dateByDayName.get(name))
          .filter((date): date is string => Boolean(date)),
        admittedTo: deskAccessLines(access),
      };
    }
  }

  return facts;
}

export type CheckInFactsPayload = {
  facts: Record<string, CheckInFacts>;
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
  const [run, { data: dayRows }] = await Promise.all([
    resolveBadgeRun(conferenceId),
    db
      .from("conference_entities")
      .select("name, attributes")
      .eq("conference_id", conferenceId)
      .eq("kind", "day"),
  ]);

  const dateByDayName = new Map<string, string>();
  for (const row of (dayRows ?? []) as Array<Record<string, unknown>>) {
    const name = typeof row.name === "string" ? row.name : null;
    const attributes = (row.attributes ?? {}) as Record<string, unknown>;
    const date = typeof attributes.date === "string" ? attributes.date.trim() : "";
    if (name && date) dateByDayName.set(name, date);
  }

  return {
    facts: checkInFactsFromRun(run, dateByDayName),
    conferenceDates: [...new Set(dateByDayName.values())].sort(),
  };
}
