import type { createAdminClient } from "@/lib/supabase/admin";
import { parseOrgCategories } from "@/lib/publication/categories";

/**
 * The shape of Big Ideas Day, read off the schedule: which day, which two
 * rooms, and when presentations can run.
 *
 * ⛔ ONE reader. The public page shows these windows, staff place
 * presentations into them, and the server refuses a time outside them. Three
 * copies of "when do presentations run" would disagree the first time lunch
 * moved.
 */

/** Steve, 2026-11-20: a presentation is "a formal 20 minute thing". */
export const PRESENTATION_MINUTES = 20;
/** The thing a partner buys to pitch one. conference-topics.ts gates on it. */
export const PRESENTATION_OFFER_NAME = "Big Ideas Presentations";
const SESSION_NAME = "Big Ideas Day";

type Db = ReturnType<typeof createAdminClient>;

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
/** 810 -> "1:30". No am/pm: the day runs 8 to 4 and nobody reads 1:30 as night. */
export const clock = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  return `${((h + 11) % 12) + 1}:${String(minutes % 60).padStart(2, "0")}`;
};
/** 810 -> "13:30", the form a time is stored and compared in. */
export const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * When presentations can run: the day, minus whatever is being served in the
 * same room.
 *
 * Derived rather than typed in, because the presentations share their room
 * with breakfast, lunch and the breaks. Move lunch and these move with it; a
 * hand-written list would keep promising a talk in the middle of the buffet.
 */
export function openWindows(
  day: { start: string; end: string },
  busy: Array<{ start: string; end: string }>
): Array<{ start: number; end: number }> {
  const windows: Array<{ start: number; end: number }> = [];
  let cursor = toMinutes(day.start);
  const end = toMinutes(day.end);
  for (const b of [...busy].sort((a, z) => toMinutes(a.start) - toMinutes(z.start))) {
    const from = toMinutes(b.start);
    const to = toMinutes(b.end);
    if (to <= cursor || from >= end) continue;
    if (from - cursor >= PRESENTATION_MINUTES) windows.push({ start: cursor, end: from });
    cursor = Math.max(cursor, to);
  }
  if (end - cursor >= PRESENTATION_MINUTES) windows.push({ start: cursor, end });
  return windows;
}

/** Every start a presentation can take: back to back inside each window. */
export function presentationSlotStarts(windows: Array<{ start: number; end: number }>): number[] {
  const starts: number[] = [];
  for (const w of windows) {
    for (let t = w.start; t + PRESENTATION_MINUTES <= w.end; t += PRESENTATION_MINUTES) starts.push(t);
  }
  return starts;
}

/** Minutes past midnight, in the conference's own zone, of a stored instant. */
export function wallMinutesInZone(iso: string, timeZone: string): number {
  // Supabase can hand a timestamp back without a zone; unmarked means UTC.
  const marked = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(marked));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * A room, said the way a delegate would recognise it.
 *
 * Sean Bell, 2026-11-26: "we refer to 'Dundas & Cawthra' running table
 * conversations. The name doesn't mean anything to people." The hotel's name
 * for a room is only useful once you are standing in the corridor, so what
 * the room is for leads and the name follows in brackets.
 */
export function roomPhrase(kind: "tables" | "talks", name: string | null): string {
  const what = kind === "tables" ? "the main room" : "the second room";
  return name ? `${what} (${name})` : what;
}

export type BigIdeasDay = {
  sessionId: string;
  purpose: string | null;
  /** "2027-02-04", or null until the session is given a day. */
  dayIso: string | null;
  dayLabel: string | null;
  dayStart: string | null;
  dayEnd: string | null;
  /** Where the table conversations are: the session's own room. */
  tablesRoom: string | null;
  /** Where the presentations are: the presentation slot's room. */
  talksRoom: string | null;
  /** What is served in the presentation room that day. */
  meals: Array<{ label: string; start: string; end: string }>;
  talkWindows: Array<{ start: number; end: number }>;
};

export async function loadBigIdeasDay(db: Db, conferenceId: string): Promise<BigIdeasDay | null> {
  const { data: session } = await db
    .from("conference_entities")
    .select("id, name, attributes")
    .eq("conference_id", conferenceId)
    .eq("name", SESSION_NAME)
    .maybeSingle();
  if (!session) return null;

  const attrs = (session.attributes as Record<string, unknown> | null) ?? {};

  /*
    Two rooms, read off the schedule rather than named here. The table
    conversations are wherever the session is; the presentations are wherever
    the presentation slot is. Each is one `where` reference in the build
    workspace, so a room change there reaches every reader of this alike.
  */
  const { data: slot } = await db
    .from("conference_entities")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("name", PRESENTATION_OFFER_NAME)
    .maybeSingle();
  const { data: placeRefs } = await db
    .from("conference_entity_refs")
    .select("from_entity_id, role, to_entity_id")
    .eq("conference_id", conferenceId)
    .in("from_entity_id", [session.id, ...(slot ? [slot.id] : [])])
    .in("role", ["where", "when"]);
  const refOf = (fromId: string | undefined, role: string) =>
    (placeRefs ?? []).find((r) => r.from_entity_id === fromId && r.role === role)?.to_entity_id ?? null;
  const tablesVenueId = refOf(session.id, "where");
  const talksVenueId = refOf(slot?.id, "where");
  const dayId = refOf(session.id, "when");

  const lookupIds = [tablesVenueId, talksVenueId, dayId].filter((v): v is string => Boolean(v));
  const { data: named } = lookupIds.length
    ? await db.from("conference_entities").select("id, name, attributes").in("id", lookupIds)
    : { data: [] };
  const nameOf = (id: string | null) => (named ?? []).find((v) => v.id === id)?.name ?? null;

  // "2027-02-04" read as UTC so it cannot slip a day in a runtime west of Greenwich.
  const rawDate = ((named ?? []).find((v) => v.id === dayId)?.attributes as { date?: unknown } | null)?.date;
  const dayIso = typeof rawDate === "string" ? rawDate : null;
  const dayLabel = dayIso
    ? new Date(`${dayIso}T00:00:00Z`).toLocaleDateString("en-CA", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  // Whatever is served in the presentation room that day.
  const { data: sharedRefs } =
    talksVenueId && dayId
      ? await db
          .from("conference_entity_refs")
          .select("from_entity_id, role, to_entity_id")
          .eq("conference_id", conferenceId)
          .in("to_entity_id", [talksVenueId, dayId])
          .in("role", ["where", "when"])
      : { data: [] };
  const inRoom = new Set(
    (sharedRefs ?? []).filter((r) => r.to_entity_id === talksVenueId).map((r) => r.from_entity_id)
  );
  const sameDayInRoom = (sharedRefs ?? [])
    .filter((r) => r.to_entity_id === dayId && inRoom.has(r.from_entity_id))
    .map((r) => r.from_entity_id);
  const { data: mealRows } = sameDayInRoom.length
    ? await db.from("conference_entities").select("name, attributes").eq("kind", "meal").in("id", sameDayInRoom)
    : { data: [] };
  const meals = (mealRows ?? [])
    .map((m) => ({ name: m.name, a: (m.attributes as Record<string, unknown> | null) ?? {} }))
    .filter((m): m is { name: string; a: { start_time: string; end_time: string } } =>
      typeof m.a.start_time === "string" && typeof m.a.end_time === "string"
    )
    // "Lunch - Thursday" is named for the build workspace; the day is already
    // in the heading wherever this is shown.
    .map((m) => ({ label: m.name.split(" - ")[0].trim(), start: m.a.start_time, end: m.a.end_time }));

  const dayStart = typeof attrs.start_time === "string" ? attrs.start_time : null;
  const dayEnd = typeof attrs.end_time === "string" ? attrs.end_time : null;
  const talksRoom = nameOf(talksVenueId);

  return {
    sessionId: session.id,
    purpose: typeof attrs.purpose === "string" ? attrs.purpose : null,
    dayIso,
    dayLabel,
    dayStart,
    dayEnd,
    tablesRoom: nameOf(tablesVenueId),
    talksRoom,
    meals,
    talkWindows: talksRoom && dayStart && dayEnd ? openWindows({ start: dayStart, end: dayEnd }, meals) : [],
  };
}

// ─────────────────────────────────────────────────────────────────
// Which partners are in the room
// ─────────────────────────────────────────────────────────────────

/**
 * A course materials partner, by the taxonomy's own parser, so "Digital
 * Course Materials" and the other stored spellings resolve to the same class.
 */
export function isCourseMaterialsPartner(primaryCategory: string | null | undefined): boolean {
  return parseOrgCategories(primaryCategory).classes.includes("Course Materials");
}

export type PartnerInRoom = { id: string; name: string; logoUrl: string | null };

/**
 * The partners taking part in Big Ideas Day. Two ways in:
 *
 *   1. They hold something the schedule says admits to the session: the Big
 *      Ideas Day rates, sold to partners who are not exhibiting.
 *   2. They are exhibiting AND are a course materials partner (Steve,
 *      2026-11-20). Exhibitors were never offered a rate, because the day is
 *      theirs already, but nothing said so: VitalSource and Kivuto held booths
 *      and were told that places were "by invitation".
 *
 * ⛔ Not every exhibitor. The floor is mostly apparel and gifts, and listing
 * forty of them under "Partners in the room" would bury the ones the day is for.
 *
 * ⛔ ONE answer. The public list and the page's "you're already in the room"
 * both read this, so a partner is never listed as coming and then told to ask
 * for an invitation.
 *
 * Partners only: a member store's registration is not something it agreed to
 * have advertised. Test organisations never appear.
 */
export async function loadPartnersInRoom(db: Db, conferenceId: string, sessionId: string): Promise<PartnerInRoom[]> {
  const { data: admittingRefs } = await db
    .from("conference_entity_refs")
    .select("from_entity_id")
    .eq("conference_id", conferenceId)
    .eq("role", "involved_in")
    .eq("to_entity_id", sessionId);
  const admitting = (admittingRefs ?? []).map((r) => r.from_entity_id);

  const orgFields = "organizations(id, name, type, is_test, logo_url, primary_category)";
  const [{ data: rateHolders }, { data: boothHolders }] = await Promise.all([
    admitting.length
      ? db.from("entity_balances").select(orgFields).eq("conference_id", conferenceId).in("entity_id", admitting)
      : Promise.resolve({ data: [] as never[] }),
    db
      .from("entity_balances")
      .select(`${orgFields}, entity:conference_entities!entity_balances_entity_id_fkey!inner(kind)`)
      .eq("conference_id", conferenceId)
      .eq("entity.kind", "booth"),
  ]);

  const byId = new Map<string, PartnerInRoom>();
  const consider = (rows: Array<{ organizations: unknown }> | null, exhibitorRule: boolean) => {
    for (const row of rows ?? []) {
      const o = (Array.isArray(row.organizations) ? row.organizations[0] : row.organizations) as {
        id: string;
        name: string;
        type: string | null;
        is_test: boolean | null;
        logo_url: string | null;
        primary_category: string | null;
      } | null;
      if (!o || o.is_test || o.type !== "Vendor Partner") continue;
      if (exhibitorRule && !isCourseMaterialsPartner(o.primary_category)) continue;
      byId.set(o.id, { id: o.id, name: o.name, logoUrl: o.logo_url });
    }
  };
  consider(rateHolders, false);
  consider(boothHolders, true);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
