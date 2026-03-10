#!/usr/bin/env node
import { randomUUID } from "node:crypto";
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
const allowTempActiveFixture = process.env.SWAPS_LIVE_ALLOW_TEMP_ACTIVE_FIXTURE === "true";

function evaluateChecks(checks) {
  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    const error = new Error("Swap live-check failed one or more data integrity assertions.");
    error.details = { failed, checks };
    throw error;
  }
}

async function pickRows(table, column, minCount) {
  const { data, error } = await supabase.from(table).select(column).limit(minCount);
  if (error) throw error;
  if (!data || data.length < minCount) {
    throw new Error(`Need at least ${minCount} rows in ${table} for fixture setup.`);
  }
  return data.map((row) => row[column]);
}

async function pickFixtureProfileIds(conferenceId) {
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id")
    .limit(500);
  if (profilesError) throw profilesError;

  const profileIds = (profiles ?? []).map((row) => row.id);
  if (profileIds.length === 0) {
    throw new Error("Need at least 1 profile row for fixture setup.");
  }

  const { data: existingRegs, error: existingRegsError } = await supabase
    .from("conference_registrations")
    .select("user_id, registration_type")
    .eq("conference_id", conferenceId)
    .in("registration_type", ["delegate", "exhibitor"]);
  if (existingRegsError) throw existingRegsError;

  const hasDelegate = new Set(
    (existingRegs ?? [])
      .filter((row) => row.registration_type === "delegate")
      .map((row) => row.user_id)
  );
  const hasExhibitor = new Set(
    (existingRegs ?? [])
      .filter((row) => row.registration_type === "exhibitor")
      .map((row) => row.user_id)
  );

  const delegateUsers = profileIds.filter((id) => !hasDelegate.has(id)).slice(0, 3);
  const exhibitorUsers = profileIds.filter((id) => !hasExhibitor.has(id)).slice(0, 3);

  if (delegateUsers.length < 3 || exhibitorUsers.length < 3) {
    throw new Error(
      "Need at least 3 profiles without delegate registrations and 3 without exhibitor registrations " +
        `for conference ${conferenceId}.`
    );
  }

  return { delegateUsers, exhibitorUsers };
}

async function main() {
  const schemaChecks = [
    "swap_requests",
    "swap_cap_increase_requests",
    "scheduler_runs",
    "schedules",
    "meeting_slots",
  ];

  for (const table of schemaChecks) {
    const { error } = await supabase.from(table).select("id", { head: true, count: "exact" });
    if (error) throw new Error(`table check failed for ${table}: ${error.message}`);
  }

  const { data: activeRun, error: activeRunError } = await supabase
    .from("scheduler_runs")
    .select("id, conference_id")
    .eq("run_mode", "active")
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();
  if (activeRunError) throw activeRunError;
  let conferenceId = activeRun?.conference_id ?? null;
  let activeRunId = activeRun?.id ?? null;

  if (!conferenceId) {
    const { data: conference, error: conferenceError } = await supabase
      .from("conference_instances")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (conferenceError) throw conferenceError;
    if (!conference?.id) throw new Error("No conference_instances row found");
    conferenceId = conference.id;
  }

  const orgIds = await pickRows("organizations", "id", 6);
  const { delegateUsers, exhibitorUsers } = await pickFixtureProfileIds(conferenceId);

  const cleanup = {
    swapRequestIds: [],
    scheduleIds: [],
    slotIds: [],
    suiteIds: [],
    registrationIds: [],
    schedulerRunIds: [],
  };
  const checks = [];
  let usedTemporaryActiveRun = false;

  try {
    if (!activeRunId) {
      if (!allowTempActiveFixture) {
        throw new Error(
          "No active completed scheduler_run found for fixture conference. " +
            "For local/dev checks only, set SWAPS_LIVE_ALLOW_TEMP_ACTIVE_FIXTURE=true."
        );
      }

      const { data: policySet, error: policySetError } = await supabase
        .from("policy_sets")
        .select("id")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (policySetError) throw policySetError;
      if (!policySet?.id) throw new Error("No active policy_set found");

      const tempSeed = 920000 + Math.floor(Math.random() * 50000);
      const { data: tempRun, error: tempRunError } = await supabase
        .from("scheduler_runs")
        .insert({
          conference_id: conferenceId,
          policy_set_id: policySet.id,
          run_seed: tempSeed,
          run_mode: "active",
          status: "completed",
          metadata: {
            fixture: "chunk14-swaps-live-check",
            label: "temp-active-run",
            note: "TEMP DEV FIXTURE - do not use for production validation",
          },
        })
        .select("id")
        .single();
      if (tempRunError) throw tempRunError;
      activeRunId = tempRun.id;
      cleanup.schedulerRunIds.push(tempRun.id);
      usedTemporaryActiveRun = true;
    }

    const suiteNumber = 9000 + Math.floor(Math.random() * 999);
    const { data: suite, error: suiteError } = await supabase
      .from("conference_suites")
      .insert({ conference_id: conferenceId, suite_number: suiteNumber, is_active: true })
      .select("id")
      .single();
    if (suiteError) throw suiteError;
    cleanup.suiteIds.push(suite.id);

    const { data: slots, error: slotError } = await supabase
      .from("meeting_slots")
      .insert([
        {
          conference_id: conferenceId,
          day_number: 98,
          slot_number: 1,
          start_time: "09:00:00",
          end_time: "09:20:00",
          suite_id: suite.id,
        },
        {
          conference_id: conferenceId,
          day_number: 98,
          slot_number: 2,
          start_time: "09:25:00",
          end_time: "09:45:00",
          suite_id: suite.id,
        },
      ])
      .select("id");
    if (slotError) throw slotError;
    if (!slots || slots.length !== 2) throw new Error("Failed to create fixture meeting slots.");
    cleanup.slotIds.push(...slots.map((row) => row.id));

    const fixtureRegs = [
      {
        id: randomUUID(),
        conference_id: conferenceId,
        organization_id: orgIds[0],
        user_id: delegateUsers[0],
        registration_type: "delegate",
        status: "confirmed",
      },
      {
        id: randomUUID(),
        conference_id: conferenceId,
        organization_id: orgIds[1],
        user_id: delegateUsers[1],
        registration_type: "delegate",
        status: "confirmed",
      },
      {
        id: randomUUID(),
        conference_id: conferenceId,
        organization_id: orgIds[2],
        user_id: delegateUsers[2],
        registration_type: "delegate",
        status: "confirmed",
      },
      {
        id: randomUUID(),
        conference_id: conferenceId,
        organization_id: orgIds[3],
        user_id: exhibitorUsers[0],
        registration_type: "exhibitor",
        status: "confirmed",
      },
      {
        id: randomUUID(),
        conference_id: conferenceId,
        organization_id: orgIds[4],
        user_id: exhibitorUsers[1],
        registration_type: "exhibitor",
        status: "confirmed",
      },
      {
        id: randomUUID(),
        conference_id: conferenceId,
        organization_id: orgIds[5],
        user_id: exhibitorUsers[2],
        registration_type: "exhibitor",
        status: "confirmed",
      },
    ];

    const { error: regInsertError } = await supabase.from("conference_registrations").insert(fixtureRegs);
    if (regInsertError) throw regInsertError;
    cleanup.registrationIds.push(...fixtureRegs.map((row) => row.id));

    const delegateMainId = fixtureRegs[0].id;
    const delegateLinkedId = fixtureRegs[1].id;
    const delegateOtherId = fixtureRegs[2].id;
    const exhibitorDropId = fixtureRegs[3].id;
    const exhibitorReplacementId = fixtureRegs[4].id;
    const exhibitorLinkedConflictId = fixtureRegs[5].id;

    const { error: linkedUpdateError } = await supabase
      .from("conference_registrations")
      .update({ linked_registration_id: delegateLinkedId })
      .eq("id", delegateMainId);
    if (linkedUpdateError) throw linkedUpdateError;

    const { data: schedules, error: scheduleError } = await supabase
      .from("schedules")
      .insert([
        {
          conference_id: conferenceId,
          scheduler_run_id: activeRunId,
          meeting_slot_id: slots[0].id,
          exhibitor_registration_id: exhibitorDropId,
          delegate_registration_ids: [delegateMainId],
          status: "scheduled",
        },
        {
          conference_id: conferenceId,
          scheduler_run_id: activeRunId,
          meeting_slot_id: slots[1].id,
          exhibitor_registration_id: exhibitorReplacementId,
          delegate_registration_ids: [delegateOtherId],
          status: "scheduled",
        },
        {
          conference_id: conferenceId,
          scheduler_run_id: activeRunId,
          meeting_slot_id: slots[1].id,
          exhibitor_registration_id: exhibitorLinkedConflictId,
          delegate_registration_ids: [delegateLinkedId],
          status: "scheduled",
        },
      ])
      .select("id");
    if (scheduleError) throw scheduleError;
    cleanup.scheduleIds.push(...schedules.map((row) => row.id));

    const dropScheduleId = schedules[0].id;
    const replacementScheduleId = schedules[1].id;

    const { data: firstSwapRequest, error: firstSwapError } = await supabase
      .from("swap_requests")
      .insert({
        conference_id: conferenceId,
        scheduler_run_id: activeRunId,
        delegate_registration_id: delegateMainId,
        drop_schedule_id: dropScheduleId,
        status: "options_generated",
        swap_number: 1,
        alternatives_generated: [{ scheduleId: replacementScheduleId }],
      })
      .select("id")
      .single();
    if (firstSwapError) throw firstSwapError;
    cleanup.swapRequestIds.push(firstSwapRequest.id);

    const { error: linkedConflictError } = await supabase.rpc("commit_swap_request", {
      p_swap_request_id: firstSwapRequest.id,
      p_replacement_schedule_id: replacementScheduleId,
      p_group_min: 1,
      p_group_max: 3,
      p_actor_id: delegateUsers[0],
    });

    const { data: afterConflictSchedules, error: afterConflictSchedulesError } = await supabase
      .from("schedules")
      .select("id, delegate_registration_ids, status")
      .in("id", [dropScheduleId, replacementScheduleId]);
    if (afterConflictSchedulesError) throw afterConflictSchedulesError;

    const dropAfterConflict = afterConflictSchedules.find((row) => row.id === dropScheduleId);
    const replacementAfterConflict = afterConflictSchedules.find((row) => row.id === replacementScheduleId);

    checks.push({
      check: "linked-conflict-blocked",
      ok: Boolean(linkedConflictError?.message?.includes("LINKED_REGISTRATION_SLOT_CONFLICT")),
      details: linkedConflictError?.message ?? null,
    });
    checks.push({
      check: "drop-not-mutated-on-conflict",
      ok: Boolean(dropAfterConflict?.delegate_registration_ids?.includes(delegateMainId)),
      details: dropAfterConflict ?? null,
    });
    checks.push({
      check: "replacement-not-mutated-on-conflict",
      ok: !(replacementAfterConflict?.delegate_registration_ids ?? []).includes(delegateMainId),
      details: replacementAfterConflict ?? null,
    });

    await supabase
      .from("conference_registrations")
      .update({ linked_registration_id: null })
      .eq("id", delegateMainId);

    const { data: secondSwapRequest, error: secondSwapError } = await supabase
      .from("swap_requests")
      .insert({
        conference_id: conferenceId,
        scheduler_run_id: activeRunId,
        delegate_registration_id: delegateMainId,
        drop_schedule_id: dropScheduleId,
        status: "options_generated",
        swap_number: 2,
        alternatives_generated: [{ scheduleId: replacementScheduleId }],
      })
      .select("id")
      .single();
    if (secondSwapError) throw secondSwapError;
    cleanup.swapRequestIds.push(secondSwapRequest.id);

    const { data: committedSwap, error: commitError } = await supabase.rpc("commit_swap_request", {
      p_swap_request_id: secondSwapRequest.id,
      p_replacement_schedule_id: replacementScheduleId,
      p_group_min: 1,
      p_group_max: 3,
      p_actor_id: delegateUsers[0],
    });
    if (commitError) throw commitError;

    const { data: updatedSchedules, error: updatedSchedulesError } = await supabase
      .from("schedules")
      .select("id, delegate_registration_ids, status")
      .in("id", [dropScheduleId, replacementScheduleId]);
    if (updatedSchedulesError) throw updatedSchedulesError;

    const dropUpdated = updatedSchedules.find((row) => row.id === dropScheduleId);
    const replacementUpdated = updatedSchedules.find((row) => row.id === replacementScheduleId);

    const { data: committedSwapRow, error: committedSwapRowError } = await supabase
      .from("swap_requests")
      .select("status, replacement_schedule_id, replacement_exhibitor_id")
      .eq("id", secondSwapRequest.id)
      .single();
    if (committedSwapRowError) throw committedSwapRowError;

    const { data: delegateSchedulesPost, error: delegateSchedulesPostError } = await supabase
      .from("schedules")
      .select("id, exhibitor_registration_id, delegate_registration_ids, status")
      .eq("scheduler_run_id", activeRunId)
      .contains("delegate_registration_ids", [delegateMainId])
      .neq("status", "canceled");
    if (delegateSchedulesPostError) throw delegateSchedulesPostError;

    const exhibitorRegIdsForDelegate = (delegateSchedulesPost ?? []).map(
      (row) => row.exhibitor_registration_id
    );
    const { data: exhibitorRegsForDelegate, error: exhibitorRegsForDelegateError } = await supabase
      .from("conference_registrations")
      .select("id, organization_id")
      .in("id", exhibitorRegIdsForDelegate);
    if (exhibitorRegsForDelegateError) throw exhibitorRegsForDelegateError;

    const orgIdsForDelegate = (exhibitorRegsForDelegate ?? []).map((row) => row.organization_id);
    const uniqueOrgCount = new Set(orgIdsForDelegate).size;

    checks.push({
      check: "commit-succeeded",
      ok: Boolean(committedSwap?.id),
      details: committedSwap?.id ?? null,
    });
    checks.push({
      check: "committed-request-status",
      ok: committedSwapRow?.status === "approved_committed",
      details: committedSwapRow ?? null,
    });
    checks.push({
      check: "drop-schedule-updated",
      ok: !(dropUpdated?.delegate_registration_ids ?? []).includes(delegateMainId),
      details: dropUpdated ?? null,
    });
    checks.push({
      check: "replacement-has-delegate",
      ok: (replacementUpdated?.delegate_registration_ids ?? []).includes(delegateMainId),
      details: replacementUpdated ?? null,
    });
    checks.push({
      check: "no-duplicate-exhibitor-orgs-for-delegate",
      ok: orgIdsForDelegate.length === uniqueOrgCount,
      details: { orgIdsForDelegate, uniqueOrgCount },
    });

    evaluateChecks(checks);

    console.log(
      JSON.stringify(
        {
          schemaChecks: "ok",
          mode: allowTempActiveFixture ? "dev-fixture-allowed" : "strict-live",
          usedTemporaryActiveRun,
          checksPassed: checks.length,
          checks,
        },
        null,
        2
      )
    );
  } finally {
    if (cleanup.swapRequestIds.length > 0) {
      await supabase.from("swap_requests").delete().in("id", cleanup.swapRequestIds);
    }
    if (cleanup.scheduleIds.length > 0) {
      await supabase.from("schedules").delete().in("id", cleanup.scheduleIds);
    }
    if (cleanup.slotIds.length > 0) {
      await supabase.from("meeting_slots").delete().in("id", cleanup.slotIds);
    }
    if (cleanup.suiteIds.length > 0) {
      await supabase.from("conference_suites").delete().in("id", cleanup.suiteIds);
    }
    if (cleanup.registrationIds.length > 0) {
      await supabase.from("conference_registrations").delete().in("id", cleanup.registrationIds);
    }
    if (cleanup.schedulerRunIds.length > 0) {
      await supabase.from("scheduler_runs").delete().in("id", cleanup.schedulerRunIds);
    }
  }
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.message);
    if (error.details) {
      console.error(JSON.stringify(error.details, null, 2));
    }
  } else if (error && typeof error === "object") {
    console.error(JSON.stringify(error, null, 2));
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
