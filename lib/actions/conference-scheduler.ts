"use server";

import { requireAdmin, requireConferenceOpsAccess, requireSuperAdmin } from "@/lib/auth/guards";
import type { Database, Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePolicySet, getSchedulingConfig } from "@/lib/policy/engine";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { generateSchedule } from "@/lib/scheduler/generate";
import { loadConferenceMeetingGeometry } from "@/lib/conference/meeting-geometry-loader";
import { buildSuiteOrgAssignmentsBySuiteId } from "@/lib/conference/suite-assignment";
import { loadMeetingCandidates } from "@/lib/conference/meeting-candidates";
import { loadMeetingMatchScores, toSolverRecords } from "@/lib/conference/meeting-match-scores";
import { optimizeSchedule } from "@/lib/scheduler/optimize";
import { bestOfRestarts } from "@/lib/scheduler/search";
import { describeTotals } from "@/lib/scheduler/objective";
import { isBlackedOut } from "@/lib/scheduler/blackout";
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

/**
 * Candidate loading lives in lib/conference/meeting-candidates.ts so the swaps
 * path builds its profiles from the same code. Only the scheduler's own
 * precondition — you cannot solve with one side of the table empty — stays here.
 */
async function loadEligibleCandidates(conferenceId: string): Promise<{
  delegates: DelegateProfile[];
  exhibitors: ExhibitorProfile[];
  contactBySeatId: Map<string, string>;
  topChoices: Awaited<ReturnType<typeof loadMeetingCandidates>>["topChoices"];
}> {
  const adminClient = createAdminClient();
  const { delegates, exhibitors, seatById, contactBySeatId, topChoices } =
    await loadMeetingCandidates(adminClient, conferenceId);

  if (delegates.length === 0 || exhibitors.length === 0) {
    throw new Error(
      `INSUFFICIENT_NAMED_SEATS: the scheduler needs at least one delegate and one exhibitor named to a registration seat. ` +
        `Found ${delegates.length} delegate(s) and ${exhibitors.length} exhibitor(s) across ${seatById.size} named registration seat(s).`
    );
  }

  return { delegates, exhibitors, contactBySeatId, topChoices };
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

    /**
     * MEETINGS ARE A SUITE BENEFIT. An exhibitor whose booth includes no suite
     * is not a scheduling candidate at all — the ED's rule, 2026-09-01:
     * "$4000 booths shouldn't get meetings at all, that isn't a part of
     * included."
     *
     * So they are filtered out here rather than left in and reported as
     * unscheduled. Leaving them in made every run permanently "below exhibitor
     * target" and flagged a $4,000 booth as a problem to fix, when getting no
     * meetings is precisely what that booth costs less for.
     */
    const memberContacts = candidates.delegates
      .map((d) => ({
        contactId: candidates.contactBySeatId.get(d.registrationId) ?? "",
        orgId: d.organizationId,
      }))
      .filter((c) => c.contactId);
    const matchScoreLookup = await loadMeetingMatchScores(
      candidates.delegates.map((d) => d.organizationId),
      memberContacts
    );

    const orgIdsHoldingSuites = new Set(Object.values(scaffolding.suiteOrgAssignmentsBySuiteId));
    const schedulableExhibitors = candidates.exhibitors.filter((e) =>
      orgIdsHoldingSuites.has(e.organizationId)
    );
    const exhibitorsWithoutSuiteEntitlement =
      candidates.exhibitors.length - schedulableExhibitors.length;

    /**
     * No exhibitor holds a suite → there is nothing to schedule, and saying
     * "completed" would be a green run that did nothing. Fail with the reason,
     * because the two causes need opposite fixes: nobody named to the seat of a
     * suite-holding booth (name someone), versus every exhibitor being on a
     * booth that includes no suite (they were never getting meetings).
     */
    if (schedulableExhibitors.length === 0) {
      throw new Error(
        `NO_EXHIBITOR_HOLDS_A_SUITE: ${candidates.exhibitors.length} exhibitor(s) are named to seats, ` +
          `but none is on a booth that includes a suite, so there is no room for a meeting to happen in. ` +
          `Meetings come with a suite; a booth without one does not get them.`
      );
    }

    /**
     * ⛔ ONE SCORE SOURCE. This was computeAllMatchScores — the v2 scorer, whose
     * five of six inputs lost their home when the meeting system came off
     * conference_registrations, leaving it effectively two axes. The greedy
     * ranked on that while the local search ranked on match_edges and swaps
     * ranked on persisted v2 rows: three notions of a good pairing in one
     * pipeline, none agreeing. All three now read the promoted run.
     */
    const matchScores = toSolverRecords({
      delegates: candidates.delegates,
      exhibitors: schedulableExhibitors,
      contactBySeatId: candidates.contactBySeatId,
      scores: matchScoreLookup,
    });

    const persistedScoreInput = matchScores.map((score) => ({
      conference_id: conferenceId,
      scheduler_run_id: runRow.id,
      delegate_seat_id: score.delegateSeatId,
      exhibitor_seat_id: score.exhibitorSeatId,
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
      .select("id, delegate_seat_id, exhibitor_seat_id");

    if (persistedScoresError) throw new Error(persistedScoresError.message);

    const scoreIdByKey = new Map<string, string>();
    for (const row of persistedScores ?? []) {
      scoreIdByKey.set(`${row.delegate_seat_id}:${row.exhibitor_seat_id}`, row.id);
    }

    /**
     * HOW MANY SCHEDULES TO DRAW BEFORE PICKING ONE.
     *
     * ⛔ A single greedy-plus-local-search is ONE sample, and its quality
     * depends on the arbitrary order it started from. Steve: "you can't maximize
     * on one fill, you generate thousands and pick the best."
     *
     * ⚠️ Deliberately modest for a request-scoped run, because this one is
     * synchronous behind an admin click. The work is pure arithmetic and
     * embarrassingly parallel — every restart is independent — so the real home
     * for a large sweep is a machine we control rather than a hosted function
     * with a request timeout. Raising this is the cheapest quality lever here;
     * `restart_spread` on the run says whether it is buying anything.
     */
    const SCHEDULER_RESTARTS = 24;

    const generateInput = {
      delegates: candidates.delegates,
      exhibitors: schedulableExhibitors,
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
      seed: runSeed,
    };

    const generateResult = generateSchedule(generateInput);

    /**
     * The greedy is the SEED, not the answer. It fills slots in order and stops,
     * which delivers pairings but leaves room-time on the floor — measured on a
     * 14-exhibitor run: 122 of a possible 130 pairings, occupying 11.2% of
     * suite-slots. Local search then maximizes the stated objective
     * (Σ matchTotal × timeOccupancy) by splitting packed meetings into more
     * occupied slots and filling dead ones.
     *
     * ⛔ Legality is a filter on moves, never a term. The search cannot pair a
     * refused org, double-book a person, or seat an exhibitor in a room they do
     * not hold — those are not worse moves, they are not moves.
     */
    const delegateSeatFacts = new Map(
      candidates.delegates.map((d) => [
        d.registrationId,
        {
          orgId: d.organizationId,
          contactId: candidates.contactBySeatId.get(d.registrationId) ?? null,
        },
      ])
    );
    const exhibitorSeatFacts = new Map<string, { orgId: string; suiteId: string }>();
    for (const [suiteId, exhibitorSeatId] of Object.entries(suitePinnedExhibitorBySuiteId)) {
      const exhibitor = schedulableExhibitors.find((e) => e.registrationId === exhibitorSeatId);
      if (exhibitor) exhibitorSeatFacts.set(exhibitorSeatId, { orgId: exhibitor.organizationId, suiteId });
    }

    const blackoutByExhibitorSeat = new Map(
      schedulableExhibitors.map((e) => [e.registrationId, e])
    );
    const delegateById = new Map(candidates.delegates.map((d) => [d.registrationId, d]));

    /**
     * The shape of this run's scores, computed once and recorded on the run.
     *
     * ⛔ `degenerate` is a DIAGNOSTIC, never a correction. If it is true the
     * weight is 0 and stated picks contribute nothing — which is the right
     * failure, because a floor there would let picks drive the whole schedule
     * while the engine underneath said nothing and the result still looked fine.
     * Fix the engine, never the weight.
     */
    const scoreDistribution = describeTotals(matchScoreLookup.orgTotals);

    const optimizeContext = {
      meetingSlots: scaffolding.meetingSlots.map<MeetingSlotInput>((slot) => ({
        id: slot.id,
        dayNumber: slot.day_number,
        slotNumber: slot.slot_number,
        suiteId: slot.suite_id,
      })),
      policy: {
        meetingGroupMin: schedulingPolicy.meeting_group_min,
        meetingGroupMax: schedulingPolicy.meeting_group_max,
      },
      exhibitorSeats: exhibitorSeatFacts,
      delegateSeats: delegateSeatFacts,
      mayMeet: (delegateSeatId: string, exhibitorSeatId: string) => {
        const delegate = delegateById.get(delegateSeatId);
        const exhibitor = blackoutByExhibitorSeat.get(exhibitorSeatId);
        if (!delegate || !exhibitor) return false;
        return !isBlackedOut(delegate, exhibitor);
      },
      objective: {
        delegateSeats: delegateSeatFacts,
        exhibitorSeats: exhibitorSeatFacts,
        orgTotalFor: matchScoreLookup.orgTotalFor,
        personTotalFor: matchScoreLookup.personTotalFor,
        /**
         * What people ASKED for, alongside what the engine INFERS — two terms,
         * never one number. Both come from loadMeetingCandidates already split
         * by grain, so an org's pick counts once for the store and a delegate's
         * once for that person. See lib/scheduler/objective.ts for why this is
         * not folded into match_edges upstream.
         */
        orgPreferredFor: candidates.topChoices.orgPicked,
        personPreferredFor: candidates.topChoices.personPicked,
        /**
         * ⛔ COMPUTED FROM THIS RUN'S OWN DISTRIBUTION, never a constant.
         *
         * `total` is becoming a per-run percentile, so any weight fitted to one
         * night's numbers silently re-scales on the next — with no error, which
         * is how the match session lost 98% of its pairs to a hand-fitted band
         * after a recalibration. p75 − p50 keeps the meaning fixed instead:
         * "honouring a stated pick is worth upgrading one pairing from median to
         * upper quartile", true whatever the scale underneath.
         */
        preferenceWeight: scoreDistribution.weight,
      },
      seed: runSeed,
    };

    /**
     * DRAW MANY SCHEDULES, KEEP THE BEST — the outer loop, not one fill.
     *
     * Each restart reseeds the greedy ordering, the tiebreaks and the fill
     * order, then scores the finished schedule on the one objective. Restart
     * seeds are derived from `runSeed`, so the same run reproduces the same
     * winner exactly — a schedule nobody can regenerate is one nobody can
     * explain to a member who asks why they got these five meetings.
     */
    const search = bestOfRestarts({
      baseSeed: runSeed,
      restarts: SCHEDULER_RESTARTS,
      attempt: (seed) => {
        const draw = generateSchedule({ ...generateInput, seed });
        const improved = optimizeSchedule(draw.assignments, {
          ...optimizeContext,
          seed,
        });
        return {
          value: improved.after.value,
          result: { draw, improved },
        };
      },
    });

    const optimized = search.best.result.improved;
    generateResult.assignments = optimized.assignments;
    generateResult.diagnostics = search.best.result.draw.diagnostics;

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
        exhibitor_seat_id: assignment.exhibitorSeatId,
        delegate_seat_ids: assignment.delegateSeatIds,
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
        // The exhibitors that could actually be scheduled — a booth with no
        // suite is not one, so counting it here would overstate the roster.
        total_exhibitors: schedulableExhibitors.length,
        total_meetings_created: schedulesInput.length,
        constraint_violations: generateResult.diagnostics as unknown as Json,
        // Recorded, not warned about: a booth with no suite gets no meetings by
        // design. Kept visible so "why is my exhibitor count lower than my
        // exhibitor list" has an answer that is not a bug hunt.
        metadata: {
          ...(runRow.metadata as Record<string, unknown> | null),
          exhibitors_without_suite_entitlement: exhibitorsWithoutSuiteEntitlement,
          /**
           * What the scores looked like the night this ran, and what one stated
           * pick was therefore worth. Recorded because the weight is derived
           * from the distribution rather than fixed: without this a schedule
           * from February is unreadable in June, and a degenerate run is
           * indistinguishable from a run where nobody picked anything.
           */
          /**
           * Did drawing many schedules buy anything? `distinct_values` of 1
           * means every restart landed identically — the extra compute bought
           * nothing and either the space is flat or the seed is not reaching
           * the decisions it should. A finding, not a success.
           */
          restart_spread: {
            restarts: search.spread.restarts,
            best: search.spread.best,
            worst: search.spread.worst,
            median: search.spread.median,
            distinct_values: search.spread.distinctValues,
            winning_seed: search.best.seed,
          },
          /** Non-zero means the best schedule left someone with nothing. */
          rescue_moves: optimized.movesApplied.rescue,
          score_distribution: {
            edges: scoreDistribution.count,
            distinct_values: scoreDistribution.distinct,
            p50: scoreDistribution.p50,
            p75: scoreDistribution.p75,
            degenerate: scoreDistribution.degenerate,
          },
          preference_weight: scoreDistribution.weight,
          satisfied_preferences: optimized.after.satisfiedPreferences,
          preference_share: optimized.after.preferenceShare,
        } as unknown as Json,
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
