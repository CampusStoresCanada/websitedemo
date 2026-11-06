/**
 * Self check-in, the database half. The rules live in self-check-in.ts.
 *
 * ⛔ Nothing here writes on its own: loading a check-in page (a GET, and one
 * Outlook's Safe Links opens before the attendee does) must never check anyone
 * in. The write is lib/actions/self-check-in.ts, behind a button.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { findBadgeTokenRow, deriveBadgeToken } from "@/lib/conference/badges/tokens";
import { ensureBadgeTokenRowIds } from "@/lib/conference/badges/token-rows";
import { loadBadgeIdentity } from "@/lib/conference/badges/label-document";
import { conferenceToday } from "@/lib/conference/desk-staff";
import {
  normalizeSelfCheckIn,
  selfCheckInEnabled,
  type SelfCheckInSettings,
} from "@/lib/conference/self-check-in";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * One conference's self check-in settings. ⚠️ A failed read is OFF, never on:
 * a conference that cannot say it allows self check-in does not allow it.
 */
export async function loadSelfCheckInSettings(conferenceId: string, db: AdminClient = createAdminClient()): Promise<SelfCheckInSettings> {
  const { data, error } = await db
    .from("conference_instances")
    .select("self_check_in")
    .eq("id", conferenceId)
    .maybeSingle();
  if (error || !data) return normalizeSelfCheckIn(null);
  return normalizeSelfCheckIn((data as { self_check_in?: unknown }).self_check_in);
}

export type SelfCheckInContext = {
  conferenceId: string;
  conferenceName: string;
  personId: string;
  firstName: string | null;
  lastName: string | null;
  checkedInAt: string | null;
  settings: SelfCheckInSettings;
  /** Phone check-in is open right now: switched on, and today is a conference day. */
  phoneOpen: boolean;
  /** Why it is not, for the page to say. */
  phoneClosedReason: "off" | "not_a_conference_day" | null;
};

/**
 * Who a check-in link is for, and whether they may use it now. Null for a code
 * that resolves to nobody (revoked, cancelled, mistyped): the page says only
 * that the link does not work, never whose it was.
 */
export async function resolveSelfCheckIn(token: string): Promise<SelfCheckInContext | null> {
  const db = createAdminClient();
  const tokenRow = await findBadgeTokenRow(db, { token });
  if (!tokenRow || tokenRow.revoked_at) return null;

  const { data: person } = await db
    .from("conference_people")
    .select("id, conference_id, checked_in_at, assignment_status, canonical_person_id, contact_email, assigned_email_snapshot, organization_id, display_name, user_id")
    .eq("id", tokenRow.person_id)
    .eq("conference_id", tokenRow.conference_id)
    .maybeSingle();
  if (!person || person.assignment_status === "canceled") return null;

  const conferenceId = person.conference_id as string;
  const { data: conference } = await db
    .from("conference_instances")
    .select("name, start_date, end_date")
    .eq("id", conferenceId)
    .maybeSingle();
  const settings = await loadSelfCheckInSettings(conferenceId, db);
  const identity = await loadBadgeIdentity(db, person as Record<string, unknown>);

  const today = await conferenceToday(conferenceId);
  const start = (conference?.start_date as string | null) ?? null;
  const end = (conference?.end_date as string | null) ?? start;
  const isConferenceDay = Boolean(start && end && today >= start && today <= end);
  const phoneClosedReason = !settings.phone ? "off" : !isConferenceDay ? "not_a_conference_day" : null;

  return {
    conferenceId,
    conferenceName: (conference?.name as string | null) ?? "the conference",
    personId: person.id as string,
    firstName: identity.names.firstName,
    lastName: identity.names.lastName,
    checkedInAt: (person.checked_in_at as string | null) ?? null,
    settings,
    phoneOpen: phoneClosedReason === null,
    phoneClosedReason,
  };
}

/**
 * The email's per-person check-in variables, for every person given, when the
 * conference has self check-in on. Off: an empty map, so the email carries no
 * QR and nothing is minted.
 *
 *   check_in_qr_url  an image of their QR code (the same code as their badge)
 *   check_in_link    the page that checks them in on their phone
 *
 * ⛔ The QR is the BADGE's code (badgeScanUrl), not a new kind of token: the
 * desk and the kiosk already scan it, and a second code would be a second
 * thing to revoke.
 */
export async function selfCheckInVariables(
  db: AdminClient,
  conferenceId: string | null | undefined,
  personIds: string[]
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  if (!conferenceId || personIds.length === 0) return out;
  const settings = await loadSelfCheckInSettings(conferenceId, db);
  if (!selfCheckInEnabled(settings)) return out;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const rowIds = await ensureBadgeTokenRowIds(db, conferenceId, personIds);
  for (const [personId, rowId] of rowIds) {
    if (!personIds.includes(personId)) continue;
    const token = deriveBadgeToken(conferenceId, rowId);
    out.set(personId, {
      check_in_qr_url: `${appUrl}/api/check-in/qr/${token}`,
      check_in_link: `${appUrl}/check-in/${token}`,
    });
  }
  return out;
}
