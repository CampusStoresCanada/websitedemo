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

// ⚠️ ONE literal. Concatenating this with `+` makes supabase-js infer
// GenericStringError instead of the row type — the select string has to be a
// single literal for the types to resolve.
const MEETING_COLUMNS =
  "id, meeting_date, meeting_type, title, status, notes, purpose, agenda_html, minutes_html, event_id, notice_sent_at, proxy_form_sent_at, package_sent_at, package_send_count";

const EVENT_COLUMNS =
  "id, slug, status, starts_at, ends_at, is_virtual, location, virtual_link, audience_mode, google_event_id";

type MeetingRow = {
  id: string;
  meeting_date: string;
  meeting_type: string;
  title: string;
  status: string;
  notes: string | null;
  purpose: string | null;
  agenda_html: string | null;
  minutes_html: string | null;
  event_id: string | null;
  notice_sent_at: string | null;
  proxy_form_sent_at: string | null;
  package_sent_at: string | null;
  package_send_count: number | null;
};

async function hydrate(rows: MeetingRow[]): Promise<MembersMeeting[]> {
  if (rows.length === 0) return [];
  const db = createAdminClient();

  const meetingIds = rows.map((r) => r.id);
  const eventIds = rows.map((r) => r.event_id).filter((id): id is string => !!id);

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
    // ⛔ By `meeting_id`, the relation — not by matching dates. A meeting that
    // moved used to make this find nothing, so an election out of step with its
    // meeting looked exactly like no election at all. `agm_date` is still
    // selected, but as the frozen date the windows came FROM, which is what
    // `meetingDivergence` compares against.
    db
      .from("elections")
      .select("slug, cycle_year, status, seats_available, agm_date, meeting_id")
      .in("meeting_id", meetingIds),
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

  const electionByMeeting = new Map<string, MembersMeetingElection>();
  for (const e of elections.data ?? []) {
    const row = e as Record<string, unknown>;
    const meetingId = row.meeting_id as string | null;
    if (!meetingId) continue;
    electionByMeeting.set(meetingId, {
      slug: row.slug as string,
      cycleYear: row.cycle_year as number,
      status: row.status as string,
      seatsAvailable: (row.seats_available as number | null) ?? null,
      windowsDerivedFrom: (row.agm_date as string | null) ?? null,
    });
  }

  return rows.map((r) => ({
    id: r.id,
    meetingDate: r.meeting_date,
    meetingType: r.meeting_type,
    title: r.title,
    status: r.status,
    notes: r.notes,
    purpose: r.purpose?.trim() || null,
    hasAgenda: !!r.agenda_html?.trim(),
    noticeSentAt: r.notice_sent_at ?? null,
    proxyFormSentAt: r.proxy_form_sent_at ?? null,
    packageSentAt: r.package_sent_at ?? null,
    packageSendCount: r.package_send_count ?? 0,
    hasMinutes: !!r.minutes_html?.trim(),
    documentCount: docCount.get(r.id) ?? 0,
    proxyCount: proxyCount.get(r.id) ?? 0,
    event: r.event_id ? eventById.get(r.event_id) ?? null : null,
    election: electionByMeeting.get(r.id) ?? null,
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

// ─── What has been SENT for this meeting ────────────────────────────────────
//
// ⛔ ONE home for four facts. Notice, the proxy form and the members' package
// used to be recorded on `elections.config` (`agmNoticeSentAt`,
// `proxyFormSentAt`, `agmPackageSentAt`, `agmPackageSendCount`). They are
// obligations of the MEETING under By-Law Part VII, their deadlines derive from
// the day it sits, and a special members' meeting has no election to hang them
// on — so a meeting without one could not record that notice had been given at
// all, and its progress list said "notice not given" forever.
//
// Moved to `board_meetings` 2026-11-18. Nothing was backfilled because nothing
// existed: the only election row had none of the four keys set, checked before
// the migration ran.

export interface MembersMeetingSendRecord {
  meetingId: string;
  noticeSentAt: string | null;
  proxyFormSentAt: string | null;
  packageSentAt: string | null;
  packageSendCount: number;
}

const SEND_COLUMNS =
  "id, notice_sent_at, proxy_form_sent_at, package_sent_at, package_send_count";

function toSendRecord(row: Record<string, unknown>): MembersMeetingSendRecord {
  return {
    meetingId: row.id as string,
    noticeSentAt: (row.notice_sent_at as string) ?? null,
    proxyFormSentAt: (row.proxy_form_sent_at as string) ?? null,
    packageSentAt: (row.package_sent_at as string) ?? null,
    packageSendCount: (row.package_send_count as number) ?? 0,
  };
}

/**
 * The send record for a members' meeting, by id or by the date it sits on.
 *
 * Lean on purpose — four columns, no hydrate. The readers that need it
 * (`getNoticeState`, `getAgmPackageState`) run on every page load.
 */
export async function getMembersMeetingSendRecord(
  by: { meetingId: string } | { meetingDate: string }
): Promise<MembersMeetingSendRecord | null> {
  const db = createAdminClient();
  let q = db
    .from("board_meetings")
    .select(SEND_COLUMNS)
    .in("meeting_type", MEMBERS_MEETING_TYPES as readonly string[]);

  q = "meetingId" in by ? q.eq("id", by.meetingId) : q.eq("meeting_date", by.meetingDate);

  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return toSendRecord(data as Record<string, unknown>);
}

/**
 * Record that something went out for this meeting.
 *
 * ⚠️ Claimed BEFORE the send, like the election's sends are: a duplicate notice
 * for one meeting, possibly stating different times, leaves the meeting
 * arguably improperly called under Part VII S4, which is worse than a miss.
 *
 * `bumpPackageCount` increments rather than setting, so a legitimate re-send is
 * visible as a count instead of overwriting the first.
 */
export async function recordMembersMeetingSend(
  meetingId: string,
  patch: {
    noticeSentAt?: string;
    proxyFormSentAt?: string;
    packageSentAt?: string;
    bumpPackageCount?: boolean;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createAdminClient();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.noticeSentAt) update.notice_sent_at = patch.noticeSentAt;
  if (patch.proxyFormSentAt) update.proxy_form_sent_at = patch.proxyFormSentAt;
  if (patch.packageSentAt) update.package_sent_at = patch.packageSentAt;

  if (patch.bumpPackageCount) {
    const { data: current } = await db
      .from("board_meetings")
      .select("package_send_count")
      .eq("id", meetingId)
      .maybeSingle();
    update.package_send_count = ((current?.package_send_count as number) ?? 0) + 1;
  }

  const { error } = await db.from("board_meetings").update(update).eq("id", meetingId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
