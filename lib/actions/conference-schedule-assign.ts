"use server";

import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { loadSeatHoldings } from "@/lib/conference/seats";
import type { MeetingRuling } from "@/lib/conference/schedule-ops";

/**
 * Manual per-cell overrides on the meeting grid (War Room, Meetings). Writes directly to the
 * displayed run's `schedules` rows, marking them `is_manual` so a later
 * publish can warn before replacing hand edits. Blocks the
 * one thing that's physically impossible — the same exhibitor or delegate in
 * two suites at the same time — but otherwise trusts the admin's intent.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function setMeetingAssignment(
  conferenceId: string,
  input: {
    runId: string;
    meetingSlotId: string;
    exhibitorSeatId: string;
    delegateSeatIds: string[];
  }
): Promise<Result<{ id: string }>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.exhibitorSeatId) {
    return { success: false, error: "Pick an exhibitor for this meeting." };
  }

  const db = createAdminClient();

  // Resolve the slot's (day, slot) so we can check same-time conflicts.
  const { data: slot, error: slotErr } = await db
    .from("meeting_slots")
    .select("id, day_number, slot_number, conference_id")
    .eq("id", input.meetingSlotId)
    .maybeSingle();
  if (slotErr || !slot) return { success: false, error: "Meeting slot not found." };
  if (slot.conference_id !== conferenceId) {
    return { success: false, error: "Slot does not belong to this conference." };
  }

  // Sibling slots = same day/slot in other suites (the same time row).
  const { data: siblingSlots } = await db
    .from("meeting_slots")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("day_number", slot.day_number)
    .eq("slot_number", slot.slot_number);
  const siblingIds = (siblingSlots ?? [])
    .map((s) => s.id)
    .filter((id) => id !== input.meetingSlotId);

  if (siblingIds.length > 0) {
    const { data: sibAssignments } = await db
      .from("schedules")
      .select("exhibitor_seat_id, delegate_seat_ids")
      .eq("conference_id", conferenceId)
      .eq("scheduler_run_id", input.runId)
      .neq("status", "canceled")
      .in("meeting_slot_id", siblingIds);
    const conflicts = sibAssignments ?? [];

    if (conflicts.some((c) => c.exhibitor_seat_id === input.exhibitorSeatId)) {
      return {
        success: false,
        error: "That exhibitor is already in another suite at this time. Clear it there first.",
      };
    }
    const busyDelegates = new Set(conflicts.flatMap((c) => c.delegate_seat_ids ?? []));
    const clashing = input.delegateSeatIds.filter((d) => busyDelegates.has(d));
    if (clashing.length > 0) {
      return {
        success: false,
        error: `${clashing.length} delegate(s) are already booked at this time.`,
      };
    }
  }

  // One meeting per (run, slot): update if present, else insert.
  const { data: existing } = await db
    .from("schedules")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("scheduler_run_id", input.runId)
    .eq("meeting_slot_id", input.meetingSlotId)
    .neq("status", "canceled")
    .maybeSingle();

  // A cleared cell keeps its row as `canceled` (see clearMeetingAssignment),
  // and (run, slot, exhibitor) is unique — so putting the same exhibitor back
  // revives that row rather than inserting a duplicate.
  const { data: revivable } = existing
    ? { data: null }
    : await db
        .from("schedules")
        .select("id")
        .eq("conference_id", conferenceId)
        .eq("scheduler_run_id", input.runId)
        .eq("meeting_slot_id", input.meetingSlotId)
        .eq("exhibitor_seat_id", input.exhibitorSeatId)
        .eq("status", "canceled")
        .maybeSingle();

  let id: string;
  if (existing || revivable) {
    const target = (existing ?? revivable)!;
    const { error } = await db
      .from("schedules")
      .update({
        exhibitor_seat_id: input.exhibitorSeatId,
        delegate_seat_ids: input.delegateSeatIds,
        status: "scheduled",
        is_manual: true,
      })
      .eq("id", target.id);
    if (error) return { success: false, error: error.message };
    id = target.id;
  } else {
    const { data: inserted, error } = await db
      .from("schedules")
      .insert({
        conference_id: conferenceId,
        scheduler_run_id: input.runId,
        meeting_slot_id: input.meetingSlotId,
        exhibitor_seat_id: input.exhibitorSeatId,
        delegate_seat_ids: input.delegateSeatIds,
        match_score_ids: [],
        status: "scheduled",
        is_manual: true,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      return { success: false, error: error?.message ?? "Failed to save assignment." };
    }
    id = inserted.id;
  }

  await logAuditEventSafe({
    action: "schedule_assignment_manual_set",
    entityType: "schedule",
    entityId: id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId,
      runId: input.runId,
      meetingSlotId: input.meetingSlotId,
      exhibitorSeatId: input.exhibitorSeatId,
      delegateCount: input.delegateSeatIds.length,
    },
  });

  return { success: true, data: { id } };
}

/**
 * Clear a cell: the meeting is CANCELED, never deleted.
 *
 * ⛔ It used to delete the row. A check-in card scan points at its meeting
 * (conference_check_in_events.schedule_id, on delete set null), so clearing a
 * cell after the meeting happened silently erased the proof the CANCOLL
 * bursary report is built from. `canceled` is already in the status vocabulary
 * and every reader already skips it.
 */
export async function clearMeetingAssignment(
  conferenceId: string,
  input: { runId: string; meetingSlotId: string }
): Promise<Result<null>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db
    .from("schedules")
    .update({ status: "canceled", is_manual: true })
    .eq("conference_id", conferenceId)
    .eq("scheduler_run_id", input.runId)
    .eq("meeting_slot_id", input.meetingSlotId)
    .neq("status", "canceled");
  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "schedule_assignment_manual_clear",
    entityType: "schedule",
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { conferenceId, runId: input.runId, meetingSlotId: input.meetingSlotId },
  });
  return { success: true, data: null };
}

const MEETING_RULINGS: readonly MeetingRuling[] = ["attended", "absent", "excused"];

/**
 * Staff's word on whether one delegate attended one meeting: attended, absent,
 * or excused when the partner or CSC did not show (CANCOLL MOU 8.6). One more
 * row in the record the check-in cards write; the newest ruling wins over the
 * scans (loadMeetingConfirmations). A correction is another ruling, so the
 * history stays.
 */
export async function setMeetingRuling(
  conferenceId: string,
  input: { scheduleId: string; delegateSeatId: string; ruling: MeetingRuling; note?: string | null }
): Promise<Result<null>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!MEETING_RULINGS.includes(input.ruling)) return { success: false, error: "Unknown outcome." };

  const db = createAdminClient();
  const { data: schedule, error: scheduleError } = await db
    .from("schedules")
    .select("id, delegate_seat_ids, status")
    .eq("id", input.scheduleId)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  if (scheduleError || !schedule) return { success: false, error: "Meeting not found." };
  if (schedule.status === "canceled") {
    return { success: false, error: "This meeting was cancelled, so nobody missed it." };
  }
  if (!(schedule.delegate_seat_ids ?? []).includes(input.delegateSeatId)) {
    return { success: false, error: "That delegate is not in this meeting." };
  }

  const { seats } = await loadSeatHoldings(db, { conferenceId, seatIds: [input.delegateSeatId] });
  const personId = seats[0]?.holderPersonId;
  if (!personId) return { success: false, error: "Nobody is named on that seat." };

  const note = input.note?.trim() || null;
  const { error } = await db.from("conference_check_in_events").insert({
    conference_id: conferenceId,
    person_id: personId,
    schedule_id: input.scheduleId,
    confirmed_by: "staff",
    ruling: input.ruling,
    ruling_note: note,
    checked_in_by: auth.ctx.userId,
    check_in_source: "manual",
    result_state: "valid",
  });
  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "schedule_meeting_ruling",
    entityType: "schedule",
    entityId: input.scheduleId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { conferenceId, personId, ruling: input.ruling, note },
  });
  return { success: true, data: null };
}
