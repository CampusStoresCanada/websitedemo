/**
 * Who may run a conference's check-in desk, today.
 *
 * ⛔ ONE answer, asked by every desk door: the /admin gate, the desk and war
 * room pages, the storefront and seat actions, the roster. A volunteer or temp
 * is appointed on the Access page to `conference.desk_staff` FOR a conference,
 * optionally for specific days — Suzie can work Wednesday at Conference 2027
 * and Thursday at Big Ideas Day as two appointments, and neither opens the
 * other's desk.
 *
 * ⛔ "Today" is the CONFERENCE's date, in its own time zone. The view's
 * `is_active` uses the database's CURRENT_DATE (UTC), which would end a
 * Wednesday-only shift at 7–8pm Ontario time. So this reads the terms and
 * compares them itself.
 *
 * Global admins never need an appointment; callers check them first.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { CAPABILITIES } from "@/lib/auth/capability-names";
import { isoDateInZone } from "@/lib/conference/tz";

export const DESK_STAFF_CAPABILITY = CAPABILITIES.CONFERENCE_DESK_STAFF;

const DEFAULT_TIME_ZONE = "America/Toronto";

export type DeskTerm = { termStart: string; termEnd: string | null };

/** One desk appointment as stored. */
export type DeskAppointment = {
  /** NULL: permanent staff — every conference, no end date. */
  conferenceId: string | null;
  termStart: string;
  /** NULL: blank days — follows the conference's own dates. */
  termEnd: string | null;
};

/** The conference's dates, read fresh every time. */
export type DeskWindow = {
  /** Registration opening, as a date at the venue. NULL: no lower bound. */
  opensOn: string | null;
  /** The conference's last day. NULL: no upper bound. */
  lastDay: string | null;
};

/**
 * Is this appointment in force today?
 *
 *   PERMANENT (no conference)  always.
 *   DAYS (an end date)         today is in [start, end). The end is EXCLUSIVE:
 *                              a Wednesday-only shift is { Wed, Thu }.
 *   BLANK (no end date)        from registration opening (or the day they were
 *                              added, if later) to the conference's last day —
 *                              read from the conference NOW, so moving its
 *                              dates moves the access with them.
 */
export function deskAppointmentActive(
  appointment: DeskAppointment,
  window: DeskWindow,
  today: string
): boolean {
  if (appointment.conferenceId === null) return true;
  if (appointment.termEnd !== null) {
    return appointment.termStart <= today && appointment.termEnd > today;
  }
  const from =
    window.opensOn && window.opensOn > appointment.termStart ? window.opensOn : appointment.termStart;
  if (today < from) return false;
  return window.lastDay === null || today <= window.lastDay;
}

/** The day after an ISO date, for an exclusive end. */
export function nextIsoDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type ConferenceDates = {
  id: string;
  name: string;
  timezone: string | null;
  registration_open_at: string | null;
  end_date: string | null;
};

function windowAndToday(conference: ConferenceDates, now: Date): { window: DeskWindow; today: string } {
  const tz = conference.timezone || DEFAULT_TIME_ZONE;
  return {
    today: isoDateInZone(now, tz),
    window: {
      opensOn: conference.registration_open_at
        ? isoDateInZone(new Date(conference.registration_open_at), tz)
        : null,
      lastDay: conference.end_date,
    },
  };
}

const CONFERENCE_DATES = "id, name, timezone, registration_open_at, end_date";

/** Today at the conference, in its own time zone. */
export async function conferenceToday(conferenceId: string, now: Date = new Date()): Promise<string> {
  const db = createAdminClient();
  const { data } = await db
    .from("conference_instances")
    .select("timezone")
    .eq("id", conferenceId)
    .maybeSingle();
  return isoDateInZone(now, data?.timezone || DEFAULT_TIME_ZONE);
}

/** This person's desk appointments: for this conference, or permanent. */
async function appointmentsFor(profileId: string, conferenceId?: string): Promise<DeskAppointment[]> {
  const db = createAdminClient();
  let query = db
    .from("capability_contributions")
    .select("conference_id, term_start, term_end")
    .eq("subject_id", profileId)
    .eq("capability", DESK_STAFF_CAPABILITY);
  if (conferenceId) query = query.or(`conference_id.eq.${conferenceId},conference_id.is.null`);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r) => ({
    conferenceId: (r.conference_id as string | null) ?? null,
    termStart: r.term_start as string,
    termEnd: (r.term_end as string | null) ?? null,
  }));
}

/**
 * Does this person hold desk staff for this conference today?
 *
 * ⛔ Never throws: a failed read is "no", and the door stays shut.
 */
export async function holdsDeskStaff(profileId: string, conferenceId: string): Promise<boolean> {
  try {
    const db = createAdminClient();
    const [appointments, { data: conference }] = await Promise.all([
      appointmentsFor(profileId, conferenceId),
      db.from("conference_instances").select(CONFERENCE_DATES).eq("id", conferenceId).maybeSingle(),
    ]);
    if (!conference || appointments.length === 0) return false;
    const { window, today } = windowAndToday(conference as ConferenceDates, new Date());
    return appointments.some((a) => deskAppointmentActive(a, window, today));
  } catch {
    return false;
  }
}

/**
 * The conferences whose desk this person can run today — for the link on
 * their own account page. Permanent staff see every conference that is on
 * (registration open to its last day). Empty for nearly everyone.
 */
export async function deskConferencesFor(
  profileId: string
): Promise<Array<{ conferenceId: string; name: string }>> {
  try {
    const appointments = await appointmentsFor(profileId);
    if (appointments.length === 0) return [];
    const permanent = appointments.some((a) => a.conferenceId === null);

    const db = createAdminClient();
    let query = db.from("conference_instances").select(CONFERENCE_DATES);
    if (!permanent) {
      query = query.in("id", [...new Set(appointments.map((a) => a.conferenceId as string))]);
    }
    const { data: conferences } = await query;

    const now = new Date();
    return ((conferences ?? []) as ConferenceDates[])
      .filter((c) => {
        const { window, today } = windowAndToday(c, now);
        return appointments.some((a) =>
          a.conferenceId === null
            ? // Permanent staff: only conferences that are actually on.
              deskAppointmentActive({ conferenceId: c.id, termStart: today, termEnd: null }, window, today)
            : a.conferenceId === c.id && deskAppointmentActive(a, window, today)
        );
      })
      .map((c) => ({ conferenceId: c.id, name: c.name }));
  } catch {
    return [];
  }
}

/**
 * What adding someone as desk staff does to their link to the staff
 * organisation's end date.
 *
 * ⛔ The trap: an ACTIVE link with no end date is a permanent staffer
 * (Carolyn). Adding her to a desk must never give her one, ticked box or not —
 * that would schedule her removal from staff. Only a link we just created or
 * reactivated, or one that already ends, gets a date.
 *
 *   permanent ticked                  → clear any end date
 *   new or reactivated link           → ends the day after their last day
 *   active link that already ends     → pushed later, never earlier
 *   active link with no end date      → left alone
 */
export function staffLinkEndDecision(params: {
  linkBefore: { status: string; expires_at: string | null } | null;
  permanent: boolean;
  /** Their last day at this desk (or the conference's last day). Null: unknown. */
  lastDayWorked: string | null;
}): { action: "clear" } | { action: "set"; endsOn: string } | { action: "keep" } {
  const { linkBefore, permanent, lastDayWorked } = params;
  if (permanent) return { action: "clear" };
  const isNew = !linkBefore || linkBefore.status !== "active";
  if (!isNew && linkBefore.expires_at === null) return { action: "keep" };
  if (!lastDayWorked) return { action: "keep" };
  const endsOn = nextIsoDate(lastDayWorked);
  if (!isNew && linkBefore.expires_at && linkBefore.expires_at >= endsOn) return { action: "keep" };
  return { action: "set", endsOn };
}
