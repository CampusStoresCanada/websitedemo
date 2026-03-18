// ─────────────────────────────────────────────────────────────────
// Deadhand confirmation gate — called by automated job runners
// BEFORE executing any financial or org-altering action.
//
// Usage (in a job runner):
//   const gate = await checkCalendarConfirmation("billing_run:abc123:run");
//   if (!gate.allowed) { logAbort(gate.reason); createOpsAlert(...); return; }
//
// "allowed" is true when:
//   - The calendar item does not require confirmation (requires_confirmation=false)
//   - The calendar item has been confirmed by an admin (confirmed_at IS NOT NULL)
//   - No matching calendar item exists (untracked job — allowed, but worth logging)
//
// ── Why confirmations don't bleed across cycles ───────────────────
// Every job run (renewal_job_runs, billing_runs) gets a UUID on creation.
// Source keys are "{table}:{uuid}:run" — tied to one specific run, not a
// cycle period. A new run = new UUID = new calendar item = confirmed_at NULL.
// A past cycle's green confirmation physically cannot reach a future item.
//
// TODO (v1.4): If predictive future-run projection is added (projecting the
// next scheduled run before its DB row exists), source keys MUST still use
// the upcoming run's UUID — never a stable period key like "charge:2026-Q2".
// A stable key would let an old confirmation carry forward across cycles,
// defeating the entire deadhand mechanism. If stable period keys are ever
// used, add a sweep here: query for confirmed+done items whose period has
// rolled over and null their confirmed_at before the gate check.
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { CalendarConfirmationResult } from "./types";

export async function checkCalendarConfirmation(
  sourceKey: string
): Promise<CalendarConfirmationResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("calendar_items")
    .select("requires_confirmation, confirmed_at, confirmed_by, starts_at, status")
    .eq("source_key", sourceKey)
    .eq("source_mode", "projected")
    .maybeSingle();

  if (error) {
    // DB error — fail safe: block the run
    return { allowed: false, reason: `Calendar gate error: ${error.message}` };
  }

  if (!data) {
    // No calendar entry — job is untracked, allow but caller should log
    return { allowed: true };
  }

  if (!data.requires_confirmation) {
    return { allowed: true };
  }

  if (data.confirmed_at) {
    return {
      allowed:      true,
      confirmed_at: data.confirmed_at,
      confirmed_by: data.confirmed_by ?? undefined,
    };
  }

  // Requires confirmation but none received
  const now   = new Date();
  const start = new Date(data.starts_at);
  const hoursOut = (start.getTime() - now.getTime()) / (1000 * 60 * 60);

  return {
    allowed: false,
    reason: hoursOut <= 0
      ? `Run time has passed with no admin confirmation. Aborting to prevent unreviewed financial action.`
      : `No admin confirmation received. Run fires in ${Math.round(hoursOut)}h. ` +
        `An admin must confirm this calendar item before it will execute.`,
  };
}
