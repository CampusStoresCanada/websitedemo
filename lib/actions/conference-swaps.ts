"use server";

import {
  isGlobalAdmin,
  requireAdmin,
  requireAuthenticated,
} from "@/lib/auth/guards";
import type { Database, Json } from "@/lib/database.types";
import { getSchedulingConfig } from "@/lib/policy/engine";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { normalizeStringArray, normalizeSalesReadiness } from "@/lib/scheduler/normalize";
import { computeMatchScore } from "@/lib/scheduler/scoring";
import {
  buildWhyLowerReasons,
  countConsumedSwaps,
  hasLinkedSlotConflict,
  isTwoWayBlackout,
  rankSwapAlternatives,
} from "@/lib/scheduler/swaps";
import type {
  DelegateProfile,
  ExhibitorProfile,
  ScoreBreakdown,
  SwapAlternative,
  SwapCapStatus,
  SwapCountMode,
  SwapRequestSummary,
} from "@/lib/scheduler/types";
import { createAdminClient } from "@/lib/supabase/admin";

type SwapRequestRow = Database["public"]["Tables"]["swap_requests"]["Row"];
type SwapCapIncreaseRequestRow =
  Database["public"]["Tables"]["swap_cap_increase_requests"]["Row"];

interface ActionFailure {
  success: false;
  error: string;
  code?: string;
}

interface ActionSuccess<T> {
  success: true;
  data: T;
}

function mapSwapCommitError(error?: { message?: string; code?: string } | null): {
  reason: string;
  userMessage: string;
} {
  const raw = (error?.message ?? "SWAP_COMMIT_FAILED").toUpperCase();

  if (
    raw.includes("SWAP_RUN_NOT_ACTIVE") ||
    raw.includes("SCHEDULER_RUN_NOT_FOUND")
  ) {
    return {
      reason: "stale_schedule_conflict",
      userMessage:
        "The active schedule changed while processing your swap. Refresh and try again.",
    };
  }

  if (
    raw.includes("DELEGATE_SLOT_CONFLICT") ||
    raw.includes("LINKED_REGISTRATION_SLOT_CONFLICT") ||
    raw.includes("SWAP_REQUEST_NOT_READY")
  ) {
    return {
      reason: "stale_schedule_conflict",
      userMessage:
        "This swap is no longer valid because schedule state changed. Refresh and choose another option.",
    };
  }

  if (raw.includes("BLACKOUT_VIOLATION")) {
    return {
      reason: "constraint_blackout",
      userMessage: "Swap blocked due to a blackout rule.",
    };
  }

  if (raw.includes("DUPLICATE_EXHIBITOR_ORG_VIOLATION")) {
    return {
      reason: "constraint_duplicate_exhibitor_org",
      userMessage:
        "Swap blocked because it would duplicate an exhibitor organization in your schedule.",
    };
  }

  if (raw.includes("REPLACEMENT_GROUP_MAX_EXCEEDED") || raw.includes("DROP_GROUP_MIN_VIOLATION")) {
    return {
      reason: "constraint_group_bounds",
      userMessage: "Swap blocked due to meeting group size constraints.",
    };
  }

  return {
    reason: "swap_commit_failed",
    userMessage: error?.message ?? "Swap commit failed.",
  };
}

function mapSwapRequestSummary(row: SwapRequestRow): SwapRequestSummary {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    schedulerRunId: row.scheduler_run_id,
    delegateRegistrationId: row.delegate_registration_id,
    dropScheduleId: row.drop_schedule_id,
    replacementExhibitorId: row.replacement_exhibitor_id,
    replacementScheduleId: row.replacement_schedule_id,
    status: row.status,
    swapNumber: row.swap_number,
    adminOverride: row.admin_override,
    reason: row.reason,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

async function resolveActiveRun(conferenceId: string): Promise<{
  id: string;
  conference_id: string;
}> {
  const adminClient = createAdminClient();
  const { data: run, error } = await adminClient
    .from("scheduler_runs")
    .select("id, conference_id, run_mode, status")
    .eq("conference_id", conferenceId)
    .eq("run_mode", "active")
    .eq("status", "completed")
    .single();

  if (error || !run) {
    throw new Error("No active completed scheduler run found.");
  }

  return { id: run.id, conference_id: run.conference_id };
}

async function getApprovedExtraSwaps(
  conferenceId: string,
  delegateRegistrationId: string
): Promise<number> {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("swap_cap_increase_requests")
    .select("requested_extra_swaps")
    .eq("conference_id", conferenceId)
    .eq("delegate_registration_id", delegateRegistrationId)
    .eq("status", "approved");

  if (error) throw new Error(error.message);

  return (data ?? []).reduce((sum, row) => sum + row.requested_extra_swaps, 0);
}

async function getSwapCapStatus(
  conferenceId: string,
  delegateRegistrationId: string,
  countMode: SwapCountMode,
  baseCap: number
): Promise<SwapCapStatus> {
  const adminClient = createAdminClient();
  const [{ data: swapRows, error: swapError }, approvedExtraSwaps] = await Promise.all([
    adminClient
      .from("swap_requests")
      .select("status")
      .eq("conference_id", conferenceId)
      .eq("delegate_registration_id", delegateRegistrationId),
    getApprovedExtraSwaps(conferenceId, delegateRegistrationId),
  ]);

  if (swapError) throw new Error(swapError.message);

  const consumed = countConsumedSwaps((swapRows ?? []) as Array<{ status: string }>, countMode);
  const effectiveCap = baseCap + approvedExtraSwaps;

  return {
    baseCap,
    approvedExtraSwaps,
    effectiveCap,
    consumed,
    remaining: Math.max(effectiveCap - consumed, 0),
    countMode,
  };
}

function toDelegateProfile(
  row: Database["public"]["Tables"]["conference_registrations"]["Row"]
): DelegateProfile {
  return {
    registrationId: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    categoryResponsibilities: normalizeStringArray(row.category_responsibilities),
    buyingTimeline: normalizeStringArray(row.buying_timeline),
    topPriorities: normalizeStringArray(row.top_priorities),
    meetingIntent: normalizeStringArray(row.meeting_intent),
    purchasingAuthority: row.purchasing_authority,
    top5Preferences: normalizeStringArray(row.top_5_preferences),
    blackoutList: normalizeStringArray(row.blackout_list),
  };
}

function toExhibitorProfile(
  row: Database["public"]["Tables"]["conference_registrations"]["Row"]
): ExhibitorProfile {
  return {
    registrationId: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    primaryCategory: row.primary_category,
    secondaryCategories: normalizeStringArray(row.secondary_categories),
    buyingCyclesTargeted: normalizeStringArray(row.buying_cycles_targeted),
    meetingOutcomeIntent: normalizeStringArray(row.meeting_outcome_intent),
    salesReadiness: normalizeSalesReadiness(row.sales_readiness),
  };
}

function extractBreakdown(value: Json): ScoreBreakdown | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  const numberOrZero = (key: string) =>
    typeof v[key] === "number" && Number.isFinite(v[key]) ? (v[key] as number) : 0;

  return {
    category_overlap: numberOrZero("category_overlap"),
    buying_timeline_match: numberOrZero("buying_timeline_match"),
    priority_alignment: numberOrZero("priority_alignment"),
    top_5_preference: numberOrZero("top_5_preference"),
    meeting_intent_match: numberOrZero("meeting_intent_match"),
    purchasing_authority: numberOrZero("purchasing_authority"),
    blackout_penalty:
      typeof v.blackout_penalty === "number" ? (v.blackout_penalty as number) : 0,
  };
}

export async function requestSwap(
  conferenceId: string,
  delegateRegistrationId: string,
  dropScheduleId: string
): Promise<
  | ActionSuccess<{ requestId: string; alternatives: SwapAlternative[]; capStatus: SwapCapStatus }>
  | ActionFailure
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: delegateReg, error: delegateError } = await adminClient
    .from("conference_registrations")
    .select("*")
    .eq("id", delegateRegistrationId)
    .eq("conference_id", conferenceId)
    .single();

  if (delegateError || !delegateReg) {
    return { success: false, error: "Delegate registration not found." };
  }

  if (
    delegateReg.user_id !== auth.ctx.userId &&
    !isGlobalAdmin(auth.ctx.globalRole)
  ) {
    return { success: false, error: "Not authorized for this delegate." };
  }

  try {
    const activeRun = await resolveActiveRun(conferenceId);
    const scheduling = await getSchedulingConfig();
    const countMode = scheduling.swap_count_mode ?? "requested";
    const capStatus = await getSwapCapStatus(
      conferenceId,
      delegateRegistrationId,
      countMode,
      scheduling.swap_cap
    );

    if (capStatus.consumed >= capStatus.effectiveCap) {
      await adminClient.from("swap_requests").insert({
        conference_id: conferenceId,
        scheduler_run_id: activeRun.id,
        delegate_registration_id: delegateRegistrationId,
        drop_schedule_id: dropScheduleId,
        status: "denied_cap_reached",
        swap_number: capStatus.consumed + 1,
        reason: "cap_reached",
      });

      await logAuditEventSafe({
        action: "swap_request_create",
        entityType: "swap_request",
        actorId: auth.ctx.userId,
        actorType: "user",
        details: {
          success: false,
          conferenceId,
          delegateRegistrationId,
          dropScheduleId,
          reason: "cap_reached",
          consumed: capStatus.consumed,
          effectiveCap: capStatus.effectiveCap,
        },
      });
      return {
        success: false,
        code: "SWAP_CAP_REACHED",
        error: `You've used all ${capStatus.effectiveCap} swaps. Request a cap increase.`,
      };
    }

    const { data: dropSchedule, error: dropError } = await adminClient
      .from("schedules")
      .select("*")
      .eq("id", dropScheduleId)
      .eq("conference_id", conferenceId)
      .eq("scheduler_run_id", activeRun.id)
      .single();

    if (dropError || !dropSchedule) {
      return { success: false, error: "Drop schedule not found in active run." };
    }

    if (!dropSchedule.delegate_registration_ids.includes(delegateRegistrationId)) {
      return { success: false, error: "Dropped meeting does not belong to delegate." };
    }

    const { data: runSchedules, error: schedulesError } = await adminClient
      .from("schedules")
      .select("*")
      .eq("conference_id", conferenceId)
      .eq("scheduler_run_id", activeRun.id)
      .neq("status", "canceled");

    if (schedulesError) throw new Error(schedulesError.message);

    const activeSchedules = runSchedules ?? [];
    const delegateSchedules = activeSchedules.filter((row) =>
      row.delegate_registration_ids.includes(delegateRegistrationId)
    );
    const linkedRegistrationId = delegateReg.linked_registration_id;
    const linkedSchedules = linkedRegistrationId
      ? activeSchedules.filter((row) =>
          row.delegate_registration_ids.includes(linkedRegistrationId)
        )
      : [];
    const occupiedSlotIds = new Set(
      delegateSchedules
        .filter((row) => row.id !== dropScheduleId)
        .map((row) => row.meeting_slot_id)
    );
    const linkedOccupiedSlotIds = new Set(
      linkedSchedules.map((row) => row.meeting_slot_id)
    );

    const exhibitorIds = [...new Set(activeSchedules.map((row) => row.exhibitor_registration_id))];
    const { data: exhibitorRegs, error: exhibitorError } = await adminClient
      .from("conference_registrations")
      .select("*")
      .eq("conference_id", conferenceId)
      .in("id", exhibitorIds);

    if (exhibitorError) throw new Error(exhibitorError.message);

    const exhibitorById = new Map(
      (exhibitorRegs ?? []).map((row) => [row.id, row] as const)
    );

    const existingOrgIds = new Set<string>();
    for (const schedule of delegateSchedules) {
      if (schedule.id === dropScheduleId) continue;
      const exhibitor = exhibitorById.get(schedule.exhibitor_registration_id);
      if (exhibitor?.organization_id) existingOrgIds.add(exhibitor.organization_id);
    }

    const { data: matchScores, error: scoreError } = await adminClient
      .from("match_scores")
      .select(
        "exhibitor_registration_id, total_score, score_breakdown, match_reasons, is_blackout"
      )
      .eq("conference_id", conferenceId)
      .eq("scheduler_run_id", activeRun.id)
      .eq("delegate_registration_id", delegateRegistrationId);

    if (scoreError) throw new Error(scoreError.message);

    const scoreByExhibitor = new Map(
      (matchScores ?? []).map((row) => [row.exhibitor_registration_id, row] as const)
    );

    const originalScore = scoreByExhibitor.get(dropSchedule.exhibitor_registration_id);
    const originalBreakdown =
      originalScore && extractBreakdown(originalScore.score_breakdown)
        ? (extractBreakdown(originalScore.score_breakdown) as ScoreBreakdown)
        : {
            category_overlap: 0,
            buying_timeline_match: 0,
            priority_alignment: 0,
            top_5_preference: 0,
            meeting_intent_match: 0,
            purchasing_authority: 0,
            blackout_penalty: 0,
          };
    const originalTotal = originalScore ? Number(originalScore.total_score) : 0;

    const delegateProfile = toDelegateProfile(delegateReg);
    const alternatives: SwapAlternative[] = [];

    for (const schedule of activeSchedules) {
      if (schedule.id === dropScheduleId) continue;
      if (schedule.delegate_registration_ids.includes(delegateRegistrationId)) continue;
      if (
        hasLinkedSlotConflict(
          schedule.meeting_slot_id,
          occupiedSlotIds,
          linkedOccupiedSlotIds
        )
      ) {
        continue;
      }
      if (schedule.delegate_registration_ids.length >= scheduling.meeting_group_max) continue;

      const exhibitorReg = exhibitorById.get(schedule.exhibitor_registration_id);
      if (!exhibitorReg) continue;

      const exhibitorOrgId = exhibitorReg.organization_id;
      if (existingOrgIds.has(exhibitorOrgId)) continue;

      const exhibitorBlackoutList = normalizeStringArray(exhibitorReg.blackout_list);
      if (
        isTwoWayBlackout(
          delegateReg.organization_id,
          delegateProfile.blackoutList,
          exhibitorOrgId,
          exhibitorBlackoutList
        )
      ) {
        continue;
      }

      const persistedScore = scoreByExhibitor.get(exhibitorReg.id);
      const persistedBreakdown =
        persistedScore && extractBreakdown(persistedScore.score_breakdown);

      const computedScore =
        persistedScore && persistedBreakdown
          ? {
              totalScore: Number(persistedScore.total_score),
              breakdown: persistedBreakdown,
              reasons: persistedScore.match_reasons ?? [],
              isBlackout: persistedScore.is_blackout,
            }
          : computeMatchScore(delegateProfile, toExhibitorProfile(exhibitorReg));

      if (
        !Number.isFinite(computedScore.totalScore) ||
        computedScore.isBlackout === true
      ) {
        continue;
      }

      const whyLower = buildWhyLowerReasons(originalBreakdown, computedScore.breakdown);
      alternatives.push({
        scheduleId: schedule.id,
        exhibitorRegistrationId: exhibitorReg.id,
        exhibitorOrganizationId: exhibitorOrgId,
        score: computedScore.totalScore,
        scoreDeltaFromOriginal: computedScore.totalScore - originalTotal,
        scoreBreakdown: computedScore.breakdown,
        reasons: computedScore.reasons,
        whyLower,
      });
    }

    const rankedAlternatives = rankSwapAlternatives(alternatives).slice(0, 15);
    const swapNumber = capStatus.consumed + 1;

    const { data: swapRequest, error: requestError } = await adminClient
      .from("swap_requests")
      .insert({
        conference_id: conferenceId,
        scheduler_run_id: activeRun.id,
        delegate_registration_id: delegateRegistrationId,
        drop_schedule_id: dropScheduleId,
        status: "options_generated",
        swap_number: swapNumber,
        alternatives_generated: rankedAlternatives as unknown as Json,
      })
      .select("*")
      .single();

    if (requestError || !swapRequest) {
      throw new Error(requestError?.message ?? "Failed to create swap request.");
    }

    await logAuditEventSafe({
      action: "swap_request_create",
      entityType: "swap_request",
      entityId: swapRequest.id,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: true,
        conferenceId,
        delegateRegistrationId,
        dropScheduleId,
        alternativesGenerated: rankedAlternatives.length,
      },
    });

    return {
      success: true,
      data: {
        requestId: swapRequest.id,
        alternatives: rankedAlternatives,
        capStatus: {
          ...capStatus,
          consumed:
            countMode === "requested" ? capStatus.consumed + 1 : capStatus.consumed,
          remaining:
            countMode === "requested"
              ? Math.max(capStatus.effectiveCap - (capStatus.consumed + 1), 0)
              : capStatus.remaining,
        },
      },
    };
  } catch (error) {
    await logAuditEventSafe({
      action: "swap_request_create",
      entityType: "swap_request",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        delegateRegistrationId,
        dropScheduleId,
        reason: "request_failed",
        error: error instanceof Error ? error.message : "Swap request failed.",
      },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Swap request failed.",
    };
  }
}

export async function commitSwap(
  requestId: string,
  replacementScheduleId: string
): Promise<ActionSuccess<SwapRequestSummary> | ActionFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: swapRequest, error: requestError } = await adminClient
    .from("swap_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (requestError || !swapRequest) {
    return { success: false, error: "Swap request not found." };
  }

  const { data: delegateReg, error: delegateError } = await adminClient
    .from("conference_registrations")
    .select("user_id")
    .eq("id", swapRequest.delegate_registration_id)
    .single();

  if (delegateError || !delegateReg) {
    return { success: false, error: "Delegate registration not found." };
  }

  if (
    delegateReg.user_id !== auth.ctx.userId &&
    !isGlobalAdmin(auth.ctx.globalRole)
  ) {
    return { success: false, error: "Not authorized for this swap request." };
  }

  if (swapRequest.status !== "options_generated") {
    return {
      success: false,
      error: "Swap request is no longer in a committable state.",
    };
  }

  const alternatives = Array.isArray(swapRequest.alternatives_generated)
    ? (swapRequest.alternatives_generated as unknown as SwapAlternative[])
    : [];
  const selectedAlternative = alternatives.find(
    (alternative) => alternative.scheduleId === replacementScheduleId
  );

  if (!selectedAlternative) {
    return {
      success: false,
      error: "Selected replacement is not in the generated alternatives.",
    };
  }

  const scheduling = await getSchedulingConfig();
  const { data, error } = await adminClient.rpc("commit_swap_request", {
    p_swap_request_id: requestId,
    p_replacement_schedule_id: replacementScheduleId,
    p_group_min: scheduling.meeting_group_min,
    p_group_max: scheduling.meeting_group_max,
    p_actor_id: auth.ctx.userId,
  });

  if (error || !data) {
    const mapped = mapSwapCommitError(error);
    await adminClient
      .from("swap_requests")
      .update({
        status: "denied_invalid",
        reason: mapped.reason,
        resolved_at: new Date().toISOString(),
        constraint_check_result: {
          ok: false,
          code: error?.code ?? "SWAP_COMMIT_FAILED",
          message: error?.message ?? "Swap commit failed.",
        } as unknown as Json,
      })
      .eq("id", requestId)
      .eq("status", "options_generated");

    await logAuditEventSafe({
      action: "swap_request_commit",
      entityType: "swap_request",
      entityId: requestId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId: swapRequest.conference_id,
        replacementScheduleId,
        reason: mapped.reason,
        error: error?.message ?? "Swap commit failed.",
        code: error?.code ?? null,
      },
    });

    return {
      success: false,
      code: error?.code,
      error: mapped.userMessage,
    };
  }

  await logAuditEventSafe({
    action: "swap_request_commit",
    entityType: "swap_request",
    entityId: requestId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      conferenceId: swapRequest.conference_id,
      replacementScheduleId,
    },
  });

  return {
    success: true,
    data: mapSwapRequestSummary(data as SwapRequestRow),
  };
}

export async function getSwapRequest(
  conferenceId: string,
  requestId: string
): Promise<ActionSuccess<SwapRequestSummary> | ActionFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("swap_requests")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("id", requestId)
    .single();

  if (error || !data) return { success: false, error: "Swap request not found." };

  if (isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: true, data: mapSwapRequestSummary(data) };
  }

  const { data: delegateReg } = await adminClient
    .from("conference_registrations")
    .select("user_id")
    .eq("id", data.delegate_registration_id)
    .single();

  if (!delegateReg || delegateReg.user_id !== auth.ctx.userId) {
    return { success: false, error: "Not authorized for this swap request." };
  }

  return { success: true, data: mapSwapRequestSummary(data) };
}

export async function listSwapRequests(
  conferenceId: string,
  delegateRegistrationId?: string
): Promise<ActionSuccess<SwapRequestSummary[]> | ActionFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  let query = adminClient
    .from("swap_requests")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("created_at", { ascending: false });

  if (delegateRegistrationId) {
    query = query.eq("delegate_registration_id", delegateRegistrationId);
  }

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  return {
    success: true,
    data: (data ?? []).map((row) => mapSwapRequestSummary(row)),
  };
}

export async function requestSwapCapIncrease(
  conferenceId: string,
  delegateRegistrationId: string,
  requestedExtraSwaps: number,
  reason: string
): Promise<ActionSuccess<SwapCapIncreaseRequestRow> | ActionFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!Number.isInteger(requestedExtraSwaps) || requestedExtraSwaps <= 0) {
    return { success: false, error: "Requested extra swaps must be a positive integer." };
  }

  const adminClient = createAdminClient();
  const { data: delegateReg, error: delegateError } = await adminClient
    .from("conference_registrations")
    .select("user_id, conference_id")
    .eq("id", delegateRegistrationId)
    .single();

  if (delegateError || !delegateReg || delegateReg.conference_id !== conferenceId) {
    return { success: false, error: "Delegate registration not found." };
  }

  if (
    delegateReg.user_id !== auth.ctx.userId &&
    !isGlobalAdmin(auth.ctx.globalRole)
  ) {
    return { success: false, error: "Not authorized for this delegate." };
  }

  const { data, error } = await adminClient
    .from("swap_cap_increase_requests")
    .insert({
      conference_id: conferenceId,
      delegate_registration_id: delegateRegistrationId,
      requested_by: auth.ctx.userId,
      requested_extra_swaps: requestedExtraSwaps,
      reason,
      status: "requested",
    })
    .select("*")
    .single();

  if (error || !data) {
    await logAuditEventSafe({
      action: "swap_cap_increase_request",
      entityType: "swap_cap_increase_request",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        delegateRegistrationId,
        requestedExtraSwaps,
        error: error?.message ?? "Failed to create cap increase request.",
      },
    });
    return {
      success: false,
      error: error?.message ?? "Failed to create cap increase request.",
    };
  }

  await logAuditEventSafe({
    action: "swap_cap_increase_request",
    entityType: "swap_cap_increase_request",
    entityId: data.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      conferenceId,
      delegateRegistrationId,
      requestedExtraSwaps,
    },
  });

  return { success: true, data };
}

export async function listSwapCapIncreaseRequests(
  conferenceId: string,
  delegateRegistrationId?: string
): Promise<ActionSuccess<SwapCapIncreaseRequestRow[]> | ActionFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  let query = adminClient
    .from("swap_cap_increase_requests")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("created_at", { ascending: false });

  if (delegateRegistrationId) {
    query = query.eq("delegate_registration_id", delegateRegistrationId);
  }

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

export async function decideSwapCapIncreaseRequest(
  requestId: string,
  decision: "approved" | "denied",
  adminNote?: string
): Promise<ActionSuccess<SwapCapIncreaseRequestRow> | ActionFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!["approved", "denied"].includes(decision)) {
    return { success: false, error: "Decision must be approved or denied." };
  }

  const scheduling = await getSchedulingConfig();
  if (decision === "approved" && scheduling.swap_admin_override !== true) {
    return {
      success: false,
      error: "Policy currently disallows admin swap cap overrides.",
    };
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("swap_cap_increase_requests")
    .update({
      status: decision,
      admin_note: adminNote ?? null,
      decided_by: auth.ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "requested")
    .select("*")
    .single();

  if (error || !data) {
    await logAuditEventSafe({
      action: "swap_cap_increase_decide",
      entityType: "swap_cap_increase_request",
      entityId: requestId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        decision,
        error: error?.message ?? "Cap increase request not found or already resolved.",
      },
    });
    return {
      success: false,
      error: error?.message ?? "Cap increase request not found or already resolved.",
    };
  }

  await logAuditEventSafe({
    action: "swap_cap_increase_decide",
    entityType: "swap_cap_increase_request",
    entityId: requestId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      conferenceId: data.conference_id,
      decision,
      delegateRegistrationId: data.delegate_registration_id,
    },
  });

  return { success: true, data };
}

export async function adminGrantSwapCapIncrease(
  conferenceId: string,
  delegateRegistrationId: string,
  extraSwaps: number,
  reason: string
): Promise<ActionSuccess<SwapCapIncreaseRequestRow> | ActionFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!Number.isInteger(extraSwaps) || extraSwaps <= 0) {
    return { success: false, error: "Extra swaps must be a positive integer." };
  }

  const scheduling = await getSchedulingConfig();
  if (scheduling.swap_admin_override !== true) {
    return {
      success: false,
      error: "Policy currently disallows admin swap cap overrides.",
    };
  }

  const adminClient = createAdminClient();
  const { data: delegateReg, error: delegateError } = await adminClient
    .from("conference_registrations")
    .select("id, conference_id")
    .eq("id", delegateRegistrationId)
    .single();

  if (delegateError || !delegateReg || delegateReg.conference_id !== conferenceId) {
    return { success: false, error: "Delegate registration not found." };
  }

  const { data, error } = await adminClient
    .from("swap_cap_increase_requests")
    .insert({
      conference_id: conferenceId,
      delegate_registration_id: delegateRegistrationId,
      requested_by: auth.ctx.userId,
      requested_extra_swaps: extraSwaps,
      reason: reason || "Admin override",
      status: "approved",
      admin_note: "Approved directly by admin override action.",
      decided_by: auth.ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    await logAuditEventSafe({
      action: "swap_cap_increase_admin_grant",
      entityType: "swap_cap_increase_request",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        conferenceId,
        delegateRegistrationId,
        extraSwaps,
        error: error?.message ?? "Failed to grant swap cap override.",
      },
    });
    return {
      success: false,
      error: error?.message ?? "Failed to grant swap cap override.",
    };
  }

  await logAuditEventSafe({
    action: "swap_cap_increase_admin_grant",
    entityType: "swap_cap_increase_request",
    entityId: data.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      conferenceId,
      delegateRegistrationId,
      extraSwaps,
    },
  });

  return { success: true, data };
}
