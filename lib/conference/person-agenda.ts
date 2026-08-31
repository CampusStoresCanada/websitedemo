import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, canManageOrganization, isGlobalAdmin } from "@/lib/auth/guards";
import { buildEntityGraph, ENTITY_SELECT } from "@/lib/conference/entity-rows";
import { resolveAccess } from "@/lib/conference/entity-commerce";
import {
  getConferenceScheduleTimeline,
  type ConferenceScheduleItem,
} from "@/lib/conference/schedule-service";
import { computePersonObligations } from "@/lib/conference/access";
import { grantTypesForKinds } from "@/lib/conference/entity-obligations";
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
  /** YYYY-MM-DD, or null when the schema has no date for this obligation. */
  dueOn: string | null;
  /** What an undated one is waiting on, in words. */
  waitingOn: string;
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
    .select("id, display_name, user_id, organization_id, registration_id, person_kind")
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

  const [{ data: seats }, { data: entityRows }, { data: refRows }] = await Promise.all([
    db
      .from("entity_balance_seats")
      .select("entity_id")
      .eq("conference_id", conferenceId)
      .eq("holder_person_id", personId),
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conferenceId),
  ]);

  const heldIds = new Set(
    (seats ?? []).map((s) => s.entity_id).filter((id): id is string => !!id)
  );
  const byId = new Map(buildEntityGraph(entityRows ?? [], refRows ?? []).map((e) => [e.id, e]));
  const entitled = resolveAccess(heldIds, byId);

  // An exhibitor's meetings hang off their exhibitor registration; a delegate's
  // off theirs. Getting this backwards shows someone an empty Meeting Block.
  const meetingRole = person.person_kind === "exhibitor" ? "exhibitor" : "delegate";
  const timeline = await getConferenceScheduleTimeline(conferenceId, {
    viewerRole: meetingRole === "exhibitor" ? "exhibitor" : "delegate",
    viewerRegistrationId: person.registration_id,
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
  const { data: confDates } = await db
    .from("conference_instances")
    .select("start_date, registration_close_at, hotel_booking_cutoff")
    .eq("id", conferenceId)
    .maybeSingle();
  const { data: fields } = await db
    .from("conference_people")
    .select("display_name, contact_email, dietary_restrictions, accessibility_needs, emergency_contact_name, emergency_contact_phone")
    .eq("id", personId)
    .maybeSingle();

  const status = computePersonObligations(
    grantTypesForKinds(heldKinds),
    (fields ?? {}) as Record<string, unknown>
  );
  const dates = {
    startDate: confDates?.start_date ?? null,
    registrationCloseAt: confDates?.registration_close_at ?? null,
    hotelBookingCutoff: confDates?.hotel_booking_cutoff ?? null,
  };
  const deadlines: AgendaDeadline[] = status.missing.map((o) => {
    const resolved = resolveObligationDeadline(o.deadline, dates);
    return {
      key: o.key,
      label: o.label,
      dueOn: resolved.dueOn,
      waitingOn: DEADLINE_WAITING_ON[resolved.symbol],
    };
  });
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
