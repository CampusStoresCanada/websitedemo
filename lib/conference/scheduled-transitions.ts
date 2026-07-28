import { createAdminClient } from "@/lib/supabase/admin";
import { performConferenceStatusTransition } from "@/lib/actions/conference";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import type { ConferenceStatus } from "@/lib/constants/conference";

export type ScheduledTransitionRunResult = {
  processed: number;
  executed: number;
  failed: number;
};

/**
 * Cron entry point: fires any conference status transition a super_admin
 * scheduled in advance and whose time has come. Reuses
 * performConferenceStatusTransition — the same legality + readiness gates
 * the immediate admin button uses — so a manual status change made in the
 * meantime naturally wins over a stale schedule instead of being clobbered.
 * A failure (legality no longer holds, or any error) marks the schedule
 * `failed` and raises an ops alert rather than failing silently.
 */
export async function runScheduledConferenceTransitions(): Promise<ScheduledTransitionRunResult> {
  const db = createAdminClient();
  const result: ScheduledTransitionRunResult = { processed: 0, executed: 0, failed: 0 };

  const { data: due, error: fetchError } = await db
    .from("conference_scheduled_transitions")
    .select("id, conference_id, target_status, run_at, created_by")
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true });

  if (fetchError) {
    console.error("[conference-scheduled-transitions] fetch failed:", fetchError.message);
    return result;
  }

  for (const schedule of due ?? []) {
    result.processed++;

    const transitionResult = await performConferenceStatusTransition(
      schedule.conference_id,
      schedule.target_status as ConferenceStatus,
      { actorId: schedule.created_by, actorType: "cron" }
    );

    if (transitionResult.success) {
      result.executed++;
      await db
        .from("conference_scheduled_transitions")
        .update({ status: "executed", executed_at: new Date().toISOString() })
        .eq("id", schedule.id);
      continue;
    }

    result.failed++;
    await db
      .from("conference_scheduled_transitions")
      .update({ status: "failed", error: transitionResult.error ?? "Unknown error" })
      .eq("id", schedule.id);

    await raiseAlertIfNotOpen({
      ruleKey: `conference_scheduled_transition_failed:${schedule.id}`,
      severity: "critical",
      message: `Scheduled conference transition to "${schedule.target_status}" failed: ${transitionResult.error ?? "unknown error"}`,
      details: {
        scheduleId: schedule.id,
        conferenceId: schedule.conference_id,
        targetStatus: schedule.target_status,
        runAt: schedule.run_at,
        error: transitionResult.error ?? null,
      },
    });
  }

  return result;
}
