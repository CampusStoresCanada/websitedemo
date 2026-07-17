"use server";

import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";

/**
 * Manual per-cell overrides on the Schedule matrix. Writes directly to the
 * displayed run's `schedules` rows, marking them `is_manual` so a later
 * re-promote in Schedule Ops can warn before replacing hand edits. Blocks the
 * one thing that's physically impossible — the same exhibitor or delegate in
 * two suites at the same time — but otherwise trusts the admin's intent.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function setMeetingAssignment(
  conferenceId: string,
  input: {
    runId: string;
    meetingSlotId: string;
    exhibitorRegistrationId: string;
    delegateRegistrationIds: string[];
  }
): Promise<Result<{ id: string }>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.exhibitorRegistrationId) {
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
      .select("exhibitor_registration_id, delegate_registration_ids")
      .eq("conference_id", conferenceId)
      .eq("scheduler_run_id", input.runId)
      .neq("status", "canceled")
      .in("meeting_slot_id", siblingIds);
    const conflicts = sibAssignments ?? [];

    if (conflicts.some((c) => c.exhibitor_registration_id === input.exhibitorRegistrationId)) {
      return {
        success: false,
        error: "That exhibitor is already in another suite at this time. Clear it there first.",
      };
    }
    const busyDelegates = new Set(conflicts.flatMap((c) => c.delegate_registration_ids ?? []));
    const clashing = input.delegateRegistrationIds.filter((d) => busyDelegates.has(d));
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

  let id: string;
  if (existing) {
    const { error } = await db
      .from("schedules")
      .update({
        exhibitor_registration_id: input.exhibitorRegistrationId,
        delegate_registration_ids: input.delegateRegistrationIds,
        status: "scheduled",
        is_manual: true,
      })
      .eq("id", existing.id);
    if (error) return { success: false, error: error.message };
    id = existing.id;
  } else {
    const { data: inserted, error } = await db
      .from("schedules")
      .insert({
        conference_id: conferenceId,
        scheduler_run_id: input.runId,
        meeting_slot_id: input.meetingSlotId,
        exhibitor_registration_id: input.exhibitorRegistrationId,
        delegate_registration_ids: input.delegateRegistrationIds,
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
      exhibitorRegistrationId: input.exhibitorRegistrationId,
      delegateCount: input.delegateRegistrationIds.length,
    },
  });

  return { success: true, data: { id } };
}

export async function clearMeetingAssignment(
  conferenceId: string,
  input: { runId: string; meetingSlotId: string }
): Promise<Result<null>> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db
    .from("schedules")
    .delete()
    .eq("conference_id", conferenceId)
    .eq("scheduler_run_id", input.runId)
    .eq("meeting_slot_id", input.meetingSlotId);
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
