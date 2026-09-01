"use server";

import {
  isGlobalAdmin,
  requireAdmin,
  requireAuthenticated,
} from "@/lib/auth/guards";
import type { Database, Json } from "@/lib/database.types";
import { getSchedulingConfig } from "@/lib/policy/engine";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { computeMatchScore } from "@/lib/scheduler/scoring";
import {
  buildWhyLowerReasons,
  countConsumedSwaps,
  hasLinkedSlotConflict,
  isTwoWayBlackout,
  rankSwapAlternatives,
} from "@/lib/scheduler/swaps";
import type {
  ScoreBreakdown,
  SwapAlternative,
  SwapCapStatus,
  SwapCountMode,
  SwapRequestSummary,
} from "@/lib/scheduler/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMeetingCandidates, siblingSeatIds } from "@/lib/conference/meeting-candidates";
import { loadSeatHoldings } from "@/lib/conference/seats";

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
    delegateSeatId: row.delegate_seat_id,
    dropScheduleId: row.drop_schedule_id,
    replacementExhibitorSeatId: row.replacement_exhibitor_seat_id,
    replacementScheduleId: row.replacement_schedule_id,
    status: row.status as SwapRequestSummary["status"],
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
  delegateSeatId: string
): Promise<number> {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("swap_cap_increase_requests")
    .select("requested_extra_swaps")
    .eq("conference_id", conferenceId)
    .eq("delegate_seat_id", delegateSeatId)
    .eq("status", "approved");

  if (error) throw new Error(error.message);

  return (data ?? []).reduce((sum, row) => sum + row.requested_extra_swaps, 0);
}

async function getSwapCapStatus(
  conferenceId: string,
  delegateSeatId: string,
  countMode: SwapCountMode,
  baseCap: number
): Promise<SwapCapStatus> {
  const adminClient = createAdminClient();
  const [{ data: swapRows, error: swapError }, approvedExtraSwaps] = await Promise.all([
    adminClient
      .from("swap_requests")
      .select("status")
      .eq("conference_id", conferenceId)
      .eq("delegate_seat_id", delegateSeatId),
    getApprovedExtraSwaps(conferenceId, delegateSeatId),
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

/**
 * `toDelegateProfile` / `toExhibitorProfile` are GONE. They mapped
 * conference_registrations rows into solver profiles — a second copy of the
 * mapping the scheduler did, from a table with no writer. Both now come from
 * loadMeetingCandidates, so a swap is scored against the same idea of a person
 * that produced the meeting it is replacing.
 */
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
  delegateSeatId: string,
  dropScheduleId: string
): Promise<
  | ActionSuccess<{ requestId: string; alternatives: SwapAlternative[]; capStatus: SwapCapStatus }>
  | ActionFailure
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  /**
   * The delegate is a named SEAT. conference_registrations has 0 rows and no
   * writer, so this lookup could only ever fail — which is why swaps has never
   * run either.
   */
  const candidates = await loadMeetingCandidates(adminClient, conferenceId);
  const delegateSeat = candidates.seatById.get(delegateSeatId) ?? null;
  const delegateReg = delegateSeat
    ? {
        holderUserId: delegateSeat.holderUserId,
        organization_id: delegateSeat.organizationId,
        conference_id: delegateSeat.conferenceId,
      }
    : null;

  if (!delegateReg) {
    return { success: false, error: "That delegate seat was not found in this conference." };
  }

  if (
    delegateReg.holderUserId !== auth.ctx.userId &&
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
      delegateSeatId,
      countMode,
      scheduling.swap_cap
    );

    if (capStatus.consumed >= capStatus.effectiveCap) {
      await adminClient.from("swap_requests").insert({
        conference_id: conferenceId,
        scheduler_run_id: activeRun.id,
        delegate_seat_id: delegateSeatId,
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
          delegateSeatId,
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

    if (!dropSchedule.delegate_seat_ids.includes(delegateSeatId)) {
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
      row.delegate_seat_ids.includes(delegateSeatId)
    );
    /**
     * A person named to more than one seat must not be booked into both at
     * once. This was `linked_registration_id` — a hand-kept pointer at a second
     * registration. Two seats with the same holder say it without being told.
     */
    const linkedSeatIds = siblingSeatIds(delegateSeatId, candidates.seatById.values());
    const linkedSchedules = linkedSeatIds.length
      ? activeSchedules.filter((row) =>
          row.delegate_seat_ids.some((id: string) => linkedSeatIds.includes(id))
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

    // Same profiles the scheduler used to make these meetings — one source, so a
    // swap cannot be scored against a different idea of who the exhibitor is.
    const exhibitorRegs = candidates.exhibitors;

    const exhibitorById = new Map(
      exhibitorRegs.map((row) => [row.registrationId, row] as const)
    );

    const existingOrgIds = new Set<string>();
    for (const schedule of delegateSchedules) {
      if (schedule.id === dropScheduleId) continue;
      const exhibitor = exhibitorById.get(schedule.exhibitor_seat_id);
      if (exhibitor?.organizationId) existingOrgIds.add(exhibitor.organizationId);
    }

    const { data: matchScores, error: scoreError } = await adminClient
      .from("match_scores")
      .select(
        "exhibitor_seat_id, total_score, score_breakdown, match_reasons, is_blackout"
      )
      .eq("conference_id", conferenceId)
      .eq("scheduler_run_id", activeRun.id)
      .eq("delegate_seat_id", delegateSeatId);

    if (scoreError) throw new Error(scoreError.message);

    const scoreByExhibitor = new Map(
      (matchScores ?? []).map((row) => [row.exhibitor_seat_id, row] as const)
    );

    const originalScore = scoreByExhibitor.get(dropSchedule.exhibitor_seat_id);
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

    const delegateProfile = candidates.delegates.find((d) => d.registrationId === delegateSeatId);
    if (!delegateProfile) {
      return { success: false, error: "That seat is not a schedulable delegate seat." };
    }
    const alternatives: SwapAlternative[] = [];

    for (const schedule of activeSchedules) {
      if (schedule.id === dropScheduleId) continue;
      if (schedule.delegate_seat_ids.includes(delegateSeatId)) continue;
      if (
        hasLinkedSlotConflict(
          schedule.meeting_slot_id,
          occupiedSlotIds,
          linkedOccupiedSlotIds
        )
      ) {
        continue;
      }
      if (schedule.delegate_seat_ids.length >= scheduling.meeting_group_max) continue;

      const exhibitorReg = exhibitorById.get(schedule.exhibitor_seat_id);
      if (!exhibitorReg) continue;

      const exhibitorOrgId = exhibitorReg.organizationId;
      if (existingOrgIds.has(exhibitorOrgId)) continue;

      const exhibitorBlackoutList = exhibitorReg.blackoutList;
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

      const persistedScore = scoreByExhibitor.get(exhibitorReg.registrationId);
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
          : computeMatchScore(delegateProfile, exhibitorReg);

      if (
        !Number.isFinite(computedScore.totalScore) ||
        computedScore.isBlackout === true
      ) {
        continue;
      }

      const whyLower = buildWhyLowerReasons(originalBreakdown, computedScore.breakdown);
      alternatives.push({
        scheduleId: schedule.id,
        exhibitorSeatId: exhibitorReg.registrationId,
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
        delegate_seat_id: delegateSeatId,
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
        delegateSeatId,
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
        delegateSeatId,
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

  // Who owns this swap = who is named to the seat.
  const { seats } = await loadSeatHoldings(adminClient, {
    conferenceId: swapRequest.conference_id,
    entityKinds: ["registration"],
  });
  const delegateReg = seats.find((seat) => seat.seatId === swapRequest.delegate_seat_id) ?? null;

  if (!delegateReg) {
    return { success: false, error: "That delegate seat was not found." };
  }

  if (
    delegateReg.holderUserId !== auth.ctx.userId &&
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

  const { seats } = await loadSeatHoldings(adminClient, {
    conferenceId: data.conference_id,
    entityKinds: ["registration"],
  });
  const delegateReg = seats.find((seat) => seat.seatId === data.delegate_seat_id) ?? null;

  if (!delegateReg || delegateReg.holderUserId !== auth.ctx.userId) {
    return { success: false, error: "Not authorized for this swap request." };
  }

  return { success: true, data: mapSwapRequestSummary(data) };
}

export async function listSwapRequests(
  conferenceId: string,
  delegateSeatId?: string
): Promise<ActionSuccess<SwapRequestSummary[]> | ActionFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  let query = adminClient
    .from("swap_requests")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("created_at", { ascending: false });

  if (delegateSeatId) {
    query = query.eq("delegate_seat_id", delegateSeatId);
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
  delegateSeatId: string,
  requestedExtraSwaps: number,
  reason: string
): Promise<ActionSuccess<SwapCapIncreaseRequestRow> | ActionFailure> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!Number.isInteger(requestedExtraSwaps) || requestedExtraSwaps <= 0) {
    return { success: false, error: "Requested extra swaps must be a positive integer." };
  }

  const adminClient = createAdminClient();
  const { seats } = await loadSeatHoldings(adminClient, { conferenceId, entityKinds: ["registration"] });
  const delegateReg = seats.find((seat) => seat.seatId === delegateSeatId) ?? null;

  if (!delegateReg) {
    return { success: false, error: "That delegate seat was not found in this conference." };
  }

  if (
    delegateReg.holderUserId !== auth.ctx.userId &&
    !isGlobalAdmin(auth.ctx.globalRole)
  ) {
    return { success: false, error: "Not authorized for this delegate." };
  }

  const { data, error } = await adminClient
    .from("swap_cap_increase_requests")
    .insert({
      conference_id: conferenceId,
      delegate_seat_id: delegateSeatId,
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
        delegateSeatId,
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
      delegateSeatId,
      requestedExtraSwaps,
    },
  });

  return { success: true, data };
}

export async function listSwapCapIncreaseRequests(
  conferenceId: string,
  delegateSeatId?: string
): Promise<ActionSuccess<SwapCapIncreaseRequestRow[]> | ActionFailure> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  let query = adminClient
    .from("swap_cap_increase_requests")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("created_at", { ascending: false });

  if (delegateSeatId) {
    query = query.eq("delegate_seat_id", delegateSeatId);
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
      delegateSeatId: data.delegate_seat_id,
    },
  });

  return { success: true, data };
}

export async function adminGrantSwapCapIncrease(
  conferenceId: string,
  delegateSeatId: string,
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
  const { seats } = await loadSeatHoldings(adminClient, { conferenceId, entityKinds: ["registration"] });
  const delegateReg = seats.find((seat) => seat.seatId === delegateSeatId) ?? null;

  if (!delegateReg) {
    return { success: false, error: "That delegate seat was not found in this conference." };
  }

  const { data, error } = await adminClient
    .from("swap_cap_increase_requests")
    .insert({
      conference_id: conferenceId,
      delegate_seat_id: delegateSeatId,
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
        delegateSeatId,
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
      delegateSeatId,
      extraSwaps,
    },
  });

  return { success: true, data };
}
