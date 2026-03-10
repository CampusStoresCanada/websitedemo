"use client";

import Link from "next/link";
import { useState } from "react";
import {
  saveConferenceRoomInventory,
  saveMeetingSuiteRoomAssignments,
  syncEducationSetupFromScheduleRow,
  syncOffsiteSetupFromScheduleRow,
} from "@/lib/actions/conference-schedule-design";
import { upsertConferenceProgramItem } from "@/lib/actions/conference-program";
import type { ConferenceScheduleModuleRow } from "@/lib/actions/conference-schedule-design";

type ProgramItem = {
  id: string;
  conference_id: string;
  item_type:
    | "meeting"
    | "meal"
    | "education"
    | "trade_show"
    | "offsite"
    | "move_in"
    | "move_out"
    | "custom";
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  location_label: string | null;
  audience_mode: "all_attendees" | "target_roles" | "manual_curated";
  target_roles: string[];
  is_required: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

type ParamsRow = {
  id: string;
  conference_id: string;
  conference_days: number;
  meeting_slots_per_day: number;
  slot_duration_minutes: number;
  slot_buffer_minutes: number;
  meeting_start_time: string;
  meeting_end_time: string;
  flex_time_start: string | null;
  flex_time_end: string | null;
  total_meeting_suites: number;
  delegate_target_meetings: number | null;
};

interface ConferenceScheduleDesignerProps {
  conferenceId: string;
  initialProgramItems: ProgramItem[];
  params: ParamsRow | null;
  modules: ConferenceScheduleModuleRow[];
  conferenceTimeZone?: string | null;
  initialExhibitorOrganizations: Array<{ id: string; name: string }>;
}

type RoomInventoryKind =
  | "meeting_suite"
  | "education_room"
  | "meal_space"
  | "offsite_venue"
  | "general";

type RoomInventoryRow = {
  id: string;
  name: string;
  kind: RoomInventoryKind;
  capabilities: Array<
    "meeting" | "education" | "meal" | "offsite" | "trade_show" | "move_in" | "move_out" | "none"
  >;
  capacity: number | null;
  is_bookable: boolean;
  notes: string | null;
};

const MODULE_LABELS: Record<string, string> = {
  meetings: "Meetings",
  trade_show: "Trade Show",
  education: "Education",
  meals: "Meals",
  offsite: "Offsite",
  custom: "Custom",
  registration_ops: "Registration Ops",
  communications: "Communications",
  sponsorship_ops: "Sponsorship Ops",
  logistics: "Logistics",
  travel_accommodation: "Travel + Accommodation",
  content_capture: "Content Capture",
  lead_capture: "Lead Capture",
  compliance_safety: "Compliance + Safety",
  staffing: "Staffing",
  post_event: "Post-Event",
  virtual_hybrid: "Virtual / Hybrid",
  expo_floor_plan: "Expo Floor Plan",
};

const ROOM_REQUIRED_TYPES: ProgramItem["item_type"][] = [
  "meal",
  "education",
  "trade_show",
  "offsite",
  "move_in",
  "move_out",
];

const DETAIL_REQUIRED_TYPES: ProgramItem["item_type"][] = [
  "meal",
  "education",
  "offsite",
];

const ALL_ROOM_CAPABILITY_OPTIONS: Array<{
  value:
    | "meeting"
    | "education"
    | "meal"
    | "offsite"
    | "trade_show"
    | "move_in"
    | "move_out"
    | "none";
  label: string;
}> = [
  { value: "none", label: "None of Above" },
  { value: "meeting", label: "Meetings" },
  { value: "education", label: "Education" },
  { value: "meal", label: "Meals" },
  { value: "offsite", label: "Offsite" },
  { value: "trade_show", label: "Trade Show" },
  { value: "move_in", label: "Move-In" },
  { value: "move_out", label: "Move-Out" },
];

function defaultCapabilitiesForKind(
  kind: RoomInventoryKind,
  allowedCapabilities?: ReadonlyArray<RoomInventoryRow["capabilities"][number]>
): RoomInventoryRow["capabilities"] {
  const base =
    kind === "meeting_suite"
      ? (["meeting"] as const)
      : kind === "education_room"
        ? (["education"] as const)
        : kind === "meal_space"
          ? (["meal"] as const)
          : kind === "offsite_venue"
            ? (["offsite"] as const)
            : (["meeting", "education", "meal", "offsite", "trade_show", "move_in", "move_out"] as const);
  if (!allowedCapabilities || allowedCapabilities.length === 0) return [...base];
  const filtered = base.filter((value) => allowedCapabilities.includes(value));
  if (filtered.length > 0) return [...filtered];
  return [allowedCapabilities[0]];
}

function itemTypeToCapability(
  itemType: ProgramItem["item_type"]
): RoomInventoryRow["capabilities"][number] | null {
  if (itemType === "meeting") return "meeting";
  if (itemType === "education") return "education";
  if (itemType === "meal") return "meal";
  if (itemType === "offsite") return "offsite";
  if (itemType === "trade_show") return "trade_show";
  if (itemType === "move_in") return "move_in";
  if (itemType === "move_out") return "move_out";
  return null;
}

function normalizeRoomCapabilities(
  capabilities: unknown,
  kind: RoomInventoryKind,
  allowedCapabilities?: ReadonlyArray<RoomInventoryRow["capabilities"][number]>
): RoomInventoryRow["capabilities"] {
  const values = Array.isArray(capabilities) ? capabilities : [];
  const normalized = [
    ...new Set(
      values.filter(
        (
          value
        ): value is RoomInventoryRow["capabilities"][number] =>
          value === "none" ||
          value === "meeting" ||
          value === "education" ||
          value === "meal" ||
          value === "offsite" ||
          value === "trade_show" ||
          value === "move_in" ||
          value === "move_out"
      )
    ),
  ];
  if (!allowedCapabilities || allowedCapabilities.length === 0) {
    if (normalized.includes("none")) return ["none"];
    return normalized.length > 0 ? normalized : defaultCapabilitiesForKind(kind);
  }
  const filtered = normalized.filter((value) => allowedCapabilities.includes(value));
  if (filtered.includes("none")) return ["none"];
  return filtered.length > 0
    ? filtered
    : defaultCapabilitiesForKind(kind, allowedCapabilities);
}

function formatDayLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTimeLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ConferenceScheduleDesigner({
  conferenceId,
  initialProgramItems,
  params,
  modules,
  conferenceTimeZone,
  initialExhibitorOrganizations,
}: ConferenceScheduleDesignerProps) {
  const scheduleTimeZone =
    typeof conferenceTimeZone === "string" && conferenceTimeZone.trim()
      ? conferenceTimeZone
      : "America/Toronto";

  const enabledModules = modules.filter((row) => row.enabled).map((row) => row.module_key);
  const enabledSet = new Set(enabledModules);
  const roomCapabilityOptions = ALL_ROOM_CAPABILITY_OPTIONS.filter((option) => {
    if (option.value === "none") return true;
    if (option.value === "meeting") return enabledSet.has("meetings");
    if (option.value === "education") return enabledSet.has("education");
    if (option.value === "meal") return enabledSet.has("meals");
    if (option.value === "offsite") return enabledSet.has("offsite");
    if (option.value === "trade_show") return enabledSet.has("trade_show");
    if (option.value === "move_in" || option.value === "move_out") return enabledSet.has("logistics");
    return false;
  });
  const allowedRoomCapabilities = roomCapabilityOptions.map((option) => option.value);
  const allowedRoomCapabilitiesKey = allowedRoomCapabilities.join("|");

  const logisticsModule = modules.find((row) => row.module_key === "logistics");
  const logisticsConfig = (logisticsModule?.config_json ?? {}) as Record<string, unknown>;
  const allowedFromKey = (allowedRoomCapabilitiesKey.length > 0
    ? allowedRoomCapabilitiesKey.split("|")
    : []) as RoomInventoryRow["capabilities"];
  const rawRoomInventory = Array.isArray(logisticsConfig.room_inventory)
    ? (logisticsConfig.room_inventory as Array<Record<string, unknown>>)
    : [];
  const initialRoomInventory = rawRoomInventory
    .map((entry, idx) => {
      const name =
        typeof entry.name === "string" ? entry.name.trim() : "";
      if (!name) return null;
      const kind: RoomInventoryKind =
        entry.kind === "meeting_suite" ||
        entry.kind === "education_room" ||
        entry.kind === "meal_space" ||
        entry.kind === "offsite_venue" ||
        entry.kind === "general"
          ? (entry.kind as RoomInventoryKind)
          : "general";
      const capacityRaw = Number(entry.capacity ?? NaN);
      return {
        id:
          typeof entry.id === "string" && entry.id.trim().length > 0
            ? entry.id.trim()
            : `room-${idx + 1}`,
        name,
        kind,
        capabilities: normalizeRoomCapabilities(
          entry.capabilities,
          kind,
          allowedFromKey
        ),
        capacity:
          Number.isFinite(capacityRaw) && capacityRaw > 0
            ? Math.floor(capacityRaw)
            : null,
        is_bookable: entry.is_bookable !== false,
        notes:
          typeof entry.notes === "string" && entry.notes.trim().length > 0
            ? entry.notes.trim()
            : null,
      };
    })
    .filter((row): row is RoomInventoryRow => Boolean(row));

  const [roomInventory, setRoomInventory] = useState<RoomInventoryRow[]>(initialRoomInventory);
  const [isSavingRooms, setIsSavingRooms] = useState(false);
  const [roomSaveMessage, setRoomSaveMessage] = useState<string | null>(null);
  const [roomSaveError, setRoomSaveError] = useState<string | null>(null);
  const [programItems, setProgramItems] = useState<ProgramItem[]>(initialProgramItems);
  const [programRowDrafts, setProgramRowDrafts] = useState<
    Record<string, { location_label?: string; description?: string }>
  >({});
  const [savingProgramItemId, setSavingProgramItemId] = useState<string | null>(null);
  const [programSaveError, setProgramSaveError] = useState<string | null>(null);
  const [programSaveMessage, setProgramSaveMessage] = useState<string | null>(null);
  const [isSavingMeetingPlan, setIsSavingMeetingPlan] = useState(false);
  const [meetingPlanSaveError, setMeetingPlanSaveError] = useState<string | null>(null);
  const [meetingPlanSaveMessage, setMeetingPlanSaveMessage] = useState<string | null>(null);
  const meetingsModule = modules.find((row) => row.module_key === "meetings");
  const meetingsConfig = (meetingsModule?.config_json ?? {}) as Record<string, unknown>;
  const suiteRoomAssignmentsRaw =
    meetingsConfig.suite_room_assignments &&
    typeof meetingsConfig.suite_room_assignments === "object" &&
    !Array.isArray(meetingsConfig.suite_room_assignments)
      ? (meetingsConfig.suite_room_assignments as Record<string, unknown>)
      : {};
  const meetingSuiteCount = Math.max(
    1,
    Number(meetingsConfig.meeting_suites ?? params?.total_meeting_suites ?? 1) || 1
  );
  const [meetingSuiteAssignments, setMeetingSuiteAssignments] = useState<Record<string, string>>(() => {
    const output: Record<string, string> = {};
    for (let suite = 1; suite <= meetingSuiteCount; suite += 1) {
      const raw = suiteRoomAssignmentsRaw[String(suite)];
      output[String(suite)] =
        typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "";
    }
    return output;
  });
  const suiteOrgAssignmentsRaw =
    meetingsConfig.suite_org_assignments &&
    typeof meetingsConfig.suite_org_assignments === "object" &&
    !Array.isArray(meetingsConfig.suite_org_assignments)
      ? (meetingsConfig.suite_org_assignments as Record<string, unknown>)
      : {};
  const [meetingSuiteOrgAssignments, setMeetingSuiteOrgAssignments] = useState<Record<string, string>>(() => {
    const output: Record<string, string> = {};
    for (let suite = 1; suite <= meetingSuiteCount; suite += 1) {
      const raw = suiteOrgAssignmentsRaw[String(suite)];
      if (typeof raw === "string" && raw.trim().length > 0) {
        output[String(suite)] = raw.trim();
        continue;
      }
      const fallbackOrg = initialExhibitorOrganizations[suite - 1];
      output[String(suite)] = fallbackOrg?.id ?? "";
    }
    return output;
  });
  const meetingDays = Array.isArray(meetingsConfig.meeting_days)
    ? (meetingsConfig.meeting_days.filter((v): v is string => typeof v === "string") ?? [])
    : [];
  const meetingDaySettings = ((meetingsConfig.meeting_day_settings ?? {}) as Record<string, unknown>) ?? {};
  const totalMeetingCount = meetingDays.reduce((sum, date) => {
    const raw = meetingDaySettings[date];
    const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const value = Number(row.meeting_count ?? 0);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);

  const tradeShowModule = modules.find((row) => row.module_key === "trade_show");
  const tradeShowConfig = (tradeShowModule?.config_json ?? {}) as Record<string, unknown>;
  const tradeShowDays = Array.isArray(tradeShowConfig.trade_show_days)
    ? (tradeShowConfig.trade_show_days.filter((value): value is string => typeof value === "string") ?? [])
    : [];

  const educationModule = modules.find((row) => row.module_key === "education");
  const educationConfig = (educationModule?.config_json ?? {}) as Record<string, unknown>;
  const educationDays = Array.isArray(educationConfig.education_days)
    ? (educationConfig.education_days.filter((value): value is string => typeof value === "string") ?? [])
    : [];

  const mealsModule = modules.find((row) => row.module_key === "meals");
  const mealsConfig = (mealsModule?.config_json ?? {}) as Record<string, unknown>;
  const mealDaySettings = ((mealsConfig.meal_day_settings ?? {}) as Record<string, unknown>) ?? {};
  const mealDays = Object.keys(mealDaySettings).sort();

  const offsiteModule = modules.find((row) => row.module_key === "offsite");
  const offsiteConfig = (offsiteModule?.config_json ?? {}) as Record<string, unknown>;
  const offsiteEvents = Array.isArray(offsiteConfig.offsite_events)
    ? (offsiteConfig.offsite_events as Array<Record<string, unknown>>)
    : [];
  const hasProgramItems = programItems.length > 0;
  const sortedProgramItems = [...programItems].sort((a, b) => {
    const startDiff = new Date(a.starts_at).valueOf() - new Date(b.starts_at).valueOf();
    if (startDiff !== 0) return startDiff;
    return a.display_order - b.display_order;
  });

  const roomRequiredItems = sortedProgramItems.filter((item) =>
    ROOM_REQUIRED_TYPES.includes(item.item_type)
  );
  const assignedRoomItems = roomRequiredItems.filter(
    (item) => (item.location_label ?? "").trim().length > 0
  );
  const missingRoomItems = roomRequiredItems.filter(
    (item) => (item.location_label ?? "").trim().length === 0
  );

  const missingDetailItems = sortedProgramItems.filter(
    (item) =>
      DETAIL_REQUIRED_TYPES.includes(item.item_type) &&
      (item.description ?? "").trim().length === 0
  );

  const knownRoomNames = new Set(
    roomInventory
      .map((room) => room.name.trim().toLowerCase())
      .filter(Boolean)
  );

  const dayRows = sortedProgramItems.reduce<
    Array<{ dayKey: string; dayLabel: string; items: ProgramItem[] }>
  >((acc, item) => {
    const startsAt = new Date(item.starts_at);
    const dayKey = startsAt.toISOString().slice(0, 10);
    const existing = acc.find((row) => row.dayKey === dayKey);
    if (existing) {
      existing.items.push(item);
      return acc;
    }
    acc.push({
      dayKey,
      dayLabel: formatDayLabel(item.starts_at, scheduleTimeZone),
      items: [item],
    });
    return acc;
  }, []);

  const addRoomInventoryRow = () => {
    setRoomInventory((prev) => [
      ...prev,
      {
        id: `room-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        name: "",
        kind: "general",
        capabilities: defaultCapabilitiesForKind("general", allowedRoomCapabilities),
        capacity: null,
        is_bookable: true,
        notes: null,
      },
    ]);
  };

  const updateRoomInventoryRow = (
    id: string,
    patch: Partial<RoomInventoryRow>
  ) => {
    setRoomInventory((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const removeRoomInventoryRow = (id: string) => {
    setRoomInventory((prev) => prev.filter((row) => row.id !== id));
  };

  const meetingCapableRooms = roomInventory.filter(
    (room) =>
      room.is_bookable &&
      normalizeRoomCapabilities(room.capabilities, room.kind, allowedRoomCapabilities).includes(
        "meeting"
      )
  );

  const assignedSuiteCount = Object.values(meetingSuiteAssignments).filter(
    (value) => value.trim().length > 0
  ).length;
  const assignedSuiteOrgCount = Object.values(meetingSuiteOrgAssignments).filter(
    (value) => value.trim().length > 0
  ).length;

  const handleSaveMeetingPlan = async () => {
    setIsSavingMeetingPlan(true);
    setMeetingPlanSaveError(null);
    setMeetingPlanSaveMessage(null);
    const assignments = Array.from({ length: meetingSuiteCount }, (_, index) => {
      const suiteNumber = index + 1;
      const value = (meetingSuiteAssignments[String(suiteNumber)] ?? "").trim();
      return {
        suite_number: suiteNumber,
        room_name: value.length > 0 ? value : null,
        organization_id:
          (meetingSuiteOrgAssignments[String(suiteNumber)] ?? "").trim().length > 0
            ? (meetingSuiteOrgAssignments[String(suiteNumber)] ?? "").trim()
            : null,
      };
    });
    const result = await saveMeetingSuiteRoomAssignments(conferenceId, assignments);
    setIsSavingMeetingPlan(false);
    if (!result.success) {
      setMeetingPlanSaveError(result.error ?? "Failed to save meeting suite plan.");
      return;
    }
    setMeetingPlanSaveMessage("Meeting suite room plan saved.");
  };

  const autoAssignSuiteOrganizations = () => {
    setMeetingSuiteOrgAssignments((prev) => {
      const next = { ...prev };
      for (let suite = 1; suite <= meetingSuiteCount; suite += 1) {
        const key = String(suite);
        if ((next[key] ?? "").trim().length > 0) continue;
        const fallbackOrg = initialExhibitorOrganizations[suite - 1];
        if (fallbackOrg) next[key] = fallbackOrg.id;
      }
      return next;
    });
    setMeetingPlanSaveMessage("Auto-assigned suites from registered partner organizations. Save to persist.");
    setMeetingPlanSaveError(null);
  };

  const updateProgramRowDraft = (
    id: string,
    patch: { location_label?: string; description?: string }
  ) => {
    setProgramRowDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? {}),
        ...patch,
      },
    }));
  };

  const handleSaveProgramRow = async (item: ProgramItem) => {
    const draft = programRowDrafts[item.id] ?? {};
    setProgramSaveError(null);
    setProgramSaveMessage(null);
    setSavingProgramItemId(item.id);

    const result = await upsertConferenceProgramItem(conferenceId, {
      id: item.id,
      item_type: item.item_type,
      title: item.title,
      description:
        typeof draft.description === "string"
          ? draft.description
          : (item.description ?? null),
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      location_label:
        typeof draft.location_label === "string"
          ? draft.location_label
          : (item.location_label ?? null),
      audience_mode: item.audience_mode,
      target_roles: item.target_roles ?? [],
      is_required: item.is_required,
      display_order: item.display_order,
    });

    setSavingProgramItemId(null);
    if (!result.success || !result.data) {
      setProgramSaveError(result.error ?? "Failed to save schedule row.");
      return;
    }

    if (item.item_type === "offsite") {
      const syncResult = await syncOffsiteSetupFromScheduleRow(conferenceId, {
        item_id: item.id,
        title: result.data.title,
        starts_at: result.data.starts_at,
        location_label: result.data.location_label ?? null,
        description: result.data.description ?? null,
      });
      if (!syncResult.success) {
        setProgramSaveError(
          syncResult.error ??
            "Saved schedule row, but could not write back to offsite setup."
        );
      }
    }
    if (item.item_type === "education") {
      const syncResult = await syncEducationSetupFromScheduleRow(conferenceId, {
        item_id: item.id,
        starts_at: result.data.starts_at,
        location_label: result.data.location_label ?? null,
        description: result.data.description ?? null,
      });
      if (!syncResult.success) {
        setProgramSaveError(
          syncResult.error ??
            "Saved schedule row, but could not write back to education setup."
        );
      }
    }

    setProgramItems((prev) => prev.map((row) => (row.id === item.id ? (result.data as ProgramItem) : row)));
    setProgramSaveMessage("Schedule row saved.");
    setProgramRowDrafts((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  const handleSaveRoomInventory = async () => {
    setIsSavingRooms(true);
    setRoomSaveMessage(null);
    setRoomSaveError(null);
    const result = await saveConferenceRoomInventory(conferenceId, roomInventory);
    setIsSavingRooms(false);
    if (!result.success) {
      setRoomSaveError(result.error ?? "Failed to save room inventory.");
      return;
    }
    setRoomSaveMessage("Room inventory saved.");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Looking for room assignments?</p>
        <p className="mt-1">
          This page edits the program timeline and meeting geometry inputs. Generated room/suite
          occupancy and assignment diffs are in <span className="font-medium">Schedule Ops</span>.
        </p>
        <div className="mt-3">
          <Link
            href={`/admin/conference/${conferenceId}/schedule-ops`}
            className="inline-flex rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Open Schedule Ops (Rooms + Assignments)
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">Schedule Workspace</p>
        <p className="mt-1">
          This workspace uses module scope selected in <span className="font-medium">Setup</span>.
          Change scope in Setup when conference features change.
        </p>
        <p className="mt-2 text-xs">
          Enabled modules:{" "}
          {enabledModules.length > 0
            ? enabledModules.map((key) => MODULE_LABELS[key] ?? key).join(", ")
            : "none"}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Setup-Derived Schedule Snapshot</h2>
        <p className="mt-1 text-sm text-gray-600">
          This summary is generated from Setup and is the source input for room/suite assignment.
        </p>
        <div className="mt-4 space-y-3 text-sm">
          {enabledSet.has("meetings") ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="font-medium text-gray-900">Meetings</p>
              <p className="mt-1 text-gray-700">
                {meetingDays.length} day(s), {totalMeetingCount} meetings per suite total,{" "}
                {Number(meetingsConfig.meeting_suites ?? params?.total_meeting_suites ?? 0)} suite(s).
              </p>
            </div>
          ) : null}
          {enabledSet.has("trade_show") ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="font-medium text-gray-900">Trade Show</p>
              <p className="mt-1 text-gray-700">
                {tradeShowDays.length > 0
                  ? `${tradeShowDays.length} day(s) configured.`
                  : "No trade show days configured yet."}
              </p>
            </div>
          ) : null}
          {enabledSet.has("education") ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="font-medium text-gray-900">Education</p>
              <p className="mt-1 text-gray-700">
                {educationDays.length > 0
                  ? `${educationDays.length} day(s), target sessions: ${Number(educationConfig.session_count_target ?? 0)}.`
                  : "No education days configured yet."}
              </p>
            </div>
          ) : null}
          {enabledSet.has("meals") ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="font-medium text-gray-900">Meals</p>
              <p className="mt-1 text-gray-700">
                {mealDays.length > 0
                  ? `${mealDays.length} day(s) with meal service definitions.`
                  : "No meal service days configured yet."}
              </p>
            </div>
          ) : null}
          {enabledSet.has("offsite") ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="font-medium text-gray-900">Offsite Events</p>
              <p className="mt-1 text-gray-700">
                {offsiteEvents.length > 0
                  ? `${offsiteEvents.length} event(s) configured.`
                  : "No offsite events configured yet."}
              </p>
            </div>
          ) : null}
        </div>
        {!hasProgramItems ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No manual timeline rows exist yet. Use this setup snapshot + Schedule Ops for generated
            room assignments.
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Operations At-a-Glance</h2>
        <p className="mt-1 text-sm text-gray-600">
          One-screen summary of schedule completeness and room assignment coverage.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Times shown in conference local time: <span className="font-medium">{scheduleTimeZone}</span>
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Program Items</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{sortedProgramItems.length}</p>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Room Assigned</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{assignedRoomItems.length}</p>
          </div>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs uppercase tracking-wide text-amber-700">Missing Room</p>
            <p className="mt-1 text-lg font-semibold text-amber-900">{missingRoomItems.length}</p>
          </div>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs uppercase tracking-wide text-amber-700">Missing Detail</p>
            <p className="mt-1 text-lg font-semibold text-amber-900">{missingDetailItems.length}</p>
          </div>
        </div>
        {programSaveError ? (
          <p className="mt-3 text-sm text-red-700">{programSaveError}</p>
        ) : null}
        {programSaveMessage ? (
          <p className="mt-3 text-sm text-emerald-700">{programSaveMessage}</p>
        ) : null}

        {hasProgramItems ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">When</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Type</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Session</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Room / Location</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Details</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dayRows.map((row) =>
                  row.items.map((item, index) => {
                    const draft = programRowDrafts[item.id] ?? {};
                    const roomValue =
                      typeof draft.location_label === "string"
                        ? draft.location_label
                        : (item.location_label ?? "");
                    const descriptionValue =
                      typeof draft.description === "string"
                        ? draft.description
                        : (item.description ?? "");
                    const roomMissing =
                      ROOM_REQUIRED_TYPES.includes(item.item_type) &&
                      (item.location_label ?? "").trim().length === 0;
                    const unknownRoom =
                      !roomMissing &&
                      (item.location_label ?? "").trim().length > 0 &&
                      !knownRoomNames.has((item.location_label ?? "").trim().toLowerCase());
                    const matchedRoom =
                      (item.location_label ?? "").trim().length > 0
                        ? roomInventory.find(
                            (room) =>
                              room.name.trim().toLowerCase() ===
                              (item.location_label ?? "").trim().toLowerCase()
                          )
                        : null;
                    const itemCapability = itemTypeToCapability(item.item_type);
                    const matchedRoomCapabilities = matchedRoom
                      ? normalizeRoomCapabilities(
                          matchedRoom.capabilities,
                          matchedRoom.kind,
                          allowedRoomCapabilities
                        )
                      : [];
                    const capabilityMismatch =
                      !roomMissing &&
                      !unknownRoom &&
                      Boolean(itemCapability) &&
                      Boolean(matchedRoom) &&
                      !matchedRoomCapabilities.includes(itemCapability!);
                    const detailMissing =
                      DETAIL_REQUIRED_TYPES.includes(item.item_type) &&
                      (item.description ?? "").trim().length === 0;
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-2 text-gray-700">
                          <div className="font-medium text-gray-900">
                            {index === 0 ? row.dayLabel : ""}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatTimeLabel(item.starts_at, scheduleTimeZone)} -{" "}
                            {formatTimeLabel(item.ends_at, scheduleTimeZone)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{item.item_type}</td>
                        <td className="px-3 py-2 text-gray-900">{item.title}</td>
                        <td className="px-3 py-2 text-gray-700 min-w-[220px]">
                          <select
                            value={roomValue}
                            onChange={(event) =>
                              updateProgramRowDraft(item.id, {
                                location_label: event.target.value,
                              })
                            }
                            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                          >
                            <option value="">Unassigned</option>
                            {roomInventory
                              .filter((room) => room.is_bookable)
                              .map((roomDef) => (
                                <option key={`${item.id}-${roomDef.id}`} value={roomDef.name}>
                                  {roomDef.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 min-w-[260px]">
                          <textarea
                            value={descriptionValue}
                            onChange={(event) =>
                              updateProgramRowDraft(item.id, {
                                description: event.target.value,
                              })
                            }
                            rows={2}
                            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                            placeholder="Add session details for this row"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {!roomMissing && !unknownRoom && !capabilityMismatch && !detailMissing ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                Ready
                              </span>
                            ) : null}
                            {roomMissing ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                Room Missing
                              </span>
                            ) : null}
                            {unknownRoom ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                Unknown Room
                              </span>
                            ) : null}
                            {capabilityMismatch ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                Capability Mismatch
                              </span>
                            ) : null}
                            {detailMissing ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                Details Missing
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveProgramRow(item)}
                            disabled={savingProgramItemId === item.id}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {savingProgramItemId === item.id ? "Saving..." : "Save Row"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
            No program items yet. Use Setup and optional Program Overrides below.
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Room Inventory</h2>
            <p className="mt-1 text-sm text-gray-600">
              Declare rooms/venues once. Schedule rows should reference these names.
            </p>
          </div>
          <button
            type="button"
            onClick={addRoomInventoryRow}
            className="rounded-md bg-[#D60001] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
          >
            Add Room
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Name</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Type</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Capabilities</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Capacity</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Bookable</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Notes</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {roomInventory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-sm text-gray-500">
                    No rooms declared yet.
                  </td>
                </tr>
              ) : (
                roomInventory.map((room) => (
                  <tr key={room.id}>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={room.name}
                        onChange={(event) =>
                          updateRoomInventoryRow(room.id, { name: event.target.value })
                        }
                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder="Room or venue name"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={room.kind}
                        onChange={(event) =>
                          updateRoomInventoryRow(room.id, {
                            kind: event.target.value as RoomInventoryKind,
                            capabilities: defaultCapabilitiesForKind(
                              event.target.value as RoomInventoryKind,
                              allowedRoomCapabilities
                            ),
                          })
                        }
                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="meeting_suite">Meeting Suite</option>
                        <option value="education_room">Education Room</option>
                        <option value="meal_space">Meal Space</option>
                        <option value="offsite_venue">Offsite Venue</option>
                        <option value="general">General</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="grid grid-cols-2 gap-1">
                        {roomCapabilityOptions.map((option) => {
                          const currentCapabilities = normalizeRoomCapabilities(
                            room.capabilities,
                            room.kind,
                            allowedRoomCapabilities
                          );
                          const isChecked = currentCapabilities.includes(option.value);
                          return (
                            <label
                              key={`${room.id}-${option.value}`}
                              className="inline-flex items-center gap-1 text-xs text-gray-700"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(event) => {
                                  if (event.target.checked) {
                                    if (option.value === "none") {
                                      updateRoomInventoryRow(room.id, {
                                        capabilities: ["none"],
                                      });
                                      return;
                                    }
                                    updateRoomInventoryRow(room.id, {
                                      capabilities: [
                                        ...new Set(
                                          [...currentCapabilities.filter((value) => value !== "none"), option.value]
                                        ),
                                      ],
                                    });
                                  } else {
                                    updateRoomInventoryRow(room.id, {
                                      capabilities: currentCapabilities.filter((item) => item !== option.value),
                                    });
                                  }
                                }}
                              />
                              {option.label}
                            </label>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        value={room.capacity ?? ""}
                        onChange={(event) =>
                          updateRoomInventoryRow(room.id, {
                            capacity: event.target.value ? Number(event.target.value) : null,
                          })
                        }
                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={room.is_bookable}
                          onChange={(event) =>
                            updateRoomInventoryRow(room.id, { is_bookable: event.target.checked })
                          }
                        />
                        Yes
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={room.notes ?? ""}
                        onChange={(event) =>
                          updateRoomInventoryRow(room.id, {
                            notes: event.target.value || null,
                          })
                        }
                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeRoomInventoryRow(room.id)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs">
            {roomSaveError ? <span className="text-red-700">{roomSaveError}</span> : null}
            {!roomSaveError && roomSaveMessage ? (
              <span className="text-emerald-700">{roomSaveMessage}</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void handleSaveRoomInventory()}
            disabled={isSavingRooms}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isSavingRooms ? "Saving..." : "Save Room Inventory"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Meeting Engine</h2>
        <p className="mt-1 text-sm text-gray-600">
          Meeting geometry is configured in Setup and used as the scheduler source of truth.
        </p>
        <div className="mt-4">
          {enabledSet.has("meetings") ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
              <p>
                Meeting days configured: <span className="font-semibold">{meetingDays.length}</span>
              </p>
              <p className="mt-1">
                Meetings per suite (total): <span className="font-semibold">{totalMeetingCount}</span>
              </p>
              <p className="mt-1">
                Meeting suites:{" "}
                <span className="font-semibold">
                  {Number(meetingsConfig.meeting_suites ?? params?.total_meeting_suites ?? 0)}
                </span>
              </p>
              <p className="mt-2 text-xs text-gray-600">
                Use the Setup tab to edit per-day meeting counts, times, slot duration, and buffer values.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Meetings are not in scope. Enable Meetings in Setup to configure scheduler parameters.
            </div>
          )}
        </div>
      </div>

      {enabledSet.has("meetings") ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Meeting Suite Plan</h2>
          <p className="mt-1 text-sm text-gray-600">
            Assign each suite to a physical room. This is the meetings-specific flow and is separate
            from meal/education/offsite details.
          </p>
          <div className="mt-3 text-xs text-gray-600">
            Suites assigned: <span className="font-semibold">{assignedSuiteCount}</span> /{" "}
            <span className="font-semibold">{meetingSuiteCount}</span>
          </div>
          <div className="mt-1 text-xs text-gray-600">
            Organizations assigned: <span className="font-semibold">{assignedSuiteOrgCount}</span> /{" "}
            <span className="font-semibold">{meetingSuiteCount}</span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Suite</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Assigned Room</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Assigned Organization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Array.from({ length: meetingSuiteCount }, (_, index) => {
                  const suiteNumber = index + 1;
                  const key = String(suiteNumber);
                  return (
                    <tr key={`suite-${suiteNumber}`}>
                      <td className="px-3 py-2 text-gray-900">Suite {suiteNumber}</td>
                      <td className="px-3 py-2">
                        <select
                          value={meetingSuiteAssignments[key] ?? ""}
                          onChange={(event) =>
                            setMeetingSuiteAssignments((prev) => ({
                              ...prev,
                              [key]: event.target.value,
                            }))
                          }
                          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          <option value="">Unassigned</option>
                          {meetingCapableRooms.map((room) => (
                            <option key={`suite-room-${suiteNumber}-${room.id}`} value={room.name}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={meetingSuiteOrgAssignments[key] ?? ""}
                          onChange={(event) =>
                            setMeetingSuiteOrgAssignments((prev) => ({
                              ...prev,
                              [key]: event.target.value,
                            }))
                          }
                          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          <option value="">Unassigned</option>
                          {initialExhibitorOrganizations.map((org) => (
                            <option key={`suite-org-${suiteNumber}-${org.id}`} value={org.id}>
                              {org.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-xs">
              {meetingPlanSaveError ? (
                <span className="text-red-700">{meetingPlanSaveError}</span>
              ) : null}
              {!meetingPlanSaveError && meetingPlanSaveMessage ? (
                <span className="text-emerald-700">{meetingPlanSaveMessage}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={autoAssignSuiteOrganizations}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Auto-Assign Organizations
              </button>
              <button
                type="button"
                onClick={() => void handleSaveMeetingPlan()}
                disabled={isSavingMeetingPlan}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isSavingMeetingPlan ? "Saving..." : "Save Meeting Suite Plan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
