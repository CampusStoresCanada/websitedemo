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

/**
 * Is `today` inside any of these terms? `termEnd` is EXCLUSIVE, as everywhere
 * in governance_role_assignments: a Wednesday-only shift is
 * { termStart: Wed, termEnd: Thu }.
 */
export function deskTermsCover(terms: DeskTerm[], today: string): boolean {
  return terms.some((t) => t.termStart <= today && (t.termEnd === null || t.termEnd > today));
}

/** The day after an ISO date, for an exclusive end. */
export function nextIsoDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The term for an appointment made with no days chosen: from registration
 * opening to the conference's last day.
 *
 * ⚠️ Worked out when the appointment is MADE and stored, so the Access page
 * shows a real end date and the appointment expires like every other one. If
 * the conference's dates move afterwards, extend the appointment there.
 * Starts no earlier than `today` — an appointment cannot begin in the past.
 */
export function defaultDeskTerm(
  conference: { registration_open_at: string | null; end_date: string | null; timezone: string | null },
  today: string
): DeskTerm | null {
  if (!conference.end_date) return null;
  const tz = conference.timezone || DEFAULT_TIME_ZONE;
  const opens = conference.registration_open_at
    ? isoDateInZone(new Date(conference.registration_open_at), tz)
    : today;
  return { termStart: opens > today ? opens : today, termEnd: nextIsoDate(conference.end_date) };
}

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

/**
 * Does this person hold desk staff for this conference today?
 *
 * ⛔ Never throws: a failed read is "no", and the door stays shut.
 */
export async function holdsDeskStaff(profileId: string, conferenceId: string): Promise<boolean> {
  try {
    const db = createAdminClient();
    const [{ data: rows, error }, today] = await Promise.all([
      db
        .from("capability_contributions")
        .select("term_start, term_end")
        .eq("subject_id", profileId)
        .eq("capability", DESK_STAFF_CAPABILITY)
        .eq("conference_id", conferenceId),
      conferenceToday(conferenceId),
    ]);
    if (error || !rows) return false;
    return deskTermsCover(
      rows.map((r) => ({ termStart: r.term_start as string, termEnd: (r.term_end as string | null) ?? null })),
      today
    );
  } catch {
    return false;
  }
}

/**
 * The conferences whose desk this person can run today — for the link on
 * their own account page. Empty for nearly everyone.
 */
export async function deskConferencesFor(
  profileId: string
): Promise<Array<{ conferenceId: string; name: string }>> {
  try {
    const db = createAdminClient();
    const { data: rows } = await db
      .from("capability_contributions")
      .select("conference_id, term_start, term_end")
      .eq("subject_id", profileId)
      .eq("capability", DESK_STAFF_CAPABILITY)
      .not("conference_id", "is", null);
    if (!rows || rows.length === 0) return [];

    const ids = [...new Set(rows.map((r) => r.conference_id as string))];
    const { data: conferences } = await db
      .from("conference_instances")
      .select("id, name, timezone")
      .in("id", ids);

    const now = new Date();
    return (conferences ?? [])
      .filter((c) => {
        const today = isoDateInZone(now, (c.timezone as string | null) || DEFAULT_TIME_ZONE);
        return deskTermsCover(
          rows
            .filter((r) => r.conference_id === c.id)
            .map((r) => ({ termStart: r.term_start as string, termEnd: (r.term_end as string | null) ?? null })),
          today
        );
      })
      .map((c) => ({ conferenceId: c.id as string, name: c.name as string }));
  } catch {
    return [];
  }
}
