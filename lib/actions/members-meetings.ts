"use server";

/**
 * Setting up a members' meeting.
 *
 * ⚠️ This file creates nothing of its own. The meeting row and its draft event
 * are made by `ensureAgmMeetingAndEvent`, which has always done it — it was
 * simply only reachable as a side effect of opening an election. The event's
 * details are written by `updateEvent` and published by `transitionEventStatus`,
 * the same two functions the Events admin uses, so a members' meeting's event
 * mints its Google Meet link and syncs to Circle exactly like any other event.
 * What is new here is the ORDER: you set the meeting up, and the election is
 * opened for it, instead of the meeting appearing because an election was
 * opened.
 *
 * ⛔ A "use server" file may only export async functions. Labels, venue
 * helpers and the slug live in `lib/governance/members-meetings.ts`; exporting
 * a const from here type-checks, builds, and 500s every page that imports it.
 */

import { revalidatePath } from "next/cache";
import { getServerAuthState } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateEvent, transitionEventStatus } from "@/lib/actions/events";
import { ensureAgmMeetingAndEvent } from "@/lib/elections/cycle";
import { logAuditEventSafe } from "@/lib/ops/audit";
import {
  agmEventSlug,
  isMembersMeetingType,
  venueFields,
  type MeetingVenue,
} from "@/lib/governance/members-meetings";
import { getMembersMeeting } from "@/lib/governance/members-meetings-service";

export type ActionResult = { ok: true; meetingId?: string } | { ok: false; error: string };

async function requireBoardStaff() {
  const auth = await getServerAuthState();
  if (!auth.user) return { ok: false as const, error: "Please sign in." };
  if (auth.globalRole !== "admin" && auth.globalRole !== "super_admin")
    return { ok: false as const, error: "Only the board or association staff can do this." };
  return { ok: true as const, userId: auth.user.id };
}

function isVenue(value: string): value is MeetingVenue {
  return value === "virtual" || value === "in_person" || value === "hybrid";
}

function revalidate(meetingId?: string) {
  revalidatePath("/admin/members-meetings");
  if (meetingId) revalidatePath(`/admin/members-meetings/${meetingId}`);
  revalidatePath("/admin/board/meetings");
  revalidatePath("/admin/events");
  revalidatePath("/events");
}

/**
 * Schedule a members' meeting, or change the one that is already scheduled.
 *
 * The date, the times and the place are the four things a person knows and the
 * system cannot work out — the board picks when and where it sits. Everything
 * else is derived: the title, the event's slug, its members-only audience, and
 * the type.
 *
 * ⛔ `slug` is passed to `updateEvent` on purpose. That function re-derives the
 * slug from the title whenever `starts_at` changes, and the AGM notice looks
 * the event up by `agmEventSlug(year)` to check it is published — letting the
 * slug drift would turn a notice already sent into a dead link. See
 * `agmEventSlug`.
 */
export async function scheduleMembersMeetingAction(formData: FormData): Promise<ActionResult> {
  const auth = await requireBoardStaff();
  if (!auth.ok) return auth;

  const meetingId = String(formData.get("meetingId") ?? "").trim() || null;
  const meetingDate = String(formData.get("meetingDate") ?? "").trim();
  const startsAt = String(formData.get("startsAt") ?? "").trim();
  const endsAt = String(formData.get("endsAt") ?? "").trim();
  const venueRaw = String(formData.get("venue") ?? "").trim();
  const location = String(formData.get("location") ?? "");
  const virtualLink = String(formData.get("virtualLink") ?? "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate))
    return { ok: false, error: "Pick the date the meeting is held." };
  if (!isVenue(venueRaw))
    return { ok: false, error: "Say whether the meeting is in person, online, or both." };
  if (!startsAt) return { ok: false, error: "Set the time the meeting starts." };
  if (endsAt && endsAt <= startsAt)
    return { ok: false, error: "The meeting cannot end before it starts." };

  const venue = venueRaw;
  const fields = venueFields(venue, { location, virtualLink });
  if (venue !== "virtual" && !fields.location)
    return { ok: false, error: "An in-person meeting needs an address." };

  const db = createAdminClient();

  // A meeting already on that date that is NOT a members' meeting is a
  // collision, not a match. `ensureAgmMeetingAndEvent` keys on `meeting_date`
  // and would hand back the regular board meeting sitting there, and this
  // would then hang the members-only AGM event off it.
  const { data: clash } = await db
    .from("board_meetings")
    .select("id, meeting_type, title")
    .eq("meeting_date", meetingDate)
    .maybeSingle();

  if (clash && !isMembersMeetingType(clash.meeting_type as string)) {
    return {
      ok: false,
      error:
        `${clash.title} is already recorded on ${meetingDate} as a "${clash.meeting_type}" ` +
        `meeting. Move or retype that one first — two meetings cannot share a date.`,
    };
  }
  if (clash && meetingId && clash.id !== meetingId) {
    return {
      ok: false,
      error: `Another members' meeting is already recorded on ${meetingDate}.`,
    };
  }

  // Changing the DATE once an election is running is not an edit, it is moving
  // the meeting the whole election schedule is derived from — the nomination
  // window, the ballot window and the Part VII S4(b) notice window are all
  // measured back from it, and notice may already be out stating the old date.
  // Refused here rather than quietly re-deriving under people who have been
  // told something else.
  if (meetingId) {
    const existing = await getMembersMeeting(meetingId);
    if (!existing) return { ok: false, error: "That members' meeting no longer exists." };

    if (existing.meetingDate !== meetingDate && existing.election) {
      return {
        ok: false,
        error:
          `The ${existing.election.cycleYear} election (${existing.election.status}) is built on ` +
          `${existing.meetingDate}: its nomination, ballot and notice windows are all measured ` +
          `back from that date. Moving the meeting means re-deriving the election schedule, so do ` +
          `it from the election rather than here.`,
      };
    }

    if (existing.meetingDate !== meetingDate) {
      const { error } = await db
        .from("board_meetings")
        .update({ meeting_date: meetingDate, updated_at: new Date().toISOString() })
        .eq("id", meetingId);
      if (error) return { ok: false, error: `The date could not be changed: ${error.message}` };
    }
  }

  // Create-or-find. Idempotent on `meeting_date`: the meeting and its draft
  // event already exist if an election opened first, and this binds to them.
  const cycleYear = Number(meetingDate.slice(0, 4));
  const ensured = await ensureAgmMeetingAndEvent({
    agmDate: meetingDate,
    cycleYear,
    createdByProfileId: auth.userId,
  });

  if (!ensured.meetingId)
    return { ok: false, error: ensured.note || "The meeting could not be created." };
  if (!ensured.eventId)
    return {
      ok: false,
      error: `The meeting was saved but its event page could not be created. ${ensured.note}`,
    };

  const updated = await updateEvent(ensured.eventId, {
    slug: agmEventSlug(cycleYear),
    starts_at: startsAt,
    ends_at: endsAt || undefined,
    is_virtual: fields.is_virtual,
    location: fields.location ?? "",
    virtual_link: fields.virtual_link ?? "",
    audience_mode: "members",
  });

  if (!updated.success)
    return { ok: false, error: `The meeting was saved but its details were not: ${updated.error}` };

  await logAuditEventSafe({
    actorId: auth.userId,
    action: "members_meeting_scheduled",
    entityType: "board_meeting",
    entityId: ensured.meetingId,
    details: { meetingDate, venue, startsAt, endsAt: endsAt || null },
  });

  revalidate(ensured.meetingId);
  return { ok: true, meetingId: ensured.meetingId };
}

/**
 * Publish the meeting's event page.
 *
 * This is the act that calls the meeting in public: `transitionEventStatus`
 * mints the Google Meet link for a virtual event and pushes the entry into the
 * calendar, and `sendAgmNotice` refuses to send while the event is still a
 * draft because the notice links to it. Publishing is not a separate errand
 * from giving notice — it is the first half of it.
 */
export async function publishMembersMeetingEventAction(meetingId: string): Promise<ActionResult> {
  const auth = await requireBoardStaff();
  if (!auth.ok) return auth;

  const meeting = await getMembersMeeting(meetingId);
  if (!meeting) return { ok: false, error: "That members' meeting no longer exists." };
  if (!meeting.event)
    return { ok: false, error: "There is no event page to publish — set the meeting up first." };
  if (meeting.event.status === "published") return { ok: true, meetingId };
  if (!meeting.event.startsAt)
    return { ok: false, error: "Set the start time before publishing — members need to be told when." };

  const result = await transitionEventStatus(meeting.event.id, "published");
  if (!result.success) return { ok: false, error: result.error };

  await logAuditEventSafe({
    actorId: auth.userId,
    action: "members_meeting_event_published",
    entityType: "board_meeting",
    entityId: meetingId,
    details: { eventId: meeting.event.id, slug: meeting.event.slug },
  });

  revalidate(meetingId);
  return { ok: true, meetingId };
}
