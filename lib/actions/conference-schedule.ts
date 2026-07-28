"use server";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { CONFERENCE_STATUS_TRANSITIONS, type ConferenceStatus } from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type ScheduledTransitionRow =
  Database["public"]["Tables"]["conference_scheduled_transitions"]["Row"];

// ─────────────────────────────────────────────────────────────────
// Schedule a future conference status transition
// ─────────────────────────────────────────────────────────────────

/**
 * A super_admin approves a future, automated status transition now; the
 * cron (app/api/cron/conference-scheduled-transitions) executes it later via
 * the same performConferenceStatusTransition() core the immediate button
 * uses, so legality/readiness are re-checked at run time — this call only
 * validates that the transition is legal *right now*, not that it will
 * still be legal when it fires.
 *
 * Stricter than the immediate transitionConferenceStatus (requireAdmin):
 * scheduling something that executes unattended in the future needs
 * super_admin + a typed "CONFIRM", mirroring the policy-publish high-risk
 * confirmation pattern (lib/actions/policy.ts).
 */
export async function scheduleConferenceTransition(
  conferenceId: string,
  targetStatus: ConferenceStatus,
  runAt: string,
  confirmationText: string
): Promise<{ success: boolean; error?: string; data?: ScheduledTransitionRow }> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (confirmationText !== "CONFIRM") {
    return { success: false, error: 'Type "CONFIRM" to schedule this transition.' };
  }

  const runAtDate = new Date(runAt);
  if (Number.isNaN(runAtDate.getTime()) || runAtDate.getTime() <= Date.now()) {
    return { success: false, error: "Scheduled time must be in the future." };
  }

  const adminClient = createAdminClient();

  const { data: conference, error: fetchError } = await adminClient
    .from("conference_instances")
    .select("status")
    .eq("id", conferenceId)
    .single();

  if (fetchError || !conference) {
    return { success: false, error: fetchError?.message ?? "Conference not found" };
  }

  const currentStatus = conference.status as ConferenceStatus;
  if (!CONFERENCE_STATUS_TRANSITIONS[currentStatus].includes(targetStatus)) {
    return {
      success: false,
      error: `Cannot schedule "${currentStatus}" → "${targetStatus}" — not a legal transition from the current status.`,
    };
  }

  const { data, error } = await adminClient
    .from("conference_scheduled_transitions")
    .insert({
      conference_id: conferenceId,
      target_status: targetStatus,
      run_at: runAtDate.toISOString(),
      status: "pending",
      created_by: auth.ctx.userId,
    })
    .select()
    .single();

  if (error) {
    // Most likely the partial unique index — a pending schedule for this
    // target already exists.
    if (error.code === "23505") {
      return {
        success: false,
        error: `There's already a pending schedule for "${targetStatus}" on this conference. Cancel it first.`,
      };
    }
    return { success: false, error: error.message };
  }

  await logAuditEventSafe({
    action: "conference_transition_scheduled",
    entityType: "conference",
    entityId: conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { fromStatus: currentStatus, toStatus: targetStatus, runAt: runAtDate.toISOString() },
  });

  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Cancel a pending scheduled transition
// ─────────────────────────────────────────────────────────────────

export async function cancelScheduledConferenceTransition(
  scheduleId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: schedule, error: fetchError } = await adminClient
    .from("conference_scheduled_transitions")
    .select("id, status, conference_id, target_status")
    .eq("id", scheduleId)
    .single();

  if (fetchError || !schedule) {
    return { success: false, error: "Scheduled transition not found" };
  }

  if (schedule.status !== "pending") {
    return {
      success: false,
      error: `This schedule is no longer pending (status: ${schedule.status})`,
    };
  }

  const { error } = await adminClient
    .from("conference_scheduled_transitions")
    .update({
      status: "canceled",
      canceled_by: auth.ctx.userId,
      canceled_at: new Date().toISOString(),
    })
    .eq("id", scheduleId);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "conference_transition_schedule_canceled",
    entityType: "conference",
    entityId: schedule.conference_id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { targetStatus: schedule.target_status },
  });

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// List pending/recent scheduled transitions for a conference
// ─────────────────────────────────────────────────────────────────

export async function listScheduledConferenceTransitions(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: ScheduledTransitionRow[] }> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_scheduled_transitions")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("run_at", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}
