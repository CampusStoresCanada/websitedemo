"use client";

import Link from "next/link";
import { useState } from "react";
import {
  regenerateProgramFromSetup,
  saveConferenceRoomInventory,
  saveMeetingSuiteRoomAssignments,
} from "@/lib/actions/conference-schedule-design";
import {
  listConferenceProgramItems,
  upsertConferenceProgramItem,
} from "@/lib/actions/conference-program";
import { resolveMeetingGeometryFromModulesConfig } from "@/lib/conference/meeting-geometry";
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
  "move_in",
  "move_out",
];

const DETAIL_REQUIRED_TYPES: ProgramItem["item_type"][] = [
  "meal",
  "education",
];

type DetailFieldType = "select" | "text" | "textarea";

type StructuredDetailField = {
  key: string;
  label: string;
  type: DetailFieldType;
  required?: boolean;
  options?: string[];
};

type DetailSchema = {
  title: string;
  guidance: string;
  fields: StructuredDetailField[];
};

const DETAIL_SCHEMAS: Partial<Record<ProgramItem["item_type"], DetailSchema>> = {
  meal: {
    title: "Meal Details",
    guidance: "Capture practical meal notes without over-constraining menu planning.",
    fields: [
      {
        key: "service_type",
        label: "Service Type",
        type: "select",
        required: true,
        options: ["Buffet", "Plated", "Grab-and-Go", "Reception", "Coffee Break", "Other"],
      },
      {
        key: "menu",
        label: "Menu",
        type: "textarea",
        required: true,
      },
      {
        key: "dietary_notes",
        label: "Dietary Coverage Notes",
        type: "textarea",
      },
      { key: "service_notes", label: "Service Notes", type: "textarea" },
    ],
  },
  education: {
    title: "Education Details",
    guidance: "Capture speakers, abstract, and attendee instructions in a consistent format.",
    fields: [
      {
        key: "session_format",
        label: "Session Format",
        type: "select",
        required: true,
        options: ["Keynote", "Panel", "Workshop", "Roundtable", "Fireside Chat", "Other"],
      },
      { key: "speakers", label: "Speakers", type: "text", required: true },
      { key: "session_abstract", label: "Session Abstract", type: "textarea", required: true },
      { key: "attendee_instructions", label: "Attendee Instructions", type: "textarea" },
    ],
  },
  trade_show: {
    title: "Trade Show Details",
    guidance: "Capture floor focus and exhibitor execution details.",
    fields: [
      {
        key: "activation_type",
        label: "Activation Type",
        type: "select",
        options: ["Open Floor", "Featured Showcase", "Demo Block", "Networking Activation", "Other"],
      },
      { key: "featured_focus", label: "Featured Focus", type: "text" },
      { key: "exhibitor_instructions", label: "Exhibitor Instructions", type: "textarea" },
      { key: "attendee_notes", label: "Attendee Notes", type: "textarea" },
    ],
  },
  move_in: {
    title: "Move-In Details",
    guidance: "Capture logistics controls as structured operations fields.",
    fields: [
      {
        key: "dock_mode",
        label: "Dock Access Mode",
        type: "select",
        required: true,
        options: ["Timed Window", "Open Window", "Staggered", "By Appointment"],
      },
      { key: "freight_rules", label: "Freight Rules", type: "textarea" },
      { key: "vendor_checklist", label: "Vendor Checklist", type: "textarea" },
    ],
  },
  move_out: {
    title: "Move-Out Details",
    guidance: "Capture teardown and pickup guidance in a predictable format.",
    fields: [
      {
        key: "teardown_mode",
        label: "Teardown Mode",
        type: "select",
        required: true,
        options: ["Timed Window", "Staggered", "By Zone", "By Appointment"],
      },
      { key: "pickup_rules", label: "Pickup Rules", type: "textarea" },
      { key: "compliance_notes", label: "Compliance Notes", type: "textarea" },
    ],
  },
  custom: {
    title: "Custom Session Details",
    guidance: "Use consistent owner/objective/instruction fields for custom blocks.",
    fields: [
      { key: "owner", label: "Owner", type: "text", required: true },
      { key: "objective", label: "Objective", type: "text", required: true },
      { key: "execution_instructions", label: "Execution Instructions", type: "textarea" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
};

function parseStructuredDetails(
  description: string | null | undefined,
  schema: DetailSchema
): Record<string, string> {
  const lines = String(description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const values: Record<string, string> = {};
  for (const field of schema.fields) values[field.key] = "";
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const label = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    const field = schema.fields.find((entry) => entry.label.toLowerCase() === label);
    if (!field) continue;
    values[field.key] = value;
  }
  return values;
}

function serializeStructuredDetails(schema: DetailSchema, values: Record<string, string>): string {
  return schema.fields
    .map((field) => `${field.label}: ${(values[field.key] ?? "").trim()}`)
    .join("\n");
}

function summarizeStructuredDetails(schema: DetailSchema, values: Record<string, string>): string {
  const firstValue = schema.fields
    .map((field) => (values[field.key] ?? "").trim())
    .find((value) => value.length > 0);
  return firstValue ?? "Not configured";
}

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
    Record<string, { title?: string; location_label?: string; description?: string }>
  >({});
  const [savingProgramItemId, setSavingProgramItemId] = useState<string | null>(null);
  const [programSaveError, setProgramSaveError] = useState<string | null>(null);
  const [programSaveMessage, setProgramSaveMessage] = useState<string | null>(null);
  const [detailModalItemId, setDetailModalItemId] = useState<string | null>(null);
  const [detailModalValues, setDetailModalValues] = useState<Record<string, string>>({});
  const [detailModalError, setDetailModalError] = useState<string | null>(null);
  const [isSavingMeetingPlan, setIsSavingMeetingPlan] = useState(false);
  const [meetingPlanSaveError, setMeetingPlanSaveError] = useState<string | null>(null);
  const [meetingPlanSaveMessage, setMeetingPlanSaveMessage] = useState<string | null>(null);
  const [isRegeneratingProgram, setIsRegeneratingProgram] = useState(false);
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
  const meetingGeometry = resolveMeetingGeometryFromModulesConfig(meetingsConfig);
  const resolvedMeetingDays = meetingGeometry.meetingDays;
  const totalMeetingCount = meetingGeometry.dayConfigs.reduce((sum, dayConfig) => sum + dayConfig.meetingCount, 0);

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
  const offsiteAllowTbdVenue = Boolean(offsiteConfig.allow_tbd_venue);
  const offsiteEvents = Array.isArray(offsiteConfig.offsite_events)
    ? (offsiteConfig.offsite_events as Array<Record<string, unknown>>)
    : [];
  const moduleStatusSummary = [
    enabledSet.has("meetings")
      ? `Meetings ${resolvedMeetingDays.length}d / ${totalMeetingCount} slots-per-suite`
      : null,
    enabledSet.has("trade_show") ? `Trade Show ${tradeShowDays.length}d` : null,
    enabledSet.has("education")
      ? `Education ${educationDays.length}d / target ${Number(educationConfig.session_count_target ?? 0)}`
      : null,
    enabledSet.has("meals") ? `Meals ${mealDays.length}d` : null,
    enabledSet.has("offsite") ? `Offsite ${offsiteEvents.length} event(s)` : null,
  ].filter((value): value is string => Boolean(value));
  const hasProgramItems = programItems.length > 0;
  const sortedProgramItems = [...programItems].sort((a, b) => {
    const startDiff = new Date(a.starts_at).valueOf() - new Date(b.starts_at).valueOf();
    if (startDiff !== 0) return startDiff;
    return a.display_order - b.display_order;
  });
  const detailModalItem = detailModalItemId
    ? sortedProgramItems.find((item) => item.id === detailModalItemId) ?? null
    : null;
  const detailModalSchema =
    detailModalItem && detailModalItem.item_type !== "offsite"
      ? DETAIL_SCHEMAS[detailModalItem.item_type] ?? null
      : null;

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
  const offsiteItemsMissingVenue = sortedProgramItems.filter(
    (item) => item.item_type === "offsite" && (item.location_label ?? "").trim().length === 0
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
    patch: { title?: string; location_label?: string; description?: string }
  ) => {
    setProgramRowDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? {}),
        ...patch,
      },
    }));
  };

  const openDetailsModal = (item: ProgramItem) => {
    if (item.item_type === "offsite") return;
    const schema = DETAIL_SCHEMAS[item.item_type];
    if (!schema) return;
    const draft = programRowDrafts[item.id];
    const baseDescription =
      typeof draft?.description === "string" ? draft.description : (item.description ?? "");
    setDetailModalValues(parseStructuredDetails(baseDescription, schema));
    setDetailModalError(null);
    setDetailModalItemId(item.id);
  };

  const closeDetailsModal = () => {
    setDetailModalItemId(null);
    setDetailModalValues({});
    setDetailModalError(null);
  };

  const applyDetailsModal = () => {
    if (!detailModalItem || !detailModalSchema) return;
    const missingRequired = detailModalSchema.fields.find(
      (field) => field.required && (detailModalValues[field.key] ?? "").trim().length === 0
    );
    if (missingRequired) {
      setDetailModalError(`"${missingRequired.label}" is required.`);
      return;
    }
    const serialized = serializeStructuredDetails(detailModalSchema, detailModalValues);
    updateProgramRowDraft(detailModalItem.id, { description: serialized });
    closeDetailsModal();
  };

  const handleSaveProgramRow = async (item: ProgramItem) => {
    const draft = programRowDrafts[item.id] ?? {};
    setProgramSaveError(null);
    setProgramSaveMessage(null);
    setSavingProgramItemId(item.id);

    const result = await upsertConferenceProgramItem(conferenceId, {
      id: item.id,
      item_type: item.item_type,
      title: typeof draft.title === "string" ? draft.title : item.title,
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
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Schedule Context</h2>
            <p className="mt-1 text-sm text-gray-600">
              Edit timeline rows here. Use Setup for scope changes. Use Schedule Ops for generated
              room/suite assignments and run diffs.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Enabled modules:{" "}
              {enabledModules.length > 0
                ? enabledModules.map((key) => MODULE_LABELS[key] ?? key).join(", ")
                : "none"}
            </p>
          </div>
          <Link
            href={`/admin/conference/${conferenceId}/schedule-ops`}
            className="inline-flex rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Open Schedule Ops
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              setProgramSaveError(null);
              setProgramSaveMessage(null);
              setIsRegeneratingProgram(true);
              const result = await regenerateProgramFromSetup(conferenceId, { replaceExisting: true });
              setIsRegeneratingProgram(false);
              if (!result.success) {
                setProgramSaveError(result.error ?? "Failed to regenerate timeline from setup.");
                return;
              }
              const latest = await listConferenceProgramItems(conferenceId);
              if (!latest.success || !latest.data) {
                setProgramSaveError(latest.error ?? "Timeline regenerated but failed to reload rows.");
                return;
              }
              setProgramItems(latest.data as ProgramItem[]);
              setProgramSaveMessage(
                `Program regenerated from setup (${result.data?.created ?? 0} item(s)).`
              );
            }}
            disabled={isRegeneratingProgram}
            className="inline-flex rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {isRegeneratingProgram ? "Regenerating..." : "Regenerate Program from Setup"}
          </button>
          <span className="text-xs text-gray-500">
            Use after changing setup timing/counts.
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {moduleStatusSummary.length === 0 ? (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-gray-600">
              No setup modules enabled yet
            </span>
          ) : (
            moduleStatusSummary.map((entry) => (
              <span
                key={entry}
                className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-gray-700"
              >
                {entry}
              </span>
            ))
          )}
        </div>
        {!hasProgramItems ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No timeline rows exist yet. Run setup regeneration, then edit rows here.
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Operations At-a-Glance</h2>
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
        {offsiteAllowTbdVenue && offsiteItemsMissingVenue.length > 0 ? (
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            {offsiteItemsMissingVenue.length} offsite row(s) are still TBD for venue. Manage offsite
            location/details in Setup.
            <Link
              href={`/admin/conference/${conferenceId}?tab=setup`}
              className="ml-1 font-semibold underline"
            >
              Open Setup
            </Link>
            .
          </div>
        ) : null}

        {hasProgramItems ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">When</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Session</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Room / Location</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Details</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dayRows.map((row) => (
                  <>
                    <tr key={`${row.dayKey}-heading`} className="bg-black">
                      <td
                        colSpan={6}
                        className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
                      >
                        {row.dayLabel} • {row.items.length} row{row.items.length === 1 ? "" : "s"}
                      </td>
                    </tr>
                    {row.items.map((item) => {
                    const draft = programRowDrafts[item.id] ?? {};
                    const isOffsite = item.item_type === "offsite";
                    const titleValue =
                      typeof draft.title === "string"
                        ? draft.title
                        : item.title;
                    const roomValue =
                      typeof draft.location_label === "string"
                        ? draft.location_label
                        : (item.location_label ?? "");
                    const descriptionValue =
                      typeof draft.description === "string"
                        ? draft.description
                        : (item.description ?? "");
                    const detailSchema = item.item_type !== "offsite" ? (DETAIL_SCHEMAS[item.item_type] ?? null) : null;
                    const detailValues = detailSchema
                      ? parseStructuredDetails(descriptionValue, detailSchema)
                      : {};
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
                      (descriptionValue ?? "").trim().length === 0;
                    const offsiteMissingVenue =
                      isOffsite && (item.location_label ?? "").trim().length === 0;
                    const isDirty =
                      titleValue !== item.title ||
                      roomValue !== (item.location_label ?? "") ||
                      descriptionValue !== (item.description ?? "");
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-2 text-gray-700">
                          <div className="text-xs text-gray-500">
                            {formatTimeLabel(item.starts_at, scheduleTimeZone)} -{" "}
                            {formatTimeLabel(item.ends_at, scheduleTimeZone)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-900 min-w-[220px]">
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={titleValue}
                              onChange={(event) =>
                                updateProgramRowDraft(item.id, {
                                  title: event.target.value,
                                })
                              }
                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                            />
                            <p className="text-[11px] text-gray-500 capitalize">
                              {item.item_type.replaceAll("_", " ")}
                            </p>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-700 min-w-[220px]">
                          {isOffsite ? (
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
                              {(item.location_label ?? "").trim().length > 0
                                ? `Venue: ${item.location_label}`
                                : offsiteAllowTbdVenue
                                  ? "Venue TBD in Setup"
                                  : "Venue missing. Configure in Setup."}
                            </div>
                          ) : (
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
                          )}
                        </td>
                        <td className="px-3 py-2 min-w-[260px]">
                          {isOffsite ? (
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
                              Manage offsite details in Setup to keep source-of-truth in one place.
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <div className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700">
                                {detailSchema
                                  ? summarizeStructuredDetails(detailSchema, detailValues)
                                  : ((descriptionValue ?? "").trim() || "Not configured")}
                              </div>
                              {detailSchema ? (
                                <button
                                  type="button"
                                  onClick={() => openDetailsModal(item)}
                                  className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  Edit Details
                                </button>
                              ) : null}
                            </div>
                          )}
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
                            {offsiteMissingVenue ? (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                                Complete in Setup
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveProgramRow(item)}
                            disabled={savingProgramItemId === item.id || isOffsite || !isDirty}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {isOffsite
                              ? "Use Setup"
                              : savingProgramItemId === item.id
                                ? "Saving..."
                                : "Save"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                    }
                  </>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
            No program items yet.
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
            className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
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

      {detailModalItem && detailModalSchema ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{detailModalSchema.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{detailModalItem.title}</p>
                <p className="mt-1 text-xs text-gray-500">{detailModalSchema.guidance}</p>
              </div>
              <button
                type="button"
                onClick={closeDetailsModal}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              {detailModalSchema.fields.map((field) => (
                <label key={field.key} className="block text-sm text-gray-700">
                  {field.label}
                  {field.required ? <span className="ml-1 text-red-600">*</span> : null}
                  {field.type === "select" ? (
                    <select
                      value={detailModalValues[field.key] ?? ""}
                      onChange={(event) =>
                        setDetailModalValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select…</option>
                      {(field.options ?? []).map((option) => (
                        <option key={`${field.key}-${option}`} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      value={detailModalValues[field.key] ?? ""}
                      onChange={(event) =>
                        setDetailModalValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      rows={3}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  ) : (
                    <input
                      type="text"
                      value={detailModalValues[field.key] ?? ""}
                      onChange={(event) =>
                        setDetailModalValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  )}
                </label>
              ))}
            </div>
            {detailModalError ? (
              <p className="mt-3 text-sm text-red-700">{detailModalError}</p>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDetailsModal}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyDetailsModal}
                className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
              >
                Apply Details
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Meeting Engine</h2>
        <p className="mt-1 text-sm text-gray-600">
          Meeting geometry is configured in Setup and used as the scheduler source of truth.
        </p>
        <div className="mt-4">
          {enabledSet.has("meetings") ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
              <p>
                Meeting days configured: <span className="font-semibold">{resolvedMeetingDays.length}</span>
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
