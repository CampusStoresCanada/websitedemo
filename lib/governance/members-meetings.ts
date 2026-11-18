/**
 * Members' meetings — the one answer to "which meeting is a meeting OF THE
 * MEMBERS", plus the shapes and derivations that go with it.
 *
 * Pure: no database, no server-only imports, safe for a client component.
 * Reading them out of the database is `members-meetings-service.ts`.
 *
 * A members' meeting is not a board meeting. Different people attend (every
 * member institution, not the nine directors), different rules govern it
 * (By-Law Part VII, not Part IV), and different business happens at it —
 * directors are elected, the financial statements are presented, proxies are
 * exercised. It has lived in the `board_meetings` table since the table was
 * the only place a meeting could live, and the AGM has been reachable only as
 * a side effect of opening an election. Both of those are history, not design.
 *
 * ⚠️ The table stays. `meeting_date`, `agenda_html`, `minutes_html`,
 * `board_documents.meeting_id`, `meeting_proxies.meeting_id` and
 * `board_action_items` all hang off that row, and every one of them is
 * correct — a members' meeting really does have an agenda, minutes, documents
 * and actions. What moves is the SURFACE, not the store. Read
 * `MEMBERS_MEETING_TYPES` rather than writing `meeting_type = 'agm'` again, so
 * that the day a special members' meeting is called it is one line here and
 * not a hunt through five files.
 */

// ─── Which meetings are members' meetings ────────────────────────────────────

/**
 * The AGM is the standing one; `special_members` is a meeting of the members
 * called for a particular purpose (By-Law Part VII S3).
 *
 * ⚠️ `"special"` is deliberately NOT in this list. It already means a special
 * meeting of the BOARD in `POST /api/admin/board/meetings`, and reading one
 * value as two different kinds of meeting is how the AGM got lost in the board
 * meeting list in the first place. That is why the members' one is spelled
 * `special_members` rather than reusing it.
 *
 * ⛔ `board_meetings.meeting_type` is CHECK-constrained, not free text — adding
 * a value here alone does nothing. The constraint allows
 * ('regular','special','agm','special_members') as of the 2026-11-18 migration.
 */
export const MEMBERS_MEETING_TYPES = ["agm", "special_members"] as const;

export type MembersMeetingType = (typeof MEMBERS_MEETING_TYPES)[number];

export const MEMBERS_MEETING_LABELS: Record<MembersMeetingType, string> = {
  agm: "Annual General Meeting",
  special_members: "Special Meeting of the Members",
};

/** What the board is actually deciding when it calls one. */
export const MEMBERS_MEETING_DESCRIPTIONS: Record<MembersMeetingType, string> = {
  agm: "The standing annual meeting. Directors are elected at it, the financial statements are presented, and proxies are exercised.",
  special_members:
    "Called for a particular purpose — only the business in the notice may be transacted. No election is opened for it unless the board calls one.",
};

export function isMembersMeetingType(value: string): value is MembersMeetingType {
  return (MEMBERS_MEETING_TYPES as readonly string[]).includes(value);
}

// ─── The event's slug ────────────────────────────────────────────────────────

/**
 * The AGM event's slug, by convention and by year.
 *
 * ⛔ This is load-bearing and must never drift. `sendAgmNotice` looks the event
 * up by this exact slug to check it is published before it will send notice,
 * and puts `/events/<slug>` in the notice itself — a slug change turns notice
 * already given into a dead link, which is defective notice under Part VII
 * S4(b). It was spelled out literally in three places before this function
 * existed; `updateEvent` re-derives a slug from the title whenever `starts_at`
 * changes, so any writer touching the time MUST pin the slug by passing it
 * through explicitly.
 */
export function agmEventSlug(cycleYear: number): string {
  return `csc-annual-general-meeting-${cycleYear}`;
}

// ─── Where the meeting is held ───────────────────────────────────────────────

/**
 * How a members' meeting is attended. The events table has no `venue` column —
 * it has `is_virtual` and `location`, and the pair of them says which of the
 * three this is. Derived rather than stored so there is nothing to keep in
 * step.
 */
/**
 * The event slug for any members' meeting.
 *
 * ⛔ The AGM keeps `agmEventSlug` exactly — `sendAgmNotice` looks it up by that
 * literal convention and the slug is inside notice already given. A special
 * members' meeting cannot use a per-YEAR slug: two could be called in one year,
 * and `events.slug` is unique. It is keyed by the DATE instead, which
 * `board_meetings.meeting_date` already guarantees is unique.
 */
export function membersMeetingEventSlug(
  type: MembersMeetingType,
  meetingDate: string
): string {
  if (type === "agm") return agmEventSlug(Number(meetingDate.slice(0, 4)));
  return `csc-special-members-meeting-${meetingDate}`;
}

/** What the meeting row is titled when it is created. */
export function membersMeetingTitle(
  type: MembersMeetingType,
  meetingDate: string
): string {
  return type === "agm"
    ? `CSC Annual General Meeting — ${meetingDate}`
    : `CSC Special Meeting of the Members — ${meetingDate}`;
}

export type MeetingVenue = "virtual" | "in_person" | "hybrid";

export const VENUE_LABELS: Record<MeetingVenue, string> = {
  virtual: "Online only",
  in_person: "In person only",
  hybrid: "In person and online",
};

export function venueOf(input: {
  isVirtual: boolean | null;
  location: string | null;
}): MeetingVenue {
  const hasPlace = !!input.location?.trim();
  if (input.isVirtual && hasPlace) return "hybrid";
  if (input.isVirtual) return "virtual";
  return "in_person";
}


// ─── What a members' meeting looks like once read ────────────────────────────

export interface MembersMeetingEvent {
  id: string;
  slug: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  isVirtual: boolean | null;
  location: string | null;
  virtualLink: string | null;
  audienceMode: string | null;
  googleEventId: string | null;
}

export interface MembersMeetingElection {
  slug: string;
  cycleYear: number;
  status: string;
  seatsAvailable: number | null;
  /**
   * `elections.agm_date` — the date the nomination, ballot and notice windows
   * were DERIVED from, frozen at kickoff. ⚠️ NOT the day the meeting sits: read
   * that off the meeting. When the two differ the meeting has moved and the
   * windows have not — see `meetingDivergence`.
   */
  windowsDerivedFrom: string;
}

export interface MembersMeeting {
  id: string;
  meetingDate: string;
  meetingType: string;
  title: string;
  status: string;
  notes: string | null;
  /**
   * The business to be transacted, as stated in the notice (By-Law Part VII).
   *
   * ⛔ Only the business in the notice may be transacted at a SPECIAL meeting of
   * the members, so one cannot be properly called until this is written. Null
   * for an AGM, whose business the by-law fixes — there is nothing for a person
   * to supply. Distinct from `notes`, which is the board's internal note; this
   * is what members are entitled to read.
   */
  purpose: string | null;
  hasAgenda: boolean;
  hasMinutes: boolean;
  documentCount: number;
  /** Proxies still standing — a revoked one is not representation. */
  proxyCount: number;
  /**
   * What has gone out for this meeting. ⛔ Lives on the meeting, not on the
   * election — see `recordMembersMeetingSend`. A members' meeting with no
   * election still has notice and a proxy deadline to discharge.
   */
  noticeSentAt: string | null;
  proxyFormSentAt: string | null;
  packageSentAt: string | null;
  packageSendCount: number;
  event: MembersMeetingEvent | null;
  /** The election whose AGM is this meeting, matched on the date. */
  election: MembersMeetingElection | null;
}

/**
 * What still has to happen before this meeting is properly called.
 *
 * Deliberately a plain derived list and not a task mint — `lib/elections/
 * action-items.ts` already owns putting dated obligations on the board's list,
 * and a second thing writing tasks for the same meeting would be two systems
 * for one verb. This is a display: it tells the person looking at the page what
 * is missing, and nothing else.
 */
export function membersMeetingGaps(meeting: MembersMeeting): string[] {
  const gaps: string[] = [];
  if (meeting.status === "cancelled") return gaps;

  // ⛔ A special meeting of the members with no stated business cannot be
  // properly called: By-Law Part VII allows only the business set out in the
  // notice to be transacted, so a notice with nothing in it discharges the
  // obligation while permitting nothing. Not asked of an AGM, whose business
  // the by-law fixes.
  if (meeting.meetingType === "special_members" && !meeting.purpose?.trim()) {
    gaps.push(
      "No business is stated. Only what the notice says may be transacted at a special meeting, so write what this one is for."
    );
  }

  if (!meeting.event) {
    gaps.push("There is no event page for members to look at.");
    return gaps;
  }
  if (!meeting.event.startsAt) {
    gaps.push("The start time is not set.");
  }
  if (meeting.event.status === "draft") {
    gaps.push(
      "The event page is a draft, so members cannot see it and notice would link to nothing."
    );
  }
  const venue = venueOf(meeting.event);
  if (venue === "in_person" && !meeting.event.location?.trim()) {
    gaps.push("No address is set for an in-person meeting.");
  }
  if (venue !== "in_person" && !meeting.event.virtualLink?.trim() && !meeting.event.googleEventId) {
    gaps.push("No joining link yet — publishing the event mints one.");
  }
  return gaps;
}

// ─── The date is governance, not an event detail ─────────────────────────────

/**
 * The zone a meeting of the members is CALLED in.
 *
 * ⚠️ Not the reader's zone and not the server's. The AGM is convened in
 * Eastern — that is the anchor the board sets the hour in — so the calendar day
 * a meeting "is on" has to be worked out in Eastern too. A 7 p.m. Eastern
 * meeting is 00:00 UTC the NEXT day; deriving the date from the UTC portion of
 * `starts_at` would put it on the wrong day and silently unhook it from the
 * election, which joins on `meeting_date`.
 *
 * Reading times back for a person is a different job and belongs to
 * `LocalDate`, which renders in whatever zone the reader is in.
 */
export const MEMBERS_MEETING_TIME_ZONE = "America/Toronto";

/**
 * The calendar date a meeting sits on, in the zone it is called in.
 *
 * `starts_at` is stored as UTC (see `parseUTC` in `lib/utils.ts`); this maps it
 * back to the day the board means by it.
 */
export function meetingDateOf(startsAtUtcIso: string): string | null {
  const normalized =
    startsAtUtcIso.endsWith("Z") || startsAtUtcIso.includes("+")
      ? startsAtUtcIso
      : startsAtUtcIso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA with an explicit zone yields YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MEMBERS_MEETING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** The wall-clock time ("HH:mm") a meeting starts at, in the zone it is called in. */
export function wallTimeAtMeetingZone(startsAtUtcIso: string): string | null {
  const normalized =
    startsAtUtcIso.endsWith("Z") || startsAtUtcIso.includes("+")
      ? startsAtUtcIso
      : startsAtUtcIso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MEMBERS_MEETING_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * The UTC instant of a given wall-clock time on a given day, in the zone the
 * meeting is called in. Used when a meeting MOVES: the board means "still noon
 * Eastern, a week later", not "the same UTC instant plus seven days".
 *
 * ⚠️ Solved by trying both Eastern offsets and keeping whichever round-trips,
 * rather than assuming one. A move across the March or November boundary
 * changes the offset, and assuming -5 would quietly shift the meeting an hour.
 * Returns null for a wall time that does not exist on that day (the spring
 * forward gap), which the caller reports rather than guessing at.
 */
export function instantAtMeetingZone(date: string, wallTime: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(wallTime)) return null;

  for (const offsetHours of [5, 4]) {
    const guess = new Date(`${date}T${wallTime}:00.000Z`);
    guess.setUTCHours(guess.getUTCHours() + offsetHours);
    if (
      meetingDateOf(guess.toISOString()) === date &&
      wallTimeAtMeetingZone(guess.toISOString()) === wallTime
    ) {
      return guess.toISOString();
    }
  }
  return null;
}

// ─── When the meeting and its election disagree ─────────────────────────────

/**
 * Whether an election's windows were derived from a different day than the one
 * its meeting now sits on, in words.
 *
 * ⛔ This is what the `elections.meeting_id` foreign key is FOR. The two dates
 * are not the same fact:
 *
 *   `board_meetings.meeting_date` — when the meeting IS. The board may move it.
 *   `elections.agm_date`          — the date the nomination, ballot and notice
 *                                   windows were DERIVED from, frozen at
 *                                   kickoff so that moving the AGM can never
 *                                   retroactively reopen a closed window.
 *
 * While equality of those values was the only link, a meeting that moved made
 * the join find nothing — and "no election is bound to this meeting" read
 * exactly like "the election is out of step with its meeting". The system went
 * quiet at the moment it should have been loudest. The relation makes the
 * disagreement visible; this says it.
 *
 * Returns null when they agree, which is the normal case.
 */
export function meetingDivergence(input: {
  meetingDate: string;
  election: { cycleYear: number; windowsDerivedFrom: string } | null;
}): string | null {
  if (!input.election) return null;
  if (input.election.windowsDerivedFrom === input.meetingDate) return null;

  return (
    `This meeting now sits on ${input.meetingDate}, but the ${input.election.cycleYear} ` +
    `election's windows were set from ${input.election.windowsDerivedFrom}. Notice, ` +
    `nominations and the ballot are all still measured from the old date, so every date in ` +
    `the list below is wrong until the election's schedule is re-derived — and notice may ` +
    `already have been given stating the old day.`
  );
}
