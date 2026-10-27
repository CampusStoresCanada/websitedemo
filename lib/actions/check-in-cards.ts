"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { recordCardCheckIn, resolveBoothScan, resolveEventScan } from "@/lib/conference/check-in-cards";

/**
 * The writes behind a check-in card's buttons (lib/conference/check-in-cards.ts).
 *
 * ⛔ Each one RE-RESOLVES the scan on the server: the meeting, the person and
 * the time window come from the viewer's own agenda now, never from what the
 * page posted. A button pressed on a card from another booth, or an hour late,
 * counts for nothing.
 */

type Result = { success: true; alreadyCounted: boolean } | { success: false; error: string };

/** A delegate counts themselves at their meeting. */
export async function checkMeInAtBooth(suiteId: string): Promise<Result> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const scan = await resolveBoothScan(suiteId, auth.ctx.userId, new Date());
  if (scan.mode !== "attendee") return { success: false, error: "You have no meeting at this booth right now." };
  const written = await recordCardCheckIn({
    conferenceId: scan.conferenceId,
    personId: scan.personId,
    byUserId: auth.ctx.userId,
    scheduleId: scan.scheduleId,
    confirmedBy: "attendee",
    resultState: "valid",
  });
  if (written.error) return { success: false, error: written.error };
  if (!written.alreadyCounted) {
    await logAuditEventSafe({
      action: "conference_meeting_confirmed",
      entityType: "schedules",
      entityId: scan.scheduleId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { conferenceId: scan.conferenceId, personId: scan.personId, confirmedBy: "attendee" },
    });
  }
  return { success: true, alreadyCounted: written.alreadyCounted };
}

/**
 * An exhibitor confirms the meeting at their own booth: for a delegate who will
 * not use their phone. Confirms the delegates they pick, all of them if none.
 */
export async function confirmMeetingAsExhibitor(suiteId: string, personIds?: string[]): Promise<Result> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const scan = await resolveBoothScan(suiteId, auth.ctx.userId, new Date());
  if (scan.mode !== "exhibitor") return { success: false, error: "You have no meeting at this booth right now." };
  const chosen = scan.delegates.filter((d) => !personIds || personIds.includes(d.personId));
  if (chosen.length === 0) return { success: false, error: "Nobody to confirm." };
  let allCounted = true;
  for (const delegate of chosen) {
    const written = await recordCardCheckIn({
      conferenceId: scan.conferenceId,
      personId: delegate.personId,
      byUserId: auth.ctx.userId,
      scheduleId: scan.scheduleId,
      confirmedBy: "exhibitor",
      resultState: "valid",
    });
    if (written.error) return { success: false, error: written.error };
    if (!written.alreadyCounted) allCounted = false;
  }
  if (!allCounted) {
    await logAuditEventSafe({
      action: "conference_meeting_confirmed",
      entityType: "schedules",
      entityId: scan.scheduleId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { conferenceId: scan.conferenceId, personIds: chosen.map((d) => d.personId), confirmedBy: "exhibitor" },
    });
  }
  return { success: true, alreadyCounted: allCounted };
}

/** Check yourself in to an event with a card (the CANCOLL AGM, a session…). */
export async function checkMeInToEvent(entityId: string): Promise<Result> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  const scan = await resolveEventScan(entityId, auth.ctx.userId, new Date());
  if (scan.mode !== "check_in") return { success: false, error: "Check-in for this isn't open right now." };
  const written = await recordCardCheckIn({
    conferenceId: scan.conferenceId,
    personId: scan.personId,
    byUserId: auth.ctx.userId,
    entityId,
    confirmedBy: "attendee",
    // Not on their ticket still counts them as there: the desk sells it after,
    // the same "admit and invoice" the door does.
    resultState: scan.onTicket ? "valid" : "not_on_ticket",
  });
  if (written.error) return { success: false, error: written.error };
  return { success: true, alreadyCounted: written.alreadyCounted };
}
