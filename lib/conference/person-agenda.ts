import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, canManageOrganization, isGlobalAdmin } from "@/lib/auth/guards";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { offerRequiresOwnershipOfEntityIds } from "@/lib/conference/ownership-gate";
import { resolveAccess } from "@/lib/conference/entity-commerce";
import {
  getConferenceScheduleTimeline,
  type ConferenceScheduleItem,
} from "@/lib/conference/schedule-service";
import { computePersonObligations } from "@/lib/conference/access";
import { grantTypesForKinds } from "@/lib/conference/entity-obligations";
import {
  PERSON_OBLIGATION_FIELDS,
  resolveObligationValues,
} from "@/lib/conference/person-fields";
import {
  DEADLINE_WAITING_ON,
  resolveObligationDeadline,
} from "@/lib/conference/obligation-deadlines";

/**
 * One person's conference, not the programme.
 *
 * The public schedule shows everything and gates by ROLE. That is the wrong
 * question for "what am I doing on Wednesday": Gloria at Miami Sound Machine
 * holds a Connected Exhibitor Staff Registration, and Big Ideas Day, the
 * Wednesday Offsite and both dinners are not hers — they hang off the member
 * product. Showing them on her agenda would make the programme masquerade as
 * her day.
 *
 * Entitlement comes from what she HOLDS, resolved through the graph rather than
 * from her registration type. Her twelve bundled meals arrive via `includes`;
 * a Meet & Greet ticket her manager buys her arrives as a seat she holds
 * directly. Same walk covers both, which is why adding that ticket needs no
 * special case anywhere.
 *
 * Deliberately NOT a recommender. Nothing here scores or ranks, and meeting
 * assignments are rendered exactly as the meetings engine produced them.
 */

export type AgendaItem = ConferenceScheduleItem & {
  /**
   * Why this is on her agenda:
   *   held    — she holds a seat on this thing itself (a bought ticket)
   *   granted — it came bundled with something she holds
   *   meeting — the scheduler assigned it to her
   */
  reason: "held" | "granted" | "meeting";
};

/**
 * Something the person owes, with a date where one exists.
 *
 * Distinct from the checklist tasks below it on the page, which they tick off
 * themselves. These are facts about them that only they can supply, and the
 * only place to enter them is Edit — so this block reports and points, it does
 * not offer controls of its own.
 */
export type AgendaDeadline = {
  key: string;
  label: string;
  /** YYYY-MM-DD, or null when nothing in the schema dates it. */
  dueOn: string | null;
  /** What an undated one is waiting on, in words. */
  waitingOn: string;
  /**
   * How it gets answered.
   *
   *   field  — a value only they can give (dietary, emergency contact). Opens
   *            the editor.
   *   answer — a question where "doesn't apply" is a complete answer (a hotel
   *            they booked elsewhere). Ticked in place.
   *   go     — something we can SEE whether they did, done by using a control
   *            elsewhere on the page (picking their top five). Never a tick: a
   *            tick can be ticked without doing it, so the task would read
   *            complete when it is not.
   *
   * The two are stored differently and always were — a column versus an
   * acknowledgement row — but that is a storage fact, not a reason to show a
   * person two separate lists of things they owe before the same conference.
   */
  how: "field" | "answer" | "go";
  /** For `go`: where the control lives, relative to this page, and its label. */
  href?: string;
  ctaLabel?: string;
  /** What changes on the date — the reason it matters, not just when. */
  hardensBecause?: string | null;
  /** For answers: the task, and where it currently stands. */
  taskId?: string;
  state?: "done" | "not_applicable" | "pending";
  description?: string;
};

export type PersonAgenda = {
  personId: string;
  displayName: string | null;
  timeZone: string;
  /** Ordered by day then start time, untimed items last within their day. */
  items: AgendaItem[];
  /** Day keys she has access to, in order — the spine of the view. */
  dayKeys: string[];
  /** Pairs that overlap in time. Rendered as a warning, never auto-resolved. */
  conflicts: Array<{ a: string; b: string }>;
  /** Outstanding only — a deadline you have met is not a deadline. */
  deadlines: AgendaDeadline[];
};

/**
 * A real clash — not one thing sitting inside another.
 *
 * Naive overlap reported fifteen conflicts on a four-day agenda, and every one
 * was containment: breakfast runs 8:00-9:30 and the welcome happens at 8:30
 * inside it; Trade Show Wednesday runs 9:00-17:00 and contains that entire
 * day. Those are backgrounds, not collisions, and flagging them trains people
 * to ignore the warning that matters.
 *
 * So a conflict is a PARTIAL overlap: they intersect and neither contains the
 * other. Equal boundaries are adjacency, not a clash.
 */
function conflicts(a: ConferenceScheduleItem, b: ConferenceScheduleItem): boolean {
  if (!a.startsAt || !b.startsAt || !a.endsAt || !b.endsAt) return false;
  if (!(a.startsAt < b.endsAt && b.startsAt < a.endsAt)) return false;
  const aContainsB = a.startsAt <= b.startsAt && a.endsAt >= b.endsAt;
  const bContainsA = b.startsAt <= a.startsAt && b.endsAt >= a.endsAt;
  return !aContainsB && !bContainsA;
}

export async function loadPersonAgenda(
  personId: string,
  conferenceId: string
): Promise<{ success: true; data: PersonAgenda } | { success: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: person } = await db
    .from("conference_people")
    .select("id, display_name, user_id, organization_id, person_kind, contact_id")
    .eq("id", personId)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  if (!person) return { success: false, error: "Person not found." };

  // Her, her org's admins, or CSC. Same three-way test the obligations use —
  // an OrgAdmin sending staff to a conference has to be able to see what they
  // are booked into.
  const isOwner = person.user_id === auth.ctx.userId;
  const managesOrg = person.organization_id
    ? canManageOrganization(auth.ctx, person.organization_id)
    : false;
  if (!isOwner && !managesOrg && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized to view this agenda." };
  }

  /**
   * One call, not three. This used to query entity_balance_seats,
   * conference_entities and conference_entity_refs by hand and rebuild the graph
   * — the twentieth such copy, which is the thing lib/conference/seats.ts exists
   * to stop. It was on the eslint gate's grandfathered list; migrating it here
   * means that exemption comes off.
   */
  const { seats, entitiesById: byId } = await loadSeatHoldings(db, {
    conferenceId,
    holderPersonId: personId,
  });

  const heldIds = new Set(seats.map((s) => s.entityId));
  const entitled = resolveAccess(heldIds, byId);

  /**
   * Her meetings hang off the SEAT she is named to, not off a registration row.
   *
   * `conference_people.registration_id` used to carry this. It pointed at
   * conference_registrations — 0 rows, no writer, the v2 person-monolith — so it
   * was null for every person and the meeting query it fed could only ever
   * return nothing.
   *
   * Which side of the table she sits on is a property of the TYPE she holds, not
   * a label on her: an exhibiting registration is one that
   * `requires_ownership_of` a booth. That is the same structural test the badge
   * pipeline uses, and it survives a conference inventing a third kind of
   * attendee — which `person_kind` (eight writers, all disagreeing) does not.
   */
  const meetingSeat = seats.find((s) => s.entityKind === "registration") ?? null;
  const meetingSeatEntity = meetingSeat ? byId.get(meetingSeat.entityId) : null;
  const isExhibitingSeat = meetingSeatEntity
    ? offerRequiresOwnershipOfEntityIds(meetingSeatEntity.refs).some(
        (id) => byId.get(id)?.kind === "booth"
      )
    : false;
  const meetingRole = isExhibitingSeat ? "exhibitor" : "delegate";
  const timeline = await getConferenceScheduleTimeline(conferenceId, {
    viewerRole: meetingRole,
    viewerSeatId: meetingSeat?.seatId ?? null,
    viewerMeetingRole: meetingRole,
  });

  const items: AgendaItem[] = [];
  for (const item of timeline.programItems) {
    if (!entitled.has(item.id)) continue;
    // A `day` is the spine of the view, not a row in it.
    if (item.kind === "day") continue;
    items.push({ ...item, reason: heldIds.has(item.id) ? "held" : "granted" });
  }
  // Already filtered to this person by the timeline's own registration test.
  for (const item of timeline.meetingAssignmentItems) {
    items.push({ ...item, reason: "meeting" });
  }

  items.sort((a, b) => {
    if (a.dayKeyLocal !== b.dayKeyLocal) return a.dayKeyLocal.localeCompare(b.dayKeyLocal);
    // Untimed things sink below the timed ones they sit among.
    if (!a.startsAt) return 1;
    if (!b.startsAt) return -1;
    return a.startsAt.localeCompare(b.startsAt) || a.displayOrder - b.displayOrder;
  });

  const clashes: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].dayKeyLocal !== items[j].dayKeyLocal) break;
      if (conflicts(items[i], items[j])) clashes.push({ a: items[i].id, b: items[j].id });
    }
  }

  // What she still owes, dated where the schema can answer. Same traversal as
  // the entitlement above — the meals bundled in a registration are what make
  // dietary her obligation, so the two must not resolve at different depths.
  const heldKinds = new Set<string>();
  for (const id of entitled) {
    const kind = byId.get(id)?.kind;
    if (kind) heldKinds.add(kind);
  }
  // Cast because lib/database.types.ts has not been regenerated since
  // catering_cutoff was added — and today it must not be. Four sessions share
  // this checkout and that file already carries another session's hand-edits;
  // a regeneration here would discard them. The column exists in the database;
  // the types are simply behind, and this is the pattern the rest of the
  // conference code already uses for exactly that gap.
  const { data: confDates } = (await db
    .from("conference_instances")
    .select("start_date, registration_close_at, hotel_booking_cutoff, catering_cutoff, badge_preprint_at")
    .eq("id", conferenceId)
    .maybeSingle()) as unknown as {
    data: {
      start_date: string | null;
      registration_close_at: string | null;
      hotel_booking_cutoff: string | null;
      catering_cutoff: string | null;
      badge_preprint_at: string | null;
    } | null;
  };
  const [{ data: fields }, { data: contact }] = await Promise.all([
    db.from("conference_people").select(PERSON_OBLIGATION_FIELDS.join(", "))
      .eq("id", personId).maybeSingle(),
    person.contact_id
      ? db.from("contacts").select("name, work_email, email")
          .eq("id", person.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const status = computePersonObligations(
    grantTypesForKinds(heldKinds),
    // Identity comes from the contact record when the projection is silent, so
    // we stop asking for an email we already hold.
    resolveObligationValues(fields as Record<string, unknown> | null, contact)
  );
  const dates = {
    startDate: confDates?.start_date ?? null,
    registrationCloseAt: confDates?.registration_close_at ?? null,
    hotelBookingCutoff: confDates?.hotel_booking_cutoff ?? null,
    cateringCutoff: confDates?.catering_cutoff ?? null,
    badgePreprintAt: confDates?.badge_preprint_at ?? null,
  };
  const deadlines: AgendaDeadline[] = status.missing.map((o) => {
    const resolved = resolveObligationDeadline(o.deadline, dates);
    return {
      key: o.key,
      label: o.label,
      dueOn: resolved.dueOn,
      waitingOn: DEADLINE_WAITING_ON[resolved.symbol],
      how: "field" as const,
    };
  });

  // The person's own check-ins join the same list. Lodging is not a different
  // KIND of thing to owe before a conference just because "I'm staying with
  // family" is a complete answer to it — that difference belongs in the
  // control, not in a second section further down the page.
  const { loadPersonalTasks } = await import("@/lib/conference/checklist-tasks");
  const { getPersonTaskDestination } = await import("@/lib/conference/checklist-cta");
  for (const task of await loadPersonalTasks(db, conferenceId, personId)) {
    if (task.state !== "pending") continue;
    /**
     * A monitored task is answered by USING a control, not by ticking. Point at
     * the control; the state comes from the check either way, so there is
     * nothing here for them to confirm.
     */
    const destination =
      task.source === "monitored" ? getPersonTaskDestination(task.checkType as never) : null;
    deadlines.push({
      key: `task:${task.taskId}`,
      label: task.name,
      description: task.description,
      // A checklist deadline is a DAY stored at UTC midnight; the date part is
      // the answer and re-reading it in a timezone loses one.
      dueOn: task.deadline ? task.deadline.slice(0, 10) : null,
      waitingOn: "before the conference",
      how: destination ? ("go" as const) : ("answer" as const),
      href: destination?.path,
      ctaLabel: destination?.label,
      taskId: task.taskId,
      state: task.state,
      hardensBecause: task.hardensBecause,
    });
  }
  // Dated first, soonest first; undated last rather than sorted to the top by
  // an empty string.
  deadlines.sort((a, b) => {
    if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn);
    if (a.dueOn) return -1;
    if (b.dueOn) return 1;
    return a.label.localeCompare(b.label);
  });

  return {
    success: true,
    data: {
      personId,
      deadlines,
      displayName: person.display_name,
      timeZone: timeline.timeZone,
      items,
      dayKeys: [...new Set(items.map((i) => i.dayKeyLocal))].sort(),
      conflicts: clashes,
    },
  };
}
