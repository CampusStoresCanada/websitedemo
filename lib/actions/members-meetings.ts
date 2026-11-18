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
  instantAtMeetingZone,
  isMembersMeetingType,
  meetingDateOf,
  wallTimeAtMeetingZone,
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

function revalidate(meetingId?: string) {
  revalidatePath("/admin/members-meetings");
  if (meetingId) revalidatePath(`/admin/members-meetings/${meetingId}`);
  revalidatePath("/admin/board/meetings");
  revalidatePath("/admin/events");
  revalidatePath("/events");
}

/**
 * Call a meeting of the members, or move one that is already called.
 *
 * ⛔ The DATE is the only thing this writes, and that is the point. The hour,
 * the venue, the address, the joining link and the page copy are event fields
 * and are edited by `EventForm` on the meeting page — the one form this
 * codebase has for an event. A second form here used to re-implement six of
 * its fields; it is gone.
 *
 * The date is not an event field because the election joins to the meeting on
 * `board_meetings.meeting_date` (there is no FK) and measures its nomination,
 * ballot and Part VII S4(b) notice windows back from it.
 */
export async function scheduleMembersMeetingAction(formData: FormData): Promise<ActionResult> {
  const auth = await requireBoardStaff();
  if (!auth.ok) return auth;

  const meetingId = String(formData.get("meetingId") ?? "").trim() || null;
  const meetingDate = String(formData.get("meetingDate") ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate))
    return { ok: false, error: "Pick the date the meeting is held." };

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

  // Moving an existing meeting.
  if (meetingId) {
    const existing = await getMembersMeeting(meetingId);
    if (!existing) return { ok: false, error: "That members' meeting no longer exists." };

    // Changing the date once an election is running is not an edit, it is
    // moving the meeting the whole election schedule is derived from, and
    // notice may already be out stating the old date.
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

      // The event has to follow the meeting onto the new day, keeping the hour
      // the board set. `updateEvent` refuses an event whose day no longer
      // matches its meeting, so leaving this would lock every later edit out of
      // the Events form. The meeting row is updated first so that check passes.
      if (existing.event?.startsAt) {
        const startWall = wallTimeAtMeetingZone(existing.event.startsAt);
        const nextStart = startWall ? instantAtMeetingZone(meetingDate, startWall) : null;
        if (!nextStart)
          return {
            ok: false,
            error:
              `The meeting moved to ${meetingDate}, but ${startWall ?? "its start time"} does not ` +
              `exist on that day in Eastern time — set the time again on the event page.`,
          };

        let nextEnd: string | undefined;
        if (existing.event.endsAt) {
          const endWall = wallTimeAtMeetingZone(existing.event.endsAt);
          const endDate = meetingDateOf(existing.event.endsAt);
          // An end time on the following day stays on the following day.
          const endTargetDate =
            endDate && endDate !== existing.meetingDate
              ? (meetingDateOf(new Date(new Date(`${meetingDate}T12:00:00Z`).getTime() + 86400000).toISOString()) ?? meetingDate)
              : meetingDate;
          nextEnd =
            (endWall ? instantAtMeetingZone(endTargetDate, endWall) : null) ?? undefined;
        }

        const moved = await updateEvent(existing.event.id, {
          slug: existing.event.slug,
          starts_at: nextStart,
          ends_at: nextEnd,
        });
        if (!moved.success)
          return {
            ok: false,
            error: `The meeting moved but its event page did not: ${moved.error}`,
          };
      }
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

  // ⛔ Pin the slug and the audience. `updateEvent` re-derives the slug from the
  // title whenever `starts_at` changes, and `sendAgmNotice` looks the event up
  // by `agmEventSlug(year)` and puts `/events/<slug>` inside the notice it
  // sends — a drifted slug turns notice already given into a dead link, and
  // notice is discharged once. The audience is members, never public.
  const pinned = await updateEvent(ensured.eventId, {
    slug: agmEventSlug(cycleYear),
    audience_mode: "members",
  });

  if (!pinned.success)
    return { ok: false, error: `The meeting was saved but its event was not pinned: ${pinned.error}` };

  await logAuditEventSafe({
    actorId: auth.userId,
    action: "members_meeting_scheduled",
    entityType: "board_meeting",
    entityId: ensured.meetingId,
    details: { meetingDate },
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
