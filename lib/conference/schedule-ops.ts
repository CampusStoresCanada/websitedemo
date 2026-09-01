import { createAdminClient } from "@/lib/supabase/admin";
import { loadSeatHoldings } from "./seats";
import type { Json } from "@/lib/database.types";

export type ScheduleOpsRun = {
  id: string;
  runMode: "draft" | "active" | "archived";
  status: "running" | "completed" | "failed" | "infeasible";
  startedAt: string;
  completedAt: string | null;
  totalMeetingsCreated: number | null;
  totalDelegates: number | null;
  totalExhibitors: number | null;
  diagnostics: Json | null;
  updatedAt: string;
};

export type ScheduleOpsSlot = {
  id: string;
  dayNumber: number;
  slotNumber: number;
  startTime: string;
  endTime: string;
  suiteId: string;
};

export type ScheduleOpsSuite = {
  id: string;
  suiteNumber: number;
  isActive: boolean;
};

export type ScheduleOpsAssignment = {
  id: string;
  schedulerRunId: string;
  meetingSlotId: string;
  suiteId: string;
  dayNumber: number;
  slotNumber: number;
  exhibitorSeatId: string;
  exhibitorOrganizationName: string;
  delegateSeatIds: string[];
  delegateNames: string[];
  status: string;
  isManual: boolean;
};

export type ScheduleOpsSummary = {
  generatedAt: string;
  latestRunUpdatedAt: string | null;
  activeRunId: string | null;
  selectedRunId: string | null;
  runs: ScheduleOpsRun[];
  suites: ScheduleOpsSuite[];
  slots: ScheduleOpsSlot[];
  activeAssignments: ScheduleOpsAssignment[];
  selectedAssignments: ScheduleOpsAssignment[];
  /** How many of the active run's assignments were hand-edited (re-promote warning). */
  activeRunManualCount: number;
};

type SchedulerRunRow = {
  id: string;
  run_mode: "draft" | "active" | "archived";
  status: "running" | "completed" | "failed" | "infeasible";
  started_at: string;
  completed_at: string | null;
  total_meetings_created: number | null;
  total_delegates: number | null;
  total_exhibitors: number | null;
  constraint_violations: Json | null;
  updated_at: string;
};

type MeetingSlotRow = {
  id: string;
  suite_id: string;
  day_number: number;
  slot_number: number;
  start_time: string;
  end_time: string;
};

type SuiteRow = {
  id: string;
  suite_number: number;
  is_active: boolean;
};

type ScheduleRow = {
  id: string;
  scheduler_run_id: string;
  meeting_slot_id: string;
  exhibitor_seat_id: string;
  delegate_seat_ids: string[] | null;
  status: string;
  is_manual: boolean | null;
};

type OrganizationRow = {
  id: string;
  name: string;
};


export async function loadScheduleOpsSummary(
  conferenceId: string,
  selectedRunId?: string | null
): Promise<ScheduleOpsSummary> {
  const adminClient = createAdminClient();

  const [{ data: runsData }, { data: suitesData }, { data: slotsData }] = await Promise.all([
    adminClient
      .from("scheduler_runs")
      .select(
        "id, run_mode, status, started_at, completed_at, total_meetings_created, total_delegates, total_exhibitors, constraint_violations"
      )
      .eq("conference_id", conferenceId)
      .order("started_at", { ascending: false })
      .limit(50),
    adminClient
      .from("conference_suites")
      .select("id, suite_number, is_active")
      .eq("conference_id", conferenceId)
      .order("suite_number", { ascending: true }),
    adminClient
      .from("meeting_slots")
      .select("id, suite_id, day_number, slot_number, start_time, end_time")
      .eq("conference_id", conferenceId)
      .order("day_number", { ascending: true })
      .order("slot_number", { ascending: true }),
  ]);

  const runs = ((runsData ?? []) as SchedulerRunRow[]).map((row) => ({
    id: row.id,
    runMode: row.run_mode,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    totalMeetingsCreated: row.total_meetings_created,
    totalDelegates: row.total_delegates,
    totalExhibitors: row.total_exhibitors,
    diagnostics: row.constraint_violations,
    updatedAt: row.updated_at,
  }));

  const activeRun = runs.find(
    (run) => run.runMode === "active" && run.status === "completed"
  );
  const latestDraft = runs.find((run) => run.runMode === "draft");
  const resolvedSelectedRunId =
    (selectedRunId && runs.some((run) => run.id === selectedRunId) ? selectedRunId : null) ??
    latestDraft?.id ??
    activeRun?.id ??
    null;

  const runIdsToLoad = [
    activeRun?.id ?? null,
    resolvedSelectedRunId,
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

  let schedules: ScheduleRow[] = [];
  if (runIdsToLoad.length > 0) {
    const { data: schedulesData } = await adminClient
      .from("schedules")
      .select(
        "id, scheduler_run_id, meeting_slot_id, exhibitor_seat_id, delegate_seat_ids, status, is_manual"
      )
      .eq("conference_id", conferenceId)
      .in("scheduler_run_id", runIdsToLoad)
      .neq("status", "canceled");
    schedules = (schedulesData ?? []) as ScheduleRow[];
  }

  const exhibitorSeatIds = Array.from(
    new Set(schedules.map((row) => row.exhibitor_seat_id).filter(Boolean))
  );

  /**
   * Seats, not registrations. These ids ARE seat ids now, and the seat carries
   * its holder's name and the type it is for — so the name-and-org join that
   * used to hit conference_registrations (0 rows, no writer) is one call to the
   * canonical reader.
   */
  const { seats } = await loadSeatHoldings(adminClient, {
    conferenceId,
    entityKinds: ["registration"],
  });
  const seatById = new Map(seats.map((seat) => [seat.seatId, seat] as const));

  const exhibitorOrgIds = Array.from(
    new Set(
      exhibitorSeatIds
        .map((id) => seatById.get(id)?.organizationId)
        .filter((value): value is string => Boolean(value))
    )
  );
  let organizations: OrganizationRow[] = [];
  if (exhibitorOrgIds.length > 0) {
    const { data: orgData } = await adminClient
      .from("organizations")
      .select("id, name")
      .in("id", exhibitorOrgIds);
    organizations = (orgData ?? []) as OrganizationRow[];
  }
  const organizationById = new Map(organizations.map((row) => [row.id, row] as const));

  const slots = (slotsData ?? []) as MeetingSlotRow[];
  const slotById = new Map(slots.map((row) => [row.id, row] as const));

  const mapAssignment = (row: ScheduleRow): ScheduleOpsAssignment | null => {
    const slot = slotById.get(row.meeting_slot_id);
    if (!slot) return null;
    const exhibitorSeat = seatById.get(row.exhibitor_seat_id);
    const exhibitorOrgName =
      (exhibitorSeat?.organizationId
        ? organizationById.get(exhibitorSeat.organizationId)?.name
        : null) ?? "Unknown exhibitor";
    const delegateIds = row.delegate_seat_ids ?? [];
    const delegateNames = delegateIds.map(
      (id) => seatById.get(id)?.holderName?.trim() || id
    );

    return {
      id: row.id,
      schedulerRunId: row.scheduler_run_id,
      meetingSlotId: row.meeting_slot_id,
      suiteId: slot.suite_id,
      dayNumber: slot.day_number,
      slotNumber: slot.slot_number,
      exhibitorSeatId: row.exhibitor_seat_id,
      exhibitorOrganizationName: exhibitorOrgName,
      delegateSeatIds: delegateIds,
      delegateNames,
      status: row.status,
      isManual: row.is_manual === true,
    };
  };

  const enrichedAssignments = schedules
    .map(mapAssignment)
    .filter((value): value is ScheduleOpsAssignment => Boolean(value));

  const activeAssignments = activeRun
    ? enrichedAssignments.filter((row) => row.schedulerRunId === activeRun.id)
    : [];
  const selectedAssignments = resolvedSelectedRunId
    ? enrichedAssignments.filter((row) => row.schedulerRunId === resolvedSelectedRunId)
    : [];

  return {
    generatedAt: new Date().toISOString(),
    latestRunUpdatedAt: runs[0]?.updatedAt ?? null,
    activeRunId: activeRun?.id ?? null,
    selectedRunId: resolvedSelectedRunId,
    runs,
    suites: ((suitesData ?? []) as SuiteRow[]).map((suite) => ({
      id: suite.id,
      suiteNumber: suite.suite_number,
      isActive: suite.is_active,
    })),
    slots: slots.map((slot) => ({
      id: slot.id,
      suiteId: slot.suite_id,
      dayNumber: slot.day_number,
      slotNumber: slot.slot_number,
      startTime: slot.start_time,
      endTime: slot.end_time,
    })),
    activeAssignments,
    selectedAssignments,
    activeRunManualCount: activeAssignments.filter((a) => a.isManual).length,
  };
}

