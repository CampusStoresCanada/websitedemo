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
 * Today the AGM is the only one. By-Law Part VII contemplates other meetings of
 * the members, and `meeting_type` is a free text column, so adding one is an
 * entry here plus a label below.
 *
 * ⚠️ `"special"` is deliberately NOT in this list. It already means a special
 * meeting of the BOARD in `POST /api/admin/board/meetings`, and reading one
 * value as two different kinds of meeting is how the AGM got lost in the board
 * meeting list in the first place. A special members' meeting needs its own
 * value when it is first called.
 */
export const MEMBERS_MEETING_TYPES = ["agm"] as const;

export type MembersMeetingType = (typeof MEMBERS_MEETING_TYPES)[number];

export const MEMBERS_MEETING_LABELS: Record<MembersMeetingType, string> = {
  agm: "Annual General Meeting",
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

/**
 * The event columns a venue choice implies. Returns `null` for a field the
 * choice clears, so a meeting moved online does not keep last year's hotel
 * address sitting on the record.
 */
export function venueFields(
  venue: MeetingVenue,
  input: { location?: string | null; virtualLink?: string | null }
): { is_virtual: boolean; location: string | null; virtual_link: string | null } {
  const location = input.location?.trim() || null;
  const virtualLink = input.virtualLink?.trim() || null;

  switch (venue) {
    case "virtual":
      return { is_virtual: true, location: null, virtual_link: virtualLink };
    case "in_person":
      return { is_virtual: false, location, virtual_link: null };
    case "hybrid":
      return { is_virtual: true, location, virtual_link: virtualLink };
  }
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
}

export interface MembersMeeting {
  id: string;
  meetingDate: string;
  meetingType: string;
  title: string;
  status: string;
  notes: string | null;
  hasAgenda: boolean;
  hasMinutes: boolean;
  documentCount: number;
  /** Proxies still standing — a revoked one is not representation. */
  proxyCount: number;
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
