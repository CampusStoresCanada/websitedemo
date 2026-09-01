"use server";

import { requireAdmin, requireConferenceOpsAccess, requireSuperAdmin } from "@/lib/auth/guards";
import type { Database, Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBlackoutListsByOrg } from "@/lib/org/meeting-refusals";
import { getActivePolicySet, getSchedulingConfig } from "@/lib/policy/engine";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { computeAllMatchScores } from "@/lib/scheduler/scoring";
import { generateSchedule } from "@/lib/scheduler/generate";
import { normalizeStringArray, normalizeSalesReadiness } from "@/lib/scheduler/normalize";
import { loadConferenceMeetingGeometry } from "@/lib/conference/meeting-geometry-loader";
import { buildSuiteOrgAssignmentsBySuiteId, reservedSuiteIds } from "@/lib/conference/suite-assignment";
import type {
  DelegateProfile,
  ExhibitorProfile,
  MeetingSlotInput,
  SchedulerRunSummary,
} from "@/lib/scheduler/types";

type SchedulerRunRow = Database["public"]["Tables"]["scheduler_runs"]["Row"];
type MeetingSlotRow = Database["public"]["Tables"]["meeting_slots"]["Row"];

type SchedulerRunMode = "draft" | "active" | "archived";
type SchedulerRunStatus = "running" | "completed" | "failed" | "infeasible";

interface SchedulerRunFilters {
  runMode?: SchedulerRunMode;
  status?: SchedulerRunStatus;
  limit?: number;
}

interface SchedulerActionFailure {
  success: false;
  error: string;
  code?: string;
  dependency?: string;
}

interface SchedulerActionSuccess<T> {
  success: true;
  data: T;
}

function mapRunSummary(run: SchedulerRunRow): SchedulerRunSummary {
  return {
    runId: run.id,
    conferenceId: run.conference_id,
    runMode: run.run_mode as SchedulerRunSummary["runMode"],
    status: run.status as SchedulerRunSummary["status"],
    runSeed: run.run_seed,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    totalDelegates: run.total_delegates,
    totalExhibitors: run.total_exhibitors,
    totalMeetingsCreated: run.total_meetings_created,
  };
}

function parseTimeToDate(baseDateIso: string, timeValue: string): Date {
  const [hours, minutes, seconds] = timeValue.split(":").map((part) => Number(part));
  const date = new Date(baseDateIso);
  date.setUTCHours(hours || 0, minutes || 0, seconds || 0, 0);
  return date;
}

function formatTimeFromDate(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Suite→org is DERIVED now (see lib/conference/inclusion.ts): the sale is
 * recorded on the booth, and the booth includes the suite.
 *
 * This used to throw DUPLICATE_SUITE_ASSIGNMENT when an org held two suites,
 * and told the admin to "unassign the extra suite in Build" — i.e. to clear the
 * hand-typed copy that no longer exists. Both halves are gone: holding two
 * suites is legal (it buys throughput, not time — see suite-assignment.ts), and
 * the limit that matters (no delegate meets the same org twice) is a hard
 * constraint inside the solver, where meetings are actually made.
 */
async function buildSuiteOrgAssignments(
  _adminClient: ReturnType<typeof createAdminClient>,
  suites: Array<{ id: string; suite_number: number }>,
  suiteOrgAssignmentsBySuiteNumber: Record<string, string>
): Promise<Record<string, string>> {
  return buildSuiteOrgAssignmentsBySuiteId(suites, suiteOrgAssignmentsBySuiteNumber);
}

async function ensureMeetingScaffolding(
  conferenceId: string
): Promise<{
  suitesCount: number;
  meetingSlots: MeetingSlotRow[];
  suites: Array<{ id: string; suite_number: number }>;
  suiteOrgAssignmentsBySuiteId: Record<string, string>;
}> {
  const adminClient = createAdminClient();
  // v3: geometry comes from the entity graph (Day-cadence + Suite things), not the
  // schedule_modules config. Same MeetingGeometryResolution shape downstream.
  const geometry = await loadConferenceMeetingGeometry(conferenceId);
  if (geometry.dayConfigs.length === 0 || geometry.suitesTarget <= 0) {
    throw new Error(
      "MEETINGS_SETUP_INCOMPLETE: add suite things and set meeting cadence (start/end/slot duration) on day things in Build before running the scheduler."
    );
  }

  const { data: existingSuites, error: suitesError } = await adminClient
    .from("conference_suites")
    .select("id, suite_number, entity_id")
    .eq("conference_id", conferenceId)
    .order("suite_number", { ascending: true });

  if (suitesError) throw new Error(suitesError.message);

  /**
   * Fill the GAPS, do not seed-once.
   *
   * This used to be `if (suites.length === 0)`, which made the whole function a
   * one-shot bootstrap wearing an "ensure" name: the first run froze the grid,
   * and a booth sold afterwards got no suite row and no meeting slots — not
   * late, never. Selling a booth is the normal case, not the setup case.
   *
   * Rows are matched on entity_id (the Suite thing), so re-running is a no-op
   * when nothing new has sold.
   */
  let suites = existingSuites ?? [];
  const haveSuiteEntityIds = new Set(suites.map((s) => s.entity_id).filter(Boolean));
  const missingSuiteRows = geometry.suites
    .filter((s) => !haveSuiteEntityIds.has(s.id))
    .map((s) => ({
      conference_id: conferenceId,
      suite_number: s.suiteNumber,
      entity_id: s.id,
      is_active: true,
    }));

  if (missingSuiteRows.length > 0) {
    const { data: insertedSuites, error: insertSuitesError } = await adminClient
      .from("conference_suites")
      .insert(missingSuiteRows)
      .select("id, suite_number, entity_id");

    if (insertSuitesError) throw new Error(insertSuitesError.message);
    suites = [...suites, ...(insertedSuites ?? [])].sort(
      (a, b) => a.suite_number - b.suite_number
    );
  }

  const { data: existingSlots, error: slotsError } = await adminClient
    .from("meeting_slots")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("day_number", { ascending: true })
    .order("slot_number", { ascending: true });

  if (slotsError) throw new Error(slotsError.message);

  /**
   * Same rule as the suites above: build the full intended grid every time, then
   * insert only what is absent. A suite that appears later (a booth sold after
   * the first run) gets its meeting times on the next run instead of never.
   *
   * The key mirrors the table's uniqueness constraint
   * (conference_id, day_number, slot_number, suite_id), so an existing slot is
   * left exactly as it is — including any assignment already made against it.
   */
  const slotKey = (r: { day_number: number; slot_number: number; suite_id: string | null }) =>
    `${r.day_number}|${r.slot_number}|${r.suite_id ?? ""}`;
  const haveSlotKeys = new Set((existingSlots ?? []).map(slotKey));

  const startBase = "1970-01-01T00:00:00.000Z";
  const slotRows: Database["public"]["Tables"]["meeting_slots"]["Insert"][] = [];
  for (const dayConfig of geometry.dayConfigs) {
    // Windowed days (breaks/lunch carved out between blocks) run as separate
    // ranges but share one continuous slot_number sequence for the day, since
    // (conference_id, day_number, slot_number, suite_id) must stay unique.
    const windows = dayConfig.windows?.length
      ? dayConfig.windows
      : [{ startTime: dayConfig.startTime, endTime: dayConfig.endTime ?? dayConfig.startTime, meetingCount: dayConfig.meetingCount }];

    let slot = 1;
    for (const w of windows) {
      for (let i = 0; i < w.meetingCount; i += 1, slot += 1) {
        const start = parseTimeToDate(startBase, w.startTime);
        const slotOffsetMinutes = i * (dayConfig.slotDurationMinutes + dayConfig.bufferMinutes);
        start.setUTCMinutes(start.getUTCMinutes() + slotOffsetMinutes);

        const end = new Date(start);
        end.setUTCMinutes(end.getUTCMinutes() + dayConfig.slotDurationMinutes);

        for (const suite of suites) {
          slotRows.push({
            conference_id: conferenceId,
            day_number: dayConfig.dayNumber,
            slot_number: slot,
            start_time: formatTimeFromDate(start),
            end_time: formatTimeFromDate(end),
            suite_id: suite.id,
          });
        }
      }
    }
  }

  const newSlotRows = slotRows.filter(
    (r) =>
      !haveSlotKeys.has(
        slotKey({
          day_number: r.day_number,
          slot_number: r.slot_number,
          suite_id: r.suite_id ?? null,
        })
      )
  );

  let insertedSlots: MeetingSlotRow[] = [];
  if (newSlotRows.length > 0) {
    const { data, error: insertSlotsError } = await adminClient
      .from("meeting_slots")
      .insert(newSlotRows)
      .select("*");

    if (insertSlotsError) throw new Error(insertSlotsError.message);
    insertedSlots = data ?? [];
  }

  const meetingSlots = [...(existingSlots ?? []), ...insertedSlots].sort(
    (a, b) => a.day_number - b.day_number || a.slot_number - b.slot_number
  );

  const suiteOrgAssignmentsBySuiteId = await buildSuiteOrgAssignments(
    adminClient,
    suites,
    geometry.suiteOrgAssignmentsBySuiteNumber
  );

  return {
    suitesCount: suites.length,
    // The WHOLE grid, not just what this run added — the solver schedules
    // against every slot, and returning only the new ones would quietly plan
    // around an empty room.
    meetingSlots,
    suites,
    suiteOrgAssignmentsBySuiteId,
  };
}

async function loadEligibleCandidates(conferenceId: string): Promise<{
  delegates: DelegateProfile[];
  exhibitors: ExhibitorProfile[];
}> {
  const adminClient = createAdminClient();

  // Schedulable candidates are the conference's submitted/confirmed registrations
  // of the relevant type. (The old paid-product eligibility gate was retired with
  // the v3 cutover — see docs/CONFERENCE_V2_BLUEPRINT.md.)
  const [delegatesResult, exhibitorsResult] = await Promise.all([
    adminClient
      .from("conference_registrations")
      .select(
        "id, organization_id, user_id, category_responsibilities, buying_timeline, top_priorities, meeting_intent, purchasing_authority, top_5_preferences"
      )
      .eq("conference_id", conferenceId)
      .in("status", ["submitted", "confirmed"])
      .in("registration_type", ["delegate", "observer"]),
    adminClient
      .from("conference_registrations")
      .select(
        "id, organization_id, user_id, primary_category, secondary_categories, buying_cycles_targeted, meeting_outcome_intent, sales_readiness"
      )
      .eq("conference_id", conferenceId)
      .in("status", ["submitted", "confirmed"])
      .eq("registration_type", "exhibitor"),
  ]);

  if (delegatesResult.error) {
    throw new Error(`Failed to load delegate candidates: ${delegatesResult.error.message}`);
  }
  if (exhibitorsResult.error) {
    throw new Error(`Failed to load exhibitor candidates: ${exhibitorsResult.error.message}`);
  }

  // Refusals are standing org-to-org facts, loaded from org_meeting_refusals —
  // NOT from the per-registration blackout_list they used to live in. That
  // column was scoped to one registration for one conference, so a refusal
  // expired every year unless someone retyped it. See lib/org/meeting-refusals.ts.
  const refusalOrgIds = [
    ...(delegatesResult.data ?? []).map((row) => row.organization_id),
    ...(exhibitorsResult.data ?? []).map((row) => row.organization_id),
  ].filter((id): id is string => Boolean(id));
  const blackoutByOrg = await loadBlackoutListsByOrg(refusalOrgIds);

  const delegates: DelegateProfile[] = (delegatesResult.data ?? []).map((row) => ({
    registrationId: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    categoryResponsibilities: normalizeStringArray(row.category_responsibilities),
    buyingTimeline: normalizeStringArray(row.buying_timeline),
    topPriorities: normalizeStringArray(row.top_priorities),
    meetingIntent: normalizeStringArray(row.meeting_intent),
    purchasingAuthority: row.purchasing_authority,
    top5Preferences: normalizeStringArray(row.top_5_preferences),
    blackoutList: blackoutByOrg.get(row.organization_id) ?? [],
  }));

  const exhibitors: ExhibitorProfile[] = (exhibitorsResult.data ?? []).map((row) => ({
    registrationId: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    primaryCategory: row.primary_category,
    secondaryCategories: normalizeStringArray(row.secondary_categories),
    buyingCyclesTargeted: normalizeStringArray(row.buying_cycles_targeted),
    meetingOutcomeIntent: normalizeStringArray(row.meeting_outcome_intent),
    salesReadiness: normalizeSalesReadiness(row.sales_readiness),
    blackoutList: blackoutByOrg.get(row.organization_id) ?? [],
  }));

  if (delegates.length === 0 || exhibitors.length === 0) {
    throw new Error(
      "INSUFFICIENT_ACTIVE_REGISTRATIONS: paid order metadata did not resolve to active delegate/exhibitor registrations."
    );
  }

  return { delegates, exhibitors };
}

export async function createSchedulerDraftRun(
  conferenceId: string,
  seed?: number
): Promise<SchedulerActionSuccess<SchedulerRunSummary> | SchedulerActionFailure> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { success: false, error: auth.error };

  const policySet = await getActivePolicySet();
  if (!policySet) {
    await logAuditEventSafe({
      action: "scheduler_run_create",
      entityType: "scheduler_run",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        reason: "missing_active_policy_set",
      },
    });
    return { success: false, error: "No active policy set available for scheduler run." };
  }

  const runSeed = seed ?? Math.floor(Math.random() * 2_147_483_647);
  const adminClient = createAdminClient();

  const { data: runRow, error: runInsertError } = await adminClient
    .from("scheduler_runs")
    .insert({
      conference_id: conferenceId,
      policy_set_id: policySet.id,
      run_seed: runSeed,
      run_mode: "draft",
      status: "running",
      run_by: auth.ctx.userId,
      metadata: {
        commerce_eligibility_mode: "ready",
      },
    })
    .select("*")
    .single();

  if (runInsertError || !runRow) {
    const isConflict = runInsertError?.code === "23505";
    if (isConflict) {
      await logAuditEventSafe({
        action: "scheduler_run_create",
        entityType: "scheduler_run",
        actorId: auth.ctx.userId,
        actorType: "user",
        details: {
          success: false,
          conferenceId,
          runSeed,
          reason: "run_locked",
          error: runInsertError?.message ?? null,
        },
      });
      return {
        success: false,
        code: "RUN_LOCKED",
        error:
          "A scheduler run is already active for this conference (running or same seed idempotency conflict).",
      };
    }
    await logAuditEventSafe({
      action: "scheduler_run_create",
      entityType: "scheduler_run",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        runSeed,
        reason: "insert_failed",
        error: runInsertError?.message ?? null,
      },
    });
    return { success: false, error: runInsertError?.message ?? "Failed to create scheduler run." };
  }

  try {
    const schedulingPolicy = await getSchedulingConfig();
    const scaffolding = await ensureMeetingScaffolding(conferenceId);
    const candidates = await loadEligibleCandidates(conferenceId);
    const orderedExhibitors = [...candidates.exhibitors].sort((a, b) =>
      a.registrationId.localeCompare(b.registrationId)
    );
    const exhibitorByOrg = new Map<string, ExhibitorProfile[]>();
    for (const exhibitor of orderedExhibitors) {
      const list = exhibitorByOrg.get(exhibitor.organizationId) ?? [];
      list.push(exhibitor);
      exhibitorByOrg.set(exhibitor.organizationId, list);
    }
    const usedPinnedExhibitorRegistrationIds = new Set<string>();
    const suitePinnedExhibitorBySuiteId: Record<string, string> = {};
    for (const suite of scaffolding.suites) {
      const orgId = scaffolding.suiteOrgAssignmentsBySuiteId[suite.id];
      if (!orgId) continue;
      const candidatesForOrg = exhibitorByOrg.get(orgId) ?? [];
      const chosen = candidatesForOrg.find(
        (row) => !usedPinnedExhibitorRegistrationIds.has(row.registrationId)
      );
      if (!chosen) continue;
      suitePinnedExhibitorBySuiteId[suite.id] = chosen.registrationId;
      usedPinnedExhibitorRegistrationIds.add(chosen.registrationId);
    }

    const matchScores = computeAllMatchScores(candidates.delegates, candidates.exhibitors);

    const persistedScoreInput = matchScores.map((score) => ({
      conference_id: conferenceId,
      scheduler_run_id: runRow.id,
      delegate_registration_id: score.delegateRegistrationId,
      exhibitor_registration_id: score.exhibitorRegistrationId,
      total_score: Number.isFinite(score.totalScore) ? score.totalScore : -999999,
      score_breakdown: score.breakdown as unknown as Json,
      match_reasons: score.reasons,
      is_blackout: score.isBlackout,
      is_top_5: score.isTop5,
    }));

    // NOTE: persistedScoreInput is O(delegates × exhibitors). At CSC's current
    // scale (~200 × 80 = 16K rows) this single insert is fine. If conferences
    // scale beyond ~500 × 200 = 100K rows, chunk inserts into batches of 5,000
    // to avoid PostgREST payload / timeout limits.
    const { data: persistedScores, error: persistedScoresError } = await adminClient
      .from("match_scores")
      .insert(persistedScoreInput)
      .select("id, delegate_registration_id, exhibitor_registration_id");

    if (persistedScoresError) throw new Error(persistedScoresError.message);

    const scoreIdByKey = new Map<string, string>();
    for (const row of persistedScores ?? []) {
      scoreIdByKey.set(`${row.delegate_registration_id}:${row.exhibitor_registration_id}`, row.id);
    }

    const generateResult = generateSchedule({
      delegates: candidates.delegates,
      exhibitors: candidates.exhibitors,
      meetingSlots: scaffolding.meetingSlots.map<MeetingSlotInput>((slot) => ({
        id: slot.id,
        dayNumber: slot.day_number,
        slotNumber: slot.slot_number,
        suiteId: slot.suite_id,
      })),
      matchScores,
      policy: {
        delegateCoveragePct: schedulingPolicy.delegate_coverage_pct,
        meetingGroupMin: schedulingPolicy.meeting_group_min,
        meetingGroupMax: schedulingPolicy.meeting_group_max,
        orgCoveragePct: schedulingPolicy.org_coverage_pct,
        tiebreakMode: schedulingPolicy.tiebreak_mode,
        feasibilityRelaxation: schedulingPolicy.feasibility_relaxation,
      },
      suitePinnedExhibitorBySuiteId,
      // Booth holders' rooms stay theirs even when unstaffed. See generate.ts.
      reservedSuiteIds: reservedSuiteIds(scaffolding.suiteOrgAssignmentsBySuiteId),
      seed: runSeed,
    });

    // Hard constraint violations (BLACKOUT, DUPLICATE_EXHIBITOR_ORG, GROUP_BOUNDS)
    // → infeasible: discard assignments, nothing usable.
    // Soft violations (targets/coverage) → completed_with_warnings: persist
    // assignments so admins can review and promote if acceptable.
    if (generateResult.status === "infeasible") {
      await adminClient
        .from("scheduler_runs")
        .update({
          status: "infeasible",
          completed_at: new Date().toISOString(),
          total_delegates: candidates.delegates.length,
          total_exhibitors: candidates.exhibitors.length,
          total_meetings_created: 0,
          constraint_violations: generateResult.diagnostics as unknown as Json,
        })
        .eq("id", runRow.id);

      const { data: finalRun } = await adminClient
        .from("scheduler_runs")
        .select("*")
        .eq("id", runRow.id)
        .single();

      await logAuditEventSafe({
        action: "scheduler_run_create",
        entityType: "scheduler_run",
        entityId: runRow.id,
        actorId: auth.ctx.userId,
        actorType: "user",
        details: {
          success: true,
          conferenceId,
          runSeed,
          status: "infeasible",
          diagnostics: generateResult.diagnostics,
        },
      });

      return {
        success: true,
        data: mapRunSummary((finalRun ?? runRow) as SchedulerRunRow),
      };
    }

    const schedulesInput: Database["public"]["Tables"]["schedules"]["Insert"][] =
      generateResult.assignments.map((assignment) => ({
        conference_id: conferenceId,
        scheduler_run_id: runRow.id,
        meeting_slot_id: assignment.meetingSlotId,
        exhibitor_registration_id: assignment.exhibitorRegistrationId,
        delegate_registration_ids: assignment.delegateRegistrationIds,
        match_score_ids: assignment.matchScoreKeys
          .map((key) => scoreIdByKey.get(key))
          .filter((id): id is string => Boolean(id)),
        status: "scheduled",
      }));

    const { error: scheduleInsertError } = await adminClient
      .from("schedules")
      .insert(schedulesInput);

    if (scheduleInsertError) throw new Error(scheduleInsertError.message);

    // Both "completed" and "completed_with_warnings" persist assignments.
    // DB run status is always "completed" — soft warnings live in the
    // constraint_violations JSONB for admin review.
    const { data: completedRun, error: completeError } = await adminClient
      .from("scheduler_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        total_delegates: candidates.delegates.length,
        total_exhibitors: candidates.exhibitors.length,
        total_meetings_created: schedulesInput.length,
        constraint_violations: generateResult.diagnostics as unknown as Json,
      })
      .eq("id", runRow.id)
      .select("*")
      .single();

    if (completeError || !completedRun) {
      throw new Error(completeError?.message ?? "Failed to finalize scheduler run.");
    }

    await logAuditEventSafe({
      action: "scheduler_run_create",
      entityType: "scheduler_run",
      entityId: completedRun.id,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: true,
        conferenceId,
        runSeed,
        status: completedRun.status,
        totalMeetingsCreated: schedulesInput.length,
      },
    });

    return {
      success: true,
      data: mapRunSummary(completedRun),
    };
  } catch (error) {
    await adminClient
      .from("scheduler_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        constraint_violations: {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Json,
      })
      .eq("id", runRow.id);

    await logAuditEventSafe({
      action: "scheduler_run_create",
      entityType: "scheduler_run",
      entityId: runRow.id,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        runSeed,
        reason: "generation_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : "Scheduler run failed.",
    };
  }
}

export async function getSchedulerRun(
  conferenceId: string,
  runId: string
): Promise<SchedulerActionSuccess<SchedulerRunRow> | SchedulerActionFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("scheduler_runs")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("id", runId)
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Scheduler run not found." };
  }

  return { success: true, data };
}

export async function listSchedulerRuns(
  conferenceId: string,
  filters: SchedulerRunFilters = {}
): Promise<SchedulerActionSuccess<SchedulerRunSummary[]> | SchedulerActionFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  let query = adminClient
    .from("scheduler_runs")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("started_at", { ascending: false });

  if (filters.runMode) query = query.eq("run_mode", filters.runMode);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  return {
    success: true,
    data: (data ?? []).map((row) => mapRunSummary(row as SchedulerRunRow)),
  };
}

export async function getSchedulerDiagnosticsSummary(
  conferenceId: string,
  runId: string
): Promise<SchedulerActionSuccess<Json | null> | SchedulerActionFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("scheduler_runs")
    .select("constraint_violations")
    .eq("conference_id", conferenceId)
    .eq("id", runId)
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data: data?.constraint_violations ?? null };
}

export async function promoteSchedulerRun(
  conferenceId: string,
  runId: string
): Promise<SchedulerActionSuccess<SchedulerRunSummary> | SchedulerActionFailure> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.rpc("promote_scheduler_run", {
    p_conference_id: conferenceId,
    p_run_id: runId,
    p_activated_by: auth.ctx.userId,
  });

  if (error || !data) {
    await logAuditEventSafe({
      action: "scheduler_run_promote",
      entityType: "scheduler_run",
      entityId: runId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        error: error?.message ?? "Failed to promote scheduler run.",
      },
    });
    return { success: false, error: error?.message ?? "Failed to promote scheduler run." };
  }

  await logAuditEventSafe({
    action: "scheduler_run_promote",
    entityType: "scheduler_run",
    entityId: runId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      conferenceId,
      promotedRunId: runId,
    },
  });

  return {
    success: true,
    data: mapRunSummary(data as SchedulerRunRow),
  };
}
