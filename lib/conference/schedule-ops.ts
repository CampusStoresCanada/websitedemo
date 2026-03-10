import { createAdminClient } from "@/lib/supabase/admin";
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
  exhibitorRegistrationId: string;
  exhibitorOrganizationName: string;
  delegateRegistrationIds: string[];
  delegateNames: string[];
  status: string;
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
  exhibitor_registration_id: string;
  delegate_registration_ids: string[] | null;
  status: string;
};

type RegistrationRow = {
  id: string;
  registration_type: string;
  delegate_name: string | null;
  legal_name: string | null;
  organization_id: string | null;
};

type OrganizationRow = {
  id: string;
  name: string;
};

function displayNameFromRegistration(row: RegistrationRow): string {
  return (
    row.delegate_name?.trim() ||
    row.legal_name?.trim() ||
    row.id
  );
}

export async function loadScheduleOpsSummary(
  conferenceId: string,
  selectedRunId?: string | null
): Promise<ScheduleOpsSummary> {
  const adminClient = createAdminClient();

  const [{ data: runsData }, { data: suitesData }, { data: slotsData }] = await Promise.all([
    adminClient
      .from("scheduler_runs")
      .select(
        "id, run_mode, status, started_at, completed_at, total_meetings_created, total_delegates, total_exhibitors, constraint_violations, updated_at"
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
        "id, scheduler_run_id, meeting_slot_id, exhibitor_registration_id, delegate_registration_ids, status"
      )
      .eq("conference_id", conferenceId)
      .in("scheduler_run_id", runIdsToLoad)
      .neq("status", "canceled");
    schedules = (schedulesData ?? []) as ScheduleRow[];
  }

  const exhibitorRegistrationIds = Array.from(
    new Set(schedules.map((row) => row.exhibitor_registration_id).filter(Boolean))
  );
  const delegateRegistrationIds = Array.from(
    new Set(
      schedules.flatMap((row) => row.delegate_registration_ids ?? []).filter(Boolean)
    )
  );
  const registrationIds = Array.from(
    new Set([...exhibitorRegistrationIds, ...delegateRegistrationIds])
  );

  let registrations: RegistrationRow[] = [];
  if (registrationIds.length > 0) {
    const { data: registrationsData } = await adminClient
      .from("conference_registrations")
      .select("id, registration_type, delegate_name, legal_name, organization_id")
      .in("id", registrationIds);
    registrations = (registrationsData ?? []) as RegistrationRow[];
  }
  const registrationById = new Map(registrations.map((row) => [row.id, row] as const));

  const exhibitorOrgIds = Array.from(
    new Set(
      registrations
        .filter((row) => row.registration_type === "exhibitor")
        .map((row) => row.organization_id)
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
    const exhibitorReg = registrationById.get(row.exhibitor_registration_id);
    const exhibitorOrgName =
      (exhibitorReg?.organization_id
        ? organizationById.get(exhibitorReg.organization_id)?.name
        : null) ?? "Unknown exhibitor";
    const delegateIds = row.delegate_registration_ids ?? [];
    const delegateNames = delegateIds.map((id) => {
      const reg = registrationById.get(id);
      return reg ? displayNameFromRegistration(reg) : id;
    });

    return {
      id: row.id,
      schedulerRunId: row.scheduler_run_id,
      meetingSlotId: row.meeting_slot_id,
      suiteId: slot.suite_id,
      dayNumber: slot.day_number,
      slotNumber: slot.slot_number,
      exhibitorRegistrationId: row.exhibitor_registration_id,
      exhibitorOrganizationName: exhibitorOrgName,
      delegateRegistrationIds: delegateIds,
      delegateNames,
      status: row.status,
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
  };
}

