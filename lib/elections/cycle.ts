/**
 * Starting an election cycle.
 *
 * Everything downstream — nominations, ballots, the tally — depends on an
 * election existing with the right dates. Nobody creates one on their own
 * initiative in July, and a process that depends on somebody remembering
 * unprompted in a quiet month is a process that eventually gets missed. So the
 * cycle has a front door with two halves:
 *
 *   1. `ensureElectionKickoff()` runs on a schedule and guarantees the Executive
 *      Director is HOLDING a dated, assigned obligation to start the cycle,
 *      raised in time for the August board meeting so it can be turned on and
 *      running by September.
 *   2. `startElectionCycle()` is what they press. It is the human "yes, do the
 *      thing" — deliberately not automatic, because opening an election is a
 *      governance act with a date the board should have seen.
 *
 * Opening a cycle also schedules the AGM: a board meeting of type `agm` and a
 * members-only event linked to it, exactly as the meetings admin does it. Google
 * Calendar seeded the existing board meetings, but the events apparatus writes
 * the other way too — publishing a virtual event mints the Google event and Meet
 * link. The AGM event is created as a DRAFT, so the date exists in the system,
 * the announce-the-result task has a meeting to hang off, and nothing reaches
 * the membership or the calendar until someone publishes it.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import { CSC_ELECTIONS_CONFIG, type ElectionsConfig } from "./config";
import { resolveAgmDate, deriveSchedule, validateSchedule } from "./schedule";
import { mintElectionActionItems, type MintedTask } from "./action-items";
import { getElection, type Election } from "./service";

/**
 * How far ahead of the nominations-open date a meeting can be and still be a
 * sensible place to raise the kickoff. Roughly "this season, not last year".
 */
const MAX_KICKOFF_LEAD_DAYS = 150;

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = <T,>(error: string): Result<T> => ({ ok: false, error });

/** Slug for a cycle. Stable, so the kickoff guard can tell if it already ran. */
export function electionSlug(bodyKey: string, year: number): string {
  return `${bodyKey.replace(/_/g, "-").replace("board-of-directors", "board")}-${year}`;
}

export interface CycleStartResult {
  slug: string;
  agmDate: string;
  seatsAvailable: number;
  agmMeetingId: string | null;
  agmEventId: string | null;
  agmNote: string;
  tasks: MintedTask[];
}

/**
 * Open a cycle: create the election, publish the members-only AGM event, and
 * hand the board its obligations.
 *
 * `seatsAvailable` is NOT derived. CSC staggers 4 and 5 across alternating
 * years, but a seat can also fall vacant mid-term and be filled by appointment
 * (Part IV S3), which shifts the pattern — so the number is confirmed by a human
 * against the term register rather than computed from a cycle parity that will
 * eventually be wrong.
 */
export async function startElectionCycle(input: {
  bodyKey?: string;
  cycleYear: number;
  seatsAvailable: number;
  startedByProfileId: string;
  /** Override the rule-derived AGM date, e.g. when the board moves it. */
  agmDateOverride?: string | null;
  config?: ElectionsConfig;
}): Promise<Result<CycleStartResult>> {
  const db = createAdminClient();
  const bodyKey = input.bodyKey ?? "board_of_directors";
  const config = input.config ?? CSC_ELECTIONS_CONFIG;

  const { data: body } = await db
    .from("governance_bodies")
    .select("id, name")
    .eq("key", bodyKey)
    .maybeSingle();
  if (!body) return fail(`No governance body "${bodyKey}".`);

  const agmDate = input.agmDateOverride ?? resolveAgmDate(config, input.cycleYear);
  if (!agmDate)
    return fail(
      "The AGM date could not be derived and no override was given. Set one explicitly."
    );

  const schedule = deriveSchedule(agmDate, config);
  const problems = validateSchedule(schedule);
  if (problems.length) return fail(problems.join(" "));

  if (input.seatsAvailable < 1) return fail("At least one seat must be up for election.");

  const slug = electionSlug(bodyKey, input.cycleYear);
  const { data: already } = await db.from("elections").select("id").eq("slug", slug).maybeSingle();
  if (already) return fail(`The ${input.cycleYear} cycle has already been started (${slug}).`);

  const { data: election, error } = await db
    .from("elections")
    .insert({
      slug,
      body_id: body.id,
      cycle_year: input.cycleYear,
      agm_date: agmDate,
      nominations_open_at: schedule.nominationsOpenAt,
      nominations_close_at: schedule.nominationsCloseAt,
      ballots_open_at: schedule.ballotsOpenAt,
      ballots_close_at: schedule.ballotsCloseAt,
      seats_available: input.seatsAvailable,
      status: "draft",
      // Round-tripped through JSON so the snapshot satisfies `Json`: the config
      // carries string-union fields (reminder audiences, tie resolution) that
      // are structurally fine but not assignable to Json as written.
      config: JSON.parse(
        JSON.stringify({
          ...config,
          startedBy: input.startedByProfileId,
          startedAt: new Date().toISOString(),
        })
      ) as Json,
    })
    .select("id")
    .single();
  if (error || !election) return fail(`Could not create the election: ${error?.message}`);

  // The AGM itself: a board meeting of type `agm` plus a members-only event
  // linked to it, mirroring POST /api/admin/board/meetings. Held as a DRAFT —
  // the date is in the system and the announce-the-result task has somewhere to
  // land, but nothing is announced and no Google Calendar event exists until a
  // person publishes it. Publishing is what pushes it out.
  const agm = await ensureAgmMeetingAndEvent({
    agmDate,
    cycleYear: input.cycleYear,
    createdByProfileId: input.startedByProfileId,
  });

  // Seats. Incumbents are left blank — filling them means asserting whose term
  // ends this cycle, which is exactly what the human confirming seatsAvailable
  // has just checked against the register.
  for (let i = 1; i <= input.seatsAvailable; i++) {
    await db.from("election_seats").insert({ election_id: election.id, seat_key: `seat-${i}` });
  }

  // Minted AFTER the AGM meeting exists, so "Announce the result at the annual
  // general meeting" parents to the AGM rather than to December's meeting.
  const loaded = await getElection(slug);
  const tasks = loaded ? await mintElectionActionItems(loaded) : [];

  return ok({
    slug,
    agmDate,
    seatsAvailable: input.seatsAvailable,
    agmMeetingId: agm.meetingId,
    agmEventId: agm.eventId,
    agmNote: agm.note,
    tasks,
  });
}

export interface AgmScheduleResult {
  meetingId: string | null;
  eventId: string | null;
  note: string;
}

/**
 * Schedule the AGM, idempotently.
 *
 * The event is a draft on purpose. A draft virtual event has no Google Calendar
 * entry — `updateEventStatus` mints one on the transition to published — so this
 * puts the date in the system without announcing it to the membership or
 * putting it in anyone's calendar. Publish when the details are settled.
 */
export async function ensureAgmMeetingAndEvent(input: {
  agmDate: string;
  cycleYear: number;
  createdByProfileId: string;
}): Promise<AgmScheduleResult> {
  const db = createAdminClient();
  const title = `CSC Annual General Meeting — ${input.agmDate}`;
  const eventSlug = `csc-annual-general-meeting-${input.cycleYear}`;

  const { data: existingMeeting } = await db
    .from("board_meetings")
    .select("id, event_id, meeting_type")
    .eq("meeting_date", input.agmDate)
    .maybeSingle();

  let meetingId = (existingMeeting?.id as string) ?? null;
  let eventId = (existingMeeting?.event_id as string) ?? null;
  const notes: string[] = [];

  if (existingMeeting) {
    notes.push(
      `A meeting already existed on ${input.agmDate}` +
        (existingMeeting.meeting_type !== "agm"
          ? ` with type "${existingMeeting.meeting_type}" — left as it is; check it is the AGM.`
          : " — left as it is.")
    );
  } else {
    const { data: meeting, error } = await db
      .from("board_meetings")
      .insert({
        meeting_date: input.agmDate,
        meeting_type: "agm",
        title,
        status: "upcoming",
        created_by: input.createdByProfileId,
      })
      .select("id")
      .single();
    if (error) {
      notes.push(`The AGM meeting could not be created (${error.message}).`);
    } else {
      meetingId = meeting!.id as string;
      notes.push("AGM board meeting created.");
    }
  }

  if (!eventId) {
    const { data: existingEvent } = await db
      .from("events")
      .select("id")
      .eq("slug", eventSlug)
      .maybeSingle();

    if (existingEvent) {
      eventId = existingEvent.id as string;
      notes.push("An AGM event with this slug already existed and was reused.");
    } else {
      const { data: event, error: eventError } = await db
        .from("events")
        .insert({
          slug: eventSlug,
          title: `Campus Stores Canada Annual General Meeting — ${input.cycleYear}`,
          starts_at: `${input.agmDate}T16:00:00`,
          ends_at: `${input.agmDate}T18:00:00`,
          audience_mode: "members",
          is_virtual: true,
          status: "draft",
          created_by: input.createdByProfileId,
          body_html:
            `<p>The ${input.cycleYear} Annual General Meeting of Campus Stores Canada.</p>` +
            `<p>Directors are elected at this meeting. If more nominees stand than there are seats, ` +
            `ballots go to member institutions beforehand and the result is announced here; ` +
            `otherwise the nominees are acclaimed.</p>` +
            `<p>Each member institution is entitled to attend and to vote.</p>`,
        })
        .select("id")
        .single();

      if (eventError) {
        // Not fatal. The meeting and the election are the records that matter.
        notes.push(`The AGM event could not be created (${eventError.message}).`);
      } else {
        eventId = event!.id as string;
        notes.push("Members-only AGM event created as a DRAFT — publish it to announce the date and put it in the calendar.");
      }
    }

    if (meetingId && eventId) {
      await db.from("board_meetings").update({ event_id: eventId }).eq("id", meetingId);
    }
  }

  return { meetingId, eventId, note: notes.join(" ") };
}

export interface KickoffResult {
  cycleYear: number;
  needed: boolean;
  created: boolean;
  existingSlug: string | null;
  taskTitle: string;
  meetingDate: string | null;
  assignedTo: string | null;
  note: string;
}

/**
 * Make sure the Executive Director is holding a dated obligation to start the
 * next cycle.
 *
 * Idempotent and safe to run daily. It creates nothing once the cycle has been
 * started, and nothing twice. The task is deliberately raised at the board
 * meeting BEFORE nominations must open, so the board sees it while there is
 * still room to appoint a Nominating Committee and agree a tie-break rule.
 */
export async function ensureElectionKickoff(
  options: { today?: string; bodyKey?: string; config?: ElectionsConfig } = {}
): Promise<KickoffResult> {
  const db = createAdminClient();
  const bodyKey = options.bodyKey ?? "board_of_directors";
  const config = options.config ?? CSC_ELECTIONS_CONFIG;
  const today =
    options.today ??
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Edmonton",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

  // The cycle in play is the next AGM that has not happened yet.
  const thisYear = Number(today.slice(0, 4));
  let cycleYear = thisYear;
  let agmDate = resolveAgmDate(config, cycleYear);
  if (!agmDate || agmDate < today) {
    cycleYear = thisYear + 1;
    agmDate = resolveAgmDate(config, cycleYear);
  }

  const base: Omit<KickoffResult, "needed" | "created" | "note"> = {
    cycleYear,
    existingSlug: null,
    taskTitle: `Start the ${cycleYear} board election cycle`,
    meetingDate: null,
    assignedTo: null,
  };

  if (!agmDate)
    return { ...base, needed: false, created: false, note: "No AGM date rule is configured." };

  const slug = electionSlug(bodyKey, cycleYear);
  const { data: existing } = await db.from("elections").select("slug").eq("slug", slug).maybeSingle();
  if (existing)
    return {
      ...base,
      existingSlug: slug,
      needed: false,
      created: false,
      note: `The ${cycleYear} cycle is already open.`,
    };

  const schedule = deriveSchedule(agmDate, config);

  // Raise it at the last board meeting before nominations must open — the
  // August meeting for a January AGM, which is the point of checking in summer
  // rather than in September when it is already late.
  //
  // But only if that meeting is CLOSE to the deadline. Board meetings come from
  // Google Calendar and next year's are typically not scheduled until well into
  // the year, so "the last meeting before September 2027" evaluated in February
  // 2027 resolves to a meeting from December 2026 — technically before the
  // deadline, useless in practice, and it would put a 2028 task on a 2026
  // agenda where nobody would look at it again. Wait for a real one instead.
  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, meeting_date")
    .lte("meeting_date", schedule.nominationsOpenAt)
    .order("meeting_date", { ascending: false })
    .limit(1);

  const target = meeting?.[0];
  if (!target)
    return {
      ...base,
      needed: true,
      created: false,
      note: `No board meeting falls before nominations must open (${schedule.nominationsOpenAt}), so there is nowhere to raise this. Schedule one.`,
    };

  const gapDays = Math.round(
    (Date.parse(`${schedule.nominationsOpenAt}T00:00:00Z`) -
      Date.parse(`${target.meeting_date as string}T00:00:00Z`)) /
      86_400_000
  );
  if (gapDays > MAX_KICKOFF_LEAD_DAYS)
    return {
      ...base,
      needed: true,
      created: false,
      meetingDate: target.meeting_date as string,
      note:
        `The nearest board meeting before nominations open (${schedule.nominationsOpenAt}) is ` +
        `${target.meeting_date}, ${gapDays} days earlier — too far ahead to be a useful agenda item. ` +
        `Waiting until a closer meeting is scheduled; this check runs daily and will pick it up.`,
    };

  const { data: alreadyTasked } = await db
    .from("board_action_items")
    .select("id")
    .eq("title", base.taskTitle)
    .limit(1);
  if (alreadyTasked?.length)
    return {
      ...base,
      needed: true,
      created: false,
      meetingDate: target.meeting_date as string,
      note: "The kickoff task is already on the board's list.",
    };

  const { data: ed } = await db
    .from("governance_role_assignments")
    .select("person_profile_id, profiles:person_profile_id(display_name)")
    .eq("role_key", "executive_director")
    .is("term_end", null)
    .limit(1);
  const holder = ed?.[0];

  const { data: last } = await db
    .from("board_action_items")
    .select("sort_order")
    .eq("meeting_id", target.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await db.from("board_action_items").insert({
    meeting_id: target.id,
    title: base.taskTitle,
    description:
      `Open the ${cycleYear} election cycle so nominations can go out on ${schedule.nominationsOpenAt}. ` +
      `Starting it creates the election, publishes the members-only AGM event for ${agmDate}, and puts the ` +
      `rest of the cycle's obligations on the board's list assigned to the officers who hold them.\n\n` +
      `Before starting, confirm how many seats are up. CSC alternates four and five, but a seat filled ` +
      `mid-term by appointment (Part IV S3) shifts the pattern — check the term register rather than the ` +
      `alternation.\n\n` +
      `Starting the cycle also schedules the AGM — a board meeting and a members-only event, held as a ` +
      `DRAFT. The date will be in the system without being announced; publish the event when the ` +
      `details are settled and that is what puts it in front of members and in the calendar.\n\n` +
      `One thing the software will not do for you: appoint the Nominating Committee (Part V S1 — that ` +
      `is the board's, annually). Worth doing at the same meeting.`,
    assignees: holder?.person_profile_id ? [holder.person_profile_id] : [],
    due_date: schedule.nominationsOpenAt,
    sort_order: ((last?.sort_order as number) ?? -1) + 1,
    source: "manual",
  });

  return {
    ...base,
    needed: true,
    created: !error,
    meetingDate: target.meeting_date as string,
    assignedTo:
      (holder?.profiles as { display_name: string } | null)?.display_name ??
      (holder ? "Executive Director" : null),
    note: error
      ? `Could not create the kickoff task: ${error.message}`
      : holder
        ? "Kickoff task created and assigned."
        : "Kickoff task created UNASSIGNED — no current Executive Director is recorded.",
  };
}

export type { Election };
