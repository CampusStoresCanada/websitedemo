/**
 * Connecting an election to a members' meeting — the ONE writer of the relation.
 *
 * Steve 2026-11-19: "The Election module should set up the election, the AGM the
 * AGM. When an AGM is created then can 'Connect Election?' ... and the other way
 * around also works."
 *
 * So the two modules each own their own setup, and this owns the seam between
 * them. It is deliberately one module called from both sides rather than a
 * connect on the election screen and another on the meeting screen: two writers
 * of one relation is how the halves drift apart, and the drift is invisible
 * until a notice goes out on the wrong day.
 *
 * ⛔ Why connecting is not bookkeeping. Every election date is the meeting date
 * minus N days (`deriveSchedule` is four subtractions), so an election with
 * nothing connected has NO calendar — no nomination window, no ballot window,
 * no notice deadline, and no obligations, because every one of those is dated
 * relative to the meeting. Connecting is the act that brings them into
 * existence. That is also why the obligations are minted here and not at
 * kickoff: this is the first moment their due dates exist, and the first moment
 * "announce the result at the annual general meeting" can be parented to the
 * right meeting instead of to whatever the next board meeting happened to be.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { deriveSchedule, validateSchedule } from "@/lib/elections/schedule";
import { mintElectionActionItems, type MintedTask } from "@/lib/elections/action-items";
import { getElection, getScheduledElection, isScheduled } from "@/lib/elections/service";
import { getMembersMeeting } from "@/lib/governance/members-meetings-service";
import { MEMBERS_MEETING_TYPES, type MembersMeeting } from "@/lib/governance/members-meetings";
import { logAuditEventSafe } from "@/lib/ops/audit";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = <T,>(error: string): Result<T> => ({ ok: false, error });

export interface ConnectResult {
  electionSlug: string;
  meetingId: string;
  meetingDate: string;
  /** The windows this connection derived, for the screen to show back. */
  nominationsOpenAt: string;
  nominationsCloseAt: string;
  ballotsOpenAt: string;
  ballotsCloseAt: string;
  tasks: MintedTask[];
}

/**
 * An election that could still be connected: one with no meeting, and therefore
 * no calendar. Offered on the meeting screen.
 */
export interface ConnectableElection {
  slug: string;
  cycleYear: number;
  seatsAvailable: number;
  status: string;
}

/**
 * A members' meeting that could still be connected: one with no election on it.
 * Offered on the election screen.
 */
export interface ConnectableMeeting {
  id: string;
  meetingDate: string;
  meetingType: string;
  title: string;
  status: string;
  /**
   * True once notice has gone out. Connecting is still allowed after that — a
   * meeting properly called can have an election attached late — but
   * DISCONNECTING is not, so the screen warns before the choice rather than
   * refusing after it.
   */
  noticeSent: boolean;
}

/**
 * Elections with nothing connected.
 *
 * ⛔ Reads `meeting_id is null`, not "has no dates". They are the same condition
 * by `elections_schedule_matches_meeting_link`, but the link is the fact and the
 * dates are its consequence, so the query asks about the fact.
 */
export async function listConnectableElections(): Promise<ConnectableElection[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("elections")
    .select("slug, cycle_year, seats_available, status")
    .is("meeting_id", null)
    .order("cycle_year", { ascending: false });

  if (error) {
    console.error("[meeting-election-link] could not list connectable elections:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    slug: row.slug as string,
    cycleYear: row.cycle_year as number,
    seatsAvailable: (row.seats_available as number | null) ?? 0,
    status: row.status as string,
  }));
}

/**
 * Members' meetings with no election on them.
 *
 * Cancelled meetings are left out: connecting an election to a meeting that is
 * not going to happen would derive a calendar from a date nobody will keep.
 *
 * ⛔ So are meetings that have already SAT. Caught by looking at the screen
 * rather than by reading the code: an election in setup was being offered the
 * January 2026 AGM, and connecting to it would have derived a nomination window
 * that closed over a year ago. `validateSchedule` would not have objected --
 * the windows are internally coherent, they are just all in the past -- so this
 * is the only place it can be stopped. A past meeting with no election attached
 * is not a thing anyone is trying to run an election at.
 */
export async function listConnectableMeetings(): Promise<ConnectableMeeting[]> {
  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: linked } = await db.from("elections").select("meeting_id").not("meeting_id", "is", null);
  const taken = new Set((linked ?? []).map((r) => r.meeting_id as string));

  const { data, error } = await db
    .from("board_meetings")
    .select("id, meeting_date, meeting_type, title, status, notice_sent_at")
    .in("meeting_type", [...MEMBERS_MEETING_TYPES])
    .neq("status", "cancelled")
    .gte("meeting_date", today)
    .order("meeting_date", { ascending: true });

  if (error) {
    console.error("[meeting-election-link] could not list connectable meetings:", error.message);
    return [];
  }

  return (data ?? [])
    .filter((row) => !taken.has(row.id as string))
    .map((row) => ({
      id: row.id as string,
      meetingDate: row.meeting_date as string,
      meetingType: row.meeting_type as string,
      title: (row.title as string | null) ?? "",
      status: row.status as string,
      noticeSent: !!row.notice_sent_at,
    }));
}

/**
 * Connect an election to a members' meeting, and derive the election's calendar
 * from the meeting's date.
 *
 * Idempotent in the only sense that matters: connecting the pair that is already
 * connected is accepted and re-derives nothing, so a double-submit cannot
 * silently move a window.
 */
export async function connectElectionToMeeting(input: {
  electionSlug: string;
  meetingId: string;
  actorId: string;
}): Promise<Result<ConnectResult>> {
  const db = createAdminClient();

  const election = await getElection(input.electionSlug);
  if (!election) return fail(`No election "${input.electionSlug}".`);

  const meeting = await getMembersMeeting(input.meetingId);
  if (!meeting) return fail("That members' meeting no longer exists.");
  if (meeting.status === "cancelled")
    return fail(
      "That meeting is cancelled. An election's windows cannot be measured back from a date nobody is keeping."
    );

  // Already this pair: say so and change nothing.
  if (election.meetingId === meeting.id && isScheduled(election))
    return ok({
      electionSlug: election.slug,
      meetingId: meeting.id,
      meetingDate: meeting.meetingDate,
      nominationsOpenAt: election.schedule.nominationsOpenAt,
      nominationsCloseAt: election.schedule.nominationsCloseAt,
      ballotsOpenAt: election.schedule.ballotsOpenAt,
      ballotsCloseAt: election.schedule.ballotsCloseAt,
      tasks: [],
    });

  // ⛔ One election per meeting, one meeting per election. The partial unique
  // index on `elections.meeting_id` enforces the first; this reports both as
  // sentences instead of letting a constraint violation reach the screen.
  if (election.meetingId && election.meetingId !== meeting.id)
    return fail(
      "This election is already connected to a different members' meeting. Disconnect it there first."
    );

  const { data: occupant } = await db
    .from("elections")
    .select("slug")
    .eq("meeting_id", meeting.id)
    .maybeSingle();
  if (occupant && (occupant.slug as string) !== election.slug)
    return fail(
      `The ${occupant.slug} election is already connected to this meeting. A meeting elects one board.`
    );

  // The calendar. Derived from where the meeting actually SITS, which is the
  // whole point of connecting rather than deriving from the by-law's rule.
  const schedule = deriveSchedule(meeting.meetingDate, election.config);
  const problems = validateSchedule(schedule);
  if (problems.length)
    return fail(
      `A calendar measured back from ${meeting.meetingDate} is not coherent: ${problems.join(" ")}`
    );

  // ⛔ The link and the five dates in ONE update. Writing them separately would
  // transiently violate `elections_schedule_matches_meeting_link` and fail
  // halfway, leaving an election connected to a meeting with no windows.
  const { error: writeError } = await db
    .from("elections")
    .update({
      meeting_id: meeting.id,
      // The FROZEN snapshot of what the windows were derived from. Not a copy of
      // the meeting date for its own sake: it is what makes a later move
      // detectable by `meetingDivergence` instead of silently rewriting history.
      agm_date: meeting.meetingDate,
      nominations_open_at: schedule.nominationsOpenAt,
      nominations_close_at: schedule.nominationsCloseAt,
      ballots_open_at: schedule.ballotsOpenAt,
      ballots_close_at: schedule.ballotsCloseAt,
    })
    .eq("id", election.id);

  if (writeError)
    return fail(`The election could not be connected to the meeting: ${writeError.message}`);

  await logAuditEventSafe({
    actorId: input.actorId,
    action: "election_connected_to_members_meeting",
    entityType: "election",
    entityId: election.id,
    details: {
      electionSlug: election.slug,
      meetingId: meeting.id,
      meetingDate: meeting.meetingDate,
      derivedWindows: schedule,
    },
  });

  // Now, and not before, the obligations have due dates to be due on.
  const connected = await getScheduledElection(election.slug);
  const tasks = connected ? await mintElectionActionItems(connected) : [];

  return ok({
    electionSlug: election.slug,
    meetingId: meeting.id,
    meetingDate: meeting.meetingDate,
    nominationsOpenAt: schedule.nominationsOpenAt,
    nominationsCloseAt: schedule.nominationsCloseAt,
    ballotsOpenAt: schedule.ballotsOpenAt,
    ballotsCloseAt: schedule.ballotsCloseAt,
    tasks,
  });
}

/**
 * Why a connection can no longer be undone, or null when it still can.
 *
 * ⛔ Notice is the hard stop. A notice names the day the meeting sits and the
 * business to be transacted, it goes to every member institution, and it is
 * discharged ONCE — there is no second notice that un-tells people. Once it has
 * gone out, the connection is a fact in the record of a statutory act, and
 * software that offers to delete it is offering to make the record disagree with
 * what members were told.
 *
 * Pure, so the screen and the writer cannot disagree about whether the button
 * should be there.
 */
export function disconnectBlockedBecause(input: {
  electionStatus: string;
  meeting: Pick<MembersMeeting, "noticeSentAt" | "proxyFormSentAt" | "packageSentAt">;
}): string | null {
  if (input.meeting.noticeSentAt)
    return "Notice of this meeting has gone out to the membership. Notice names the day and is discharged once, so the connection stays on the record.";
  if (input.meeting.proxyFormSentAt)
    return "The proxy form for this meeting has gone out, and a proxy is appointed for a meeting on a stated day.";
  if (input.meeting.packageSentAt)
    return "The meeting package has gone out to the membership.";
  if (["sealed", "certified"].includes(input.electionStatus))
    return `This election is ${input.electionStatus}. Its result is recorded against this meeting.`;
  return null;
}

/**
 * Disconnect an election from its meeting, returning it to setup.
 *
 * Clears the link AND all five dates together, because the invariant is
 * all-or-none and an election with no meeting has no calendar by definition.
 */
export async function disconnectElectionFromMeeting(input: {
  electionSlug: string;
  actorId: string;
}): Promise<Result<{ electionSlug: string }>> {
  const db = createAdminClient();

  const election = await getElection(input.electionSlug);
  if (!election) return fail(`No election "${input.electionSlug}".`);
  if (!election.meetingId)
    return fail("This election has no members' meeting connected to it.");

  const meeting = await getMembersMeeting(election.meetingId);
  if (!meeting) return fail("The connected meeting no longer exists.");

  const blocked = disconnectBlockedBecause({
    electionStatus: election.status,
    meeting,
  });
  if (blocked) return fail(blocked);

  const { error } = await db
    .from("elections")
    .update({
      meeting_id: null,
      agm_date: null,
      nominations_open_at: null,
      nominations_close_at: null,
      ballots_open_at: null,
      ballots_close_at: null,
    })
    .eq("id", election.id);

  if (error) return fail(`The election could not be disconnected: ${error.message}`);

  await logAuditEventSafe({
    actorId: input.actorId,
    action: "election_disconnected_from_members_meeting",
    entityType: "election",
    entityId: election.id,
    details: {
      electionSlug: election.slug,
      meetingId: meeting.id,
      meetingDate: meeting.meetingDate,
      windowsCleared: election.schedule,
    },
  });

  return ok({ electionSlug: election.slug });
}
