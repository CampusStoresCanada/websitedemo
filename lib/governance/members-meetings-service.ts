/**
 * Reading members' meetings out of the database.
 *
 * Split from `members-meetings.ts` the way `elections/service.ts` is split from
 * `elections/schedule.ts`: the shapes, the labels and the derivations are pure
 * and safe for a client component to import, and this half is not. It reaches
 * for the service-role client, whose own file says in capitals never to import
 * it from client code — so nothing in here may be imported by a `"use client"`
 * component, and nothing in here is.
 *
 * Admin client rather than the session client on purpose. The governance tables
 * have RLS on with no policies, so a session-client read of them returns zero
 * rows and `error: null` — a silent empty board. Same reason
 * `governance/register.ts` uses it.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  MEMBERS_MEETING_TYPES,
  isMembersMeetingType,
  type MembersMeeting,
  type MembersMeetingElection,
  type MembersMeetingEvent,
} from "@/lib/governance/members-meetings";

const MEETING_COLUMNS =
  "id, meeting_date, meeting_type, title, status, notes, agenda_html, minutes_html, event_id";

const EVENT_COLUMNS =
  "id, slug, status, starts_at, ends_at, is_virtual, location, virtual_link, audience_mode, google_event_id";

type MeetingRow = {
  id: string;
  meeting_date: string;
  meeting_type: string;
  title: string;
  status: string;
  notes: string | null;
  agenda_html: string | null;
  minutes_html: string | null;
  event_id: string | null;
};

async function hydrate(rows: MeetingRow[]): Promise<MembersMeeting[]> {
  if (rows.length === 0) return [];
  const db = createAdminClient();

  const meetingIds = rows.map((r) => r.id);
  const eventIds = rows.map((r) => r.event_id).filter((id): id is string => !!id);
  const dates = rows.map((r) => r.meeting_date);

  const [events, docs, proxies, elections] = await Promise.all([
    eventIds.length
      ? db.from("events").select(EVENT_COLUMNS).in("id", eventIds)
      : Promise.resolve({ data: [] as never[] }),
    db.from("board_documents").select("meeting_id").in("meeting_id", meetingIds),
    db
      .from("meeting_proxies")
      .select("meeting_id")
      .in("meeting_id", meetingIds)
      .is("revoked_at", null),
    db
      .from("elections")
      .select("slug, cycle_year, status, seats_available, agm_date")
      .in("agm_date", dates),
  ]);

  const eventById = new Map<string, MembersMeetingEvent>();
  for (const e of events.data ?? []) {
    const row = e as Record<string, unknown>;
    eventById.set(row.id as string, {
      id: row.id as string,
      slug: row.slug as string,
      status: row.status as string,
      startsAt: (row.starts_at as string | null) ?? null,
      endsAt: (row.ends_at as string | null) ?? null,
      isVirtual: (row.is_virtual as boolean | null) ?? null,
      location: (row.location as string | null) ?? null,
      virtualLink: (row.virtual_link as string | null) ?? null,
      audienceMode: (row.audience_mode as string | null) ?? null,
      googleEventId: (row.google_event_id as string | null) ?? null,
    });
  }

  const docCount = new Map<string, number>();
  for (const d of docs.data ?? []) {
    const id = (d as { meeting_id: string | null }).meeting_id;
    if (id) docCount.set(id, (docCount.get(id) ?? 0) + 1);
  }

  const proxyCount = new Map<string, number>();
  for (const p of proxies.data ?? []) {
    const id = (p as { meeting_id: string | null }).meeting_id;
    if (id) proxyCount.set(id, (proxyCount.get(id) ?? 0) + 1);
  }

  const electionByDate = new Map<string, MembersMeetingElection>();
  for (const e of elections.data ?? []) {
    const row = e as Record<string, unknown>;
    electionByDate.set(row.agm_date as string, {
      slug: row.slug as string,
      cycleYear: row.cycle_year as number,
      status: row.status as string,
      seatsAvailable: (row.seats_available as number | null) ?? null,
    });
  }

  return rows.map((r) => ({
    id: r.id,
    meetingDate: r.meeting_date,
    meetingType: r.meeting_type,
    title: r.title,
    status: r.status,
    notes: r.notes,
    hasAgenda: !!r.agenda_html?.trim(),
    hasMinutes: !!r.minutes_html?.trim(),
    documentCount: docCount.get(r.id) ?? 0,
    proxyCount: proxyCount.get(r.id) ?? 0,
    event: r.event_id ? eventById.get(r.event_id) ?? null : null,
    election: electionByDate.get(r.meeting_date) ?? null,
  }));
}

/** Every members' meeting, soonest-dated first. Admin client: see register.ts. */
export async function listMembersMeetings(): Promise<MembersMeeting[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("board_meetings")
    .select(MEETING_COLUMNS)
    .in("meeting_type", MEMBERS_MEETING_TYPES as readonly string[])
    .order("meeting_date", { ascending: false });

  if (error) {
    console.error("[listMembersMeetings]", error);
    return [];
  }
  return hydrate((data ?? []) as MeetingRow[]);
}

export async function getMembersMeeting(id: string): Promise<MembersMeeting | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("board_meetings")
    .select(MEETING_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as MeetingRow;
  if (!isMembersMeetingType(row.meeting_type)) return null;

  const [hydrated] = await hydrate([row]);
  return hydrated ?? null;
}

/**
 * The members' meeting an event belongs to, if it is one.
 *
 * Used by `updateEvent` to tell whether the event being edited is the event
 * page of a meeting of the members — in which case its date is governance and
 * cannot be moved from the Events form. Returns null for every ordinary event,
 * which is almost all of them, so it costs one indexed lookup.
 */
export async function getMembersMeetingByEventId(
  eventId: string
): Promise<MembersMeeting | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("board_meetings")
    .select(MEETING_COLUMNS)
    .eq("event_id", eventId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as MeetingRow;
  if (!isMembersMeetingType(row.meeting_type)) return null;

  const [hydrated] = await hydrate([row]);
  return hydrated ?? null;
}

/**
 * The members' meeting sitting on a given date, if there is one.
 *
 * ⚠️ This is the date join, named honestly and in one place. `elections` has no
 * `meeting_id` column — it carries `agm_date`, and the meeting carries
 * `meeting_date`, and equal dates is the whole relation. Every caller that
 * needs to get from an election to its meeting should come through here rather
 * than writing the match again, so that the day the column is added there is
 * one line to change.
 */
export async function getMembersMeetingByDate(date: string): Promise<MembersMeeting | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("board_meetings")
    .select(MEETING_COLUMNS)
    .in("meeting_type", MEMBERS_MEETING_TYPES as readonly string[])
    .eq("meeting_date", date)
    .maybeSingle();

  if (error || !data) return null;
  const [hydrated] = await hydrate([data as MeetingRow]);
  return hydrated ?? null;
}
