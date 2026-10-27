import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadPersonAgenda, type AgendaItem } from "@/lib/conference/person-agenda";
import { loadSeatHoldings, ENTITY_SELECT, buildEntityGraph } from "@/lib/conference/seats";
import { entityWhen } from "@/lib/conference/entity-commerce";
import { personReachesEntity } from "@/lib/conference/badges/checkin";
import { doorWindow, type DoorEvent } from "@/lib/conference/door";
import { publicScanBase } from "@/lib/conference/badges/tokens";
import { loadMemberMap } from "@/lib/conference/member-map";

/**
 * Check-in cards (Stephen, 2026-10-21): a printed QR at a place. Scan it while
 * signed in and you are counted there.
 *
 *   - A BOOTH card confirms a scheduled meeting at that booth: CANCOLL's bursary
 *     needs proof the meetings happened without staff walking the room. Either
 *     side scans; a delegate counts themselves, an exhibitor scanning their own
 *     card confirms who they are meeting now. Two scans are never an error, each
 *     side's confirmation is its own row.
 *   - An EVENT card checks you in to an event an organiser marked for it (the
 *     CANCOLL AGM, a session, the offsite bus).
 *
 * ⛔ The same `conference_check_in_events` rows the door writes, so /me, the
 * door list and the attendance numbers all read one record.
 * ⛔ The scan page RECORDS NOTHING on load (same rule as /scan/[token]): it says
 * what will happen and a button does the write (lib/actions/check-in-cards.ts).
 */

type Db = ReturnType<typeof createAdminClient>;

export type CardKind = "booth" | "event";

/** How long around a meeting a booth scan still counts for it. */
const MEETING_MARGIN_MS = 15 * 60 * 1000;

/** An organiser turns an event's card on in the Build tab: Check-in card = yes. */
export function takesCheckInCards(attributes: Record<string, unknown> | null | undefined): boolean {
  const raw = attributes?.check_in_card;
  if (raw === true) return true;
  return typeof raw === "string" && ["yes", "y", "true", "on", "1"].includes(raw.trim().toLowerCase());
}

/** What a card's QR opens. Signed-in only, like a badge's. */
export function checkInCardUrl(kind: CardKind, id: string): string {
  return `${publicScanBase()}/scan/place/${kind}/${id}`;
}

export type CheckInCard = { kind: CardKind; id: string; title: string; subtitle: string; url: string };

/** Every card a conference prints: one per meeting booth, one per marked event. */
export async function loadCheckInCards(conferenceId: string): Promise<CheckInCard[]> {
  const db = createAdminClient();
  const [{ data: suites }, graph, map] = await Promise.all([
    db
      .from("conference_suites")
      .select("id, suite_number")
      .eq("conference_id", conferenceId)
      .eq("is_active", true)
      .order("suite_number"),
    loadGraph(db, conferenceId),
    loadMemberMap(conferenceId).catch(() => ({ things: [] as Array<{ label: string; orgName: string | null }> })),
  ]);
  // A suite is the meeting use of the booth with the same number.
  const orgAtBooth = new Map(map.things.map((thing) => [thing.label.trim(), thing.orgName]));
  const cards: CheckInCard[] = (suites ?? []).map((suite) => {
    const number = String(suite.suite_number);
    const org = orgAtBooth.get(number);
    return {
      kind: "booth" as const,
      id: suite.id as string,
      title: `Booth ${number}`,
      subtitle: org ? `${org} · scan to check in to your meeting` : "Scan to check in to your meeting",
      url: checkInCardUrl("booth", suite.id as string),
    };
  });
  for (const entity of graph.byId.values()) {
    if (!takesCheckInCards(entity.attributes)) continue;
    cards.push({
      kind: "event",
      id: entity.id,
      title: entity.name,
      subtitle: "Scan to check in",
      url: checkInCardUrl("event", entity.id),
    });
  }
  return cards;
}

async function loadGraph(db: Db, conferenceId: string) {
  const [entityRes, refRes, confRes] = await Promise.all([
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db.from("conference_entity_refs").select("from_entity_id, to_entity_id, role, quantity").eq("conference_id", conferenceId),
    db.from("conference_instances").select("name, timezone").eq("id", conferenceId).maybeSingle(),
  ]);
  if (entityRes.error) throw new Error(entityRes.error.message);
  if (refRes.error) throw new Error(refRes.error.message);
  const byId = new Map(buildEntityGraph(entityRes.data ?? [], refRes.data ?? []).map((e) => [e.id, e]));
  return {
    byId,
    conferenceName: (confRes.data?.name as string | null) ?? "the conference",
    timeZone: (confRes.data?.timezone as string | null) || "America/Toronto",
  };
}

/** The viewer's roster entries at a conference (somebody can be at two orgs). */
async function viewerPeople(db: Db, conferenceId: string, userId: string) {
  const { data } = await db
    .from("conference_people")
    .select("id, display_name, person_kind")
    .eq("conference_id", conferenceId)
    .eq("user_id", userId);
  return (data ?? []).filter((person) => person.person_kind !== "unassigned");
}

const inMeetingWindow = (item: AgendaItem, now: Date) => {
  if (!item.startsAt || !item.endsAt) return false;
  const t = now.getTime();
  return t >= Date.parse(item.startsAt) - MEETING_MARGIN_MS && t <= Date.parse(item.endsAt) + MEETING_MARGIN_MS;
};

export type MeetingDelegate = { personId: string; name: string; countedByThem: boolean; confirmedByYou: boolean };

export type BoothScan =
  | { mode: "attendee"; conferenceId: string; personId: string; scheduleId: string; exhibitorName: string; startsAt: string | null; counted: boolean }
  | { mode: "exhibitor"; conferenceId: string; scheduleId: string; startsAt: string | null; delegates: MeetingDelegate[] }
  | { mode: "none"; conferenceId: string; orgSlug: string | null; orgName: string | null; boothLabel: string }
  | { mode: "unknown" };

/**
 * What scanning this booth's card means for this viewer, right now.
 *
 * ⛔ Their meetings come from their own agenda (loadPersonAgenda), the same
 * reader /me renders, so a scan and the schedule cannot disagree about which
 * meeting is "now".
 */
export async function resolveBoothScan(suiteId: string, userId: string, now: Date): Promise<BoothScan> {
  const db = createAdminClient();
  const { data: suite } = await db
    .from("conference_suites")
    .select("id, conference_id, suite_number")
    .eq("id", suiteId)
    .maybeSingle();
  if (!suite) return { mode: "unknown" };
  const conferenceId = suite.conference_id as string;

  for (const person of await viewerPeople(db, conferenceId, userId)) {
    const agenda = await loadPersonAgenda(person.id as string, conferenceId);
    if (!agenda.success) continue;
    const meeting = agenda.data.items.find(
      (item) => item.meetingAssignment?.suiteId === suiteId && inMeetingWindow(item, now)
    );
    const assignment = meeting?.meetingAssignment;
    if (!meeting || !assignment) continue;

    const { data: rows } = await db
      .from("conference_check_in_events")
      .select("person_id, confirmed_by")
      .eq("schedule_id", assignment.scheduleId)
      .eq("is_test", false)
      // Scans only: a staff ruling belongs to staff views (schedule-ops).
      .in("confirmed_by", ["attendee", "exhibitor"]);
    const confirmations = rows ?? [];

    if (agenda.data.meetingSeatId && agenda.data.meetingSeatId === assignment.exhibitorSeatId) {
      const { seats } = await loadSeatHoldings(db, { conferenceId, seatIds: assignment.delegateSeatIds });
      return {
        mode: "exhibitor",
        conferenceId,
        scheduleId: assignment.scheduleId,
        startsAt: meeting.startsAt ?? null,
        delegates: seats
          .filter((seat) => seat.holderPersonId)
          .map((seat) => ({
            personId: seat.holderPersonId as string,
            name: seat.holderName ?? "A delegate",
            countedByThem: confirmations.some((r) => r.person_id === seat.holderPersonId && r.confirmed_by === "attendee"),
            confirmedByYou: confirmations.some((r) => r.person_id === seat.holderPersonId && r.confirmed_by === "exhibitor"),
          })),
      };
    }
    return {
      mode: "attendee",
      conferenceId,
      personId: person.id as string,
      scheduleId: assignment.scheduleId,
      exhibitorName: assignment.exhibitorName,
      startsAt: meeting.startsAt ?? null,
      counted: confirmations.some((r) => r.person_id === person.id && r.confirmed_by === "attendee"),
    };
  }

  // No meeting here for them now: the booth's company, as any other scan.
  const map = await loadMemberMap(conferenceId).catch(() => null);
  const label = String(suite.suite_number);
  const thing = map?.things.find((t) => t.label.trim() === label) ?? null;
  return { mode: "none", conferenceId, orgSlug: thing?.orgSlug ?? null, orgName: thing?.orgName ?? null, boothLabel: label };
}

export type EventScan =
  | { mode: "check_in"; conferenceId: string; personId: string; eventName: string; onTicket: boolean; counted: boolean }
  | { mode: "outside_window"; eventName: string; opensAt: string; closesAt: string }
  | { mode: "not_registered"; eventName: string; conferenceName: string }
  | { mode: "unknown" };

/** What scanning an event's card means for this viewer, right now. */
export async function resolveEventScan(entityId: string, userId: string, now: Date): Promise<EventScan> {
  const db = createAdminClient();
  const { data: row } = await db.from("conference_entities").select("conference_id").eq("id", entityId).maybeSingle();
  if (!row) return { mode: "unknown" };
  const conferenceId = row.conference_id as string;
  const graph = await loadGraph(db, conferenceId);
  const entity = graph.byId.get(entityId);
  if (!entity || !takesCheckInCards(entity.attributes)) return { mode: "unknown" };

  // The door's own window: an hour either side.
  const when = entityWhen(entityId, graph.byId);
  if (when.date && when.startTime && when.endTime) {
    const event: DoorEvent = { id: entityId, name: entity.name, ...when, capped: false };
    const { opens, closes } = doorWindow(event, graph.timeZone);
    if (now.getTime() < opens || now.getTime() > closes) {
      return {
        mode: "outside_window",
        eventName: entity.name,
        opensAt: new Date(opens).toISOString(),
        closesAt: new Date(closes).toISOString(),
      };
    }
  }

  const people = await viewerPeople(db, conferenceId, userId);
  const person = people[0];
  if (!person) return { mode: "not_registered", eventName: entity.name, conferenceName: graph.conferenceName };
  const [onTicket, { data: prior }] = await Promise.all([
    personReachesEntity(conferenceId, person.id as string, entityId).catch(() => true),
    db
      .from("conference_check_in_events")
      .select("id")
      .eq("person_id", person.id as string)
      .eq("entity_id", entityId)
      .eq("is_test", false)
      .in("result_state", ["valid", "not_on_ticket"])
      .limit(1),
  ]);
  return {
    mode: "check_in",
    conferenceId,
    personId: person.id as string,
    eventName: entity.name,
    onTicket,
    counted: (prior ?? []).length > 0,
  };
}

/**
 * Write one card check-in, once. Idempotent per (person, meeting, side) or
 * (person, event): a second scan is "already counted", never a second row.
 */
export async function recordCardCheckIn(params: {
  conferenceId: string;
  personId: string;
  byUserId: string;
  scheduleId?: string | null;
  entityId?: string | null;
  confirmedBy: "attendee" | "exhibitor";
  resultState: "valid" | "not_on_ticket";
}): Promise<{ error: string | null; alreadyCounted: boolean }> {
  const db = createAdminClient();
  let existing = db
    .from("conference_check_in_events")
    .select("id")
    .eq("conference_id", params.conferenceId)
    .eq("person_id", params.personId)
    .eq("is_test", false)
    .limit(1);
  existing = params.scheduleId
    ? existing.eq("schedule_id", params.scheduleId).eq("confirmed_by", params.confirmedBy)
    : existing.eq("entity_id", params.entityId as string);
  const { data: prior, error: priorError } = await existing;
  if (priorError) return { error: priorError.message, alreadyCounted: false };
  if ((prior ?? []).length > 0) return { error: null, alreadyCounted: true };

  const { error } = await db.from("conference_check_in_events").insert({
    conference_id: params.conferenceId,
    person_id: params.personId,
    checked_in_at: new Date().toISOString(),
    checked_in_by: params.byUserId,
    check_in_source: "qr",
    scan_token_id: null,
    device_id: null,
    result_state: params.resultState,
    is_test: false,
    entity_id: params.entityId ?? null,
    schedule_id: params.scheduleId ?? null,
    confirmed_by: params.confirmedBy,
  });
  return { error: error?.message ?? null, alreadyCounted: false };
}
