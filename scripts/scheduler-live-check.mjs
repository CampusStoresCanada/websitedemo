#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Add both to websitedemo/.env.local, then re-run."
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const checks = [
    "conference_suites",
    "meeting_slots",
    "scheduler_runs",
    "match_scores",
    "schedules",
  ];

  for (const table of checks) {
    const { error } = await supabase.from(table).select("id", { count: "exact", head: true });
    if (error) throw new Error(`table check failed for ${table}: ${error.message}`);
  }

  const { data: policySet, error: policyError } = await supabase
    .from("policy_sets")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (policyError) throw policyError;
  if (!policySet?.id) throw new Error("No active policy_set found");

  const { data: conference, error: confError } = await supabase
    .from("conference_instances")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (confError) throw confError;
  if (!conference?.id) throw new Error("No conference_instances row found");

  const conferenceId = conference.id;
  const policySetId = policySet.id;

  await supabase
    .from("scheduler_runs")
    .delete()
    .eq("conference_id", conferenceId)
    .contains("metadata", { fixture: "chunk13-live-check" });

  const { data: inserted, error: insertError } = await supabase
    .from("scheduler_runs")
    .insert([
      {
        conference_id: conferenceId,
        policy_set_id: policySetId,
        run_seed: 910001,
        run_mode: "active",
        status: "completed",
        metadata: { fixture: "chunk13-live-check", label: "previous-active" },
      },
      {
        conference_id: conferenceId,
        policy_set_id: policySetId,
        run_seed: 910002,
        run_mode: "draft",
        status: "completed",
        metadata: { fixture: "chunk13-live-check", label: "target-draft" },
      },
    ])
    .select("id, run_mode, status, run_seed");
  if (insertError) throw new Error(`fixture insert failed: ${insertError.message}`);

  const target = inserted.find((row) => row.run_seed === 910002);
  if (!target) throw new Error("target draft run missing after insert");

  const { data: promoted, error: promoteError } = await supabase.rpc("promote_scheduler_run", {
    p_conference_id: conferenceId,
    p_run_id: target.id,
    p_activated_by: null,
  });
  if (promoteError) throw new Error(`promote rpc failed: ${promoteError.message}`);

  const { data: activeRuns, error: activeErr } = await supabase
    .from("scheduler_runs")
    .select("id, run_seed, run_mode, status")
    .eq("conference_id", conferenceId)
    .eq("run_mode", "active")
    .contains("metadata", { fixture: "chunk13-live-check" });
  if (activeErr) throw activeErr;

  const { data: archivedRuns, error: archivedErr } = await supabase
    .from("scheduler_runs")
    .select("id, run_seed, run_mode, status")
    .eq("conference_id", conferenceId)
    .eq("run_mode", "archived")
    .contains("metadata", { fixture: "chunk13-live-check" });
  if (archivedErr) throw archivedErr;

  const { error: running1Err } = await supabase.from("scheduler_runs").insert({
    conference_id: conferenceId,
    policy_set_id: policySetId,
    run_seed: 910003,
    run_mode: "draft",
    status: "running",
    metadata: { fixture: "chunk13-live-check", label: "running-1" },
  });
  if (running1Err) throw new Error(`first running insert failed: ${running1Err.message}`);

  const { error: running2Err } = await supabase.from("scheduler_runs").insert({
    conference_id: conferenceId,
    policy_set_id: policySetId,
    run_seed: 910004,
    run_mode: "draft",
    status: "running",
    metadata: { fixture: "chunk13-live-check", label: "running-2" },
  });

  await supabase
    .from("scheduler_runs")
    .delete()
    .eq("conference_id", conferenceId)
    .contains("metadata", { fixture: "chunk13-live-check" });

  console.log(
    JSON.stringify(
      {
        schemaChecks: "ok",
        promotedRunId: promoted?.id ?? null,
        activeRunCountAfterPromote: activeRuns?.length ?? 0,
        archivedRunCountAfterPromote: archivedRuns?.length ?? 0,
        runningLockBlockedSecondInsert: Boolean(running2Err),
        runningLockErrorCode: running2Err?.code ?? null,
        runningLockErrorMessage: running2Err?.message ?? null,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
