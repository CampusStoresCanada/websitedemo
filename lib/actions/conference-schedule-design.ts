"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeScheduleModulesInput } from "@/lib/conference/schedule-setup-model";
import { syncConferencePeopleIndex } from "@/lib/actions/conference-people";
import { generateProgramFromSetup } from "@/lib/actions/conference-program";

export type ConferenceScheduleModuleKey =
  | "meetings"
  | "trade_show"
  | "education"
  | "meals"
  | "offsite"
  | "custom"
  | "registration_ops"
  | "communications"
  | "sponsorship_ops"
  | "logistics"
  | "travel_accommodation"
  | "content_capture"
  | "lead_capture"
  | "compliance_safety"
  | "staffing"
  | "post_event"
  | "virtual_hybrid"
  | "expo_floor_plan";

export interface ConferenceScheduleModuleRow {
  id: string;
  conference_id: string;
  module_key: ConferenceScheduleModuleKey;
  enabled: boolean;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ConferenceRoomInventoryKind =
  | "meeting_suite"
  | "education_room"
  | "meal_space"
  | "offsite_venue"
  | "general";

export interface ConferenceRoomInventoryEntry {
  id: string;
  name: string;
  kind: ConferenceRoomInventoryKind;
  capabilities: Array<
    "meeting" | "education" | "meal" | "offsite" | "trade_show" | "move_in" | "move_out" | "none"
  >;
  capacity: number | null;
  is_bookable: boolean;
  notes: string | null;
}

const ALL_MODULE_KEYS: ConferenceScheduleModuleKey[] = [
  "meetings",
  "trade_show",
  "education",
  "meals",
  "offsite",
  "custom",
  "registration_ops",
  "communications",
  "sponsorship_ops",
  "logistics",
  "travel_accommodation",
  "content_capture",
  "lead_capture",
  "compliance_safety",
  "staffing",
  "post_event",
  "virtual_hybrid",
  "expo_floor_plan",
];

function normalizeRoomInventory(
  rooms: Array<Partial<ConferenceRoomInventoryEntry>>
): ConferenceRoomInventoryEntry[] {
  return rooms
    .map((room, idx) => {
      const id =
        typeof room.id === "string" && room.id.trim().length > 0
          ? room.id.trim()
          : `room-${idx + 1}`;
      const name =
        typeof room.name === "string" ? room.name.trim() : "";
      if (!name) return null;
      const kind: ConferenceRoomInventoryKind =
        room.kind === "meeting_suite" ||
        room.kind === "education_room" ||
        room.kind === "meal_space" ||
        room.kind === "offsite_venue" ||
        room.kind === "general"
          ? room.kind
          : "general";
      const rawCapabilities = Array.isArray(room.capabilities) ? room.capabilities : [];
      const normalizedCapabilities = [
        ...new Set(
          rawCapabilities.filter(
            (
              cap
            ): cap is
              | "meeting"
              | "education"
              | "meal"
              | "offsite"
              | "trade_show"
              | "move_in"
              | "move_out"
              | "none" =>
              cap === "meeting" ||
              cap === "education" ||
              cap === "meal" ||
              cap === "offsite" ||
              cap === "trade_show" ||
              cap === "move_in" ||
              cap === "move_out" ||
              cap === "none"
          )
        ),
      ];
      const exclusiveNone = normalizedCapabilities.includes("none") ? (["none"] as const) : normalizedCapabilities;
      const capabilities =
        exclusiveNone.length > 0
          ? [...exclusiveNone]
          : kind === "meeting_suite"
            ? ["meeting"]
            : kind === "education_room"
              ? ["education"]
              : kind === "meal_space"
                ? ["meal"]
                : kind === "offsite_venue"
                  ? ["offsite"]
                  : ["meeting", "education", "meal", "offsite", "trade_show", "move_in", "move_out"];
      const capacityRaw = Number(room.capacity ?? NaN);
      const capacity =
        Number.isFinite(capacityRaw) && capacityRaw > 0
          ? Math.floor(capacityRaw)
          : null;
      const is_bookable = room.is_bookable !== false;
      const notes =
        typeof room.notes === "string" && room.notes.trim().length > 0
          ? room.notes.trim()
          : null;
      return { id, name, kind, capabilities, capacity, is_bookable, notes };
    })
    .filter((room): room is ConferenceRoomInventoryEntry => Boolean(room));
}

export async function listConferenceScheduleModules(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: ConferenceScheduleModuleRow[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_schedule_modules")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("module_key", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as ConferenceScheduleModuleRow[] };
}

export async function listConferenceExhibitorOrganizations(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: Array<{ id: string; name: string }> }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: rawData, error } = await adminClient
    .from("conference_people")
    .select("organization_id, organization_name, badge_org_name")
    .eq("conference_id", conferenceId)
    .eq("person_kind", "exhibitor");

  if (error) return { success: false, error: error.message };

  const data = rawData as unknown as Array<{ organization_id: string | null; organization_name: string | null; badge_org_name: string | null }>;
  const dedup = new Map<string, string>();
  for (const row of data ?? []) {
    const orgId =
      typeof row.organization_id === "string" && row.organization_id.trim().length > 0
        ? row.organization_id.trim()
        : null;
    if (!orgId) continue;
    const name =
      (typeof row.organization_name === "string" && row.organization_name.trim()) ||
      (typeof row.badge_org_name === "string" && row.badge_org_name.trim()) ||
      orgId;
    if (!dedup.has(orgId)) dedup.set(orgId, name);
  }

  const output = [...dedup.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { success: true, data: output };
}

export async function saveConferenceRoomInventory(
  conferenceId: string,
  rooms: Array<Partial<ConferenceRoomInventoryEntry>>
): Promise<{ success: boolean; error?: string; data?: ConferenceRoomInventoryEntry[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const normalized = normalizeRoomInventory(rooms);
  const adminClient = createAdminClient();

  const { data: existing, error: existingError } = await adminClient
    .from("conference_schedule_modules")
    .select("config_json")
    .eq("conference_id", conferenceId)
    .eq("module_key", "logistics")
    .maybeSingle();

  if (existingError) return { success: false, error: existingError.message };

  const existingConfig =
    existing?.config_json && typeof existing.config_json === "object"
      ? (existing.config_json as Record<string, unknown>)
      : {};

  const { error } = await adminClient.from("conference_schedule_modules").upsert(
    {
      conference_id: conferenceId,
      module_key: "logistics",
      enabled: true,
      config_json: {
        ...existingConfig,
        room_inventory: normalized,
      } as unknown as import("@/lib/database.types").Json,
      created_by: auth.ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conference_id,module_key" }
  );

  if (error) return { success: false, error: error.message };
  return { success: true, data: normalized };
}

export async function saveMeetingSuiteRoomAssignments(
  conferenceId: string,
  assignments: Array<{ suite_number: number; room_name: string | null; organization_id?: string | null }>
): Promise<{
  success: boolean;
  error?: string;
  data?: { suite_room_assignments: Record<string, string | null>; suite_org_assignments: Record<string, string | null> };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const normalizedEntries = assignments
    .map((row) => ({
      suite_number: Math.max(1, Math.floor(Number(row.suite_number || 0))),
      room_name:
        typeof row.room_name === "string" && row.room_name.trim().length > 0
          ? row.room_name.trim()
          : null,
    }))
    .filter((row) => Number.isFinite(row.suite_number));

  const normalizedRooms: Record<string, string | null> = {};
  const normalizedOrgs: Record<string, string | null> = {};
  for (const entry of normalizedEntries) {
    const rawOrg = assignments.find((row) => Math.floor(Number(row.suite_number || 0)) === entry.suite_number)
      ?.organization_id;
    normalizedRooms[String(entry.suite_number)] = entry.room_name;
    normalizedOrgs[String(entry.suite_number)] =
      typeof rawOrg === "string" && rawOrg.trim().length > 0 ? rawOrg.trim() : null;
  }

  const adminClient = createAdminClient();
  const { data: existing, error: existingError } = await adminClient
    .from("conference_schedule_modules")
    .select("enabled, config_json")
    .eq("conference_id", conferenceId)
    .eq("module_key", "meetings")
    .maybeSingle();

  if (existingError) return { success: false, error: existingError.message };

  const existingConfig =
    existing?.config_json && typeof existing.config_json === "object"
      ? (existing.config_json as Record<string, unknown>)
      : {};

  const { error } = await adminClient.from("conference_schedule_modules").upsert(
    {
      conference_id: conferenceId,
      module_key: "meetings",
      enabled: existing?.enabled !== false,
      config_json: {
        ...existingConfig,
        suite_room_assignments: normalizedRooms,
        suite_org_assignments: normalizedOrgs,
      },
      created_by: auth.ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conference_id,module_key" }
  );

  if (error) return { success: false, error: error.message };
  return {
    success: true,
    data: {
      suite_room_assignments: normalizedRooms,
      suite_org_assignments: normalizedOrgs,
    },
  };
}

export async function saveConferenceScheduleModules(
  conferenceId: string,
  modules: Array<{
    module_key: ConferenceScheduleModuleKey;
    enabled: boolean;
    config_json?: Record<string, unknown>;
  }>
): Promise<{ success: boolean; error?: string; data?: ConferenceScheduleModuleRow[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const keys = new Set(modules.map((moduleDef) => moduleDef.module_key));
  for (const key of keys) {
    if (!ALL_MODULE_KEYS.includes(key)) {
      return { success: false, error: `Unknown schedule module key: ${key}` };
    }
  }

  const normalizedInput = normalizeScheduleModulesInput(modules);
  const upserts = ALL_MODULE_KEYS.map((key) => {
    const moduleDef = normalizedInput.find((entry) => entry.module_key === key);
    return {
      conference_id: conferenceId,
      module_key: key,
      enabled: moduleDef?.enabled === true,
      config_json: (moduleDef?.config_json ?? {}) as unknown as import("@/lib/database.types").Json,
      created_by: auth.ctx.userId,
      updated_at: new Date().toISOString(),
    };
  });

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("conference_schedule_modules")
    .upsert(upserts, { onConflict: "conference_id,module_key" });

  if (error) return { success: false, error: error.message };
  return listConferenceScheduleModules(conferenceId);
}

export async function regenerateProgramFromSetup(
  conferenceId: string,
  options?: { replaceExisting?: boolean }
): Promise<{ success: boolean; error?: string; data?: { created: number } }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const result = await generateProgramFromSetup(conferenceId, {
    replaceExisting: options?.replaceExisting !== false,
  });
  if (!result.success) {
    return { success: false, error: result.error ?? "Failed to regenerate schedule program." };
  }
  return { success: true, data: result.data };
}

export async function reconcileConferenceScheduleSetup(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: ConferenceScheduleModuleRow[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const existing = await listConferenceScheduleModules(conferenceId);
  if (!existing.success || !existing.data) {
    return { success: false, error: existing.error ?? "Failed to load schedule modules." };
  }

  const payload = existing.data.map((row) => ({
    module_key: row.module_key,
    enabled: row.enabled,
    config_json: row.config_json ?? {},
  }));

  return saveConferenceScheduleModules(conferenceId, payload);
}

export async function reconcileConferenceSetupAndPeople(
  conferenceId: string
): Promise<{ success: boolean; error?: string }> {
  const setup = await reconcileConferenceScheduleSetup(conferenceId);
  if (!setup.success) {
    return { success: false, error: setup.error ?? "Failed to reconcile setup." };
  }

  const people = await syncConferencePeopleIndex(conferenceId);
  if (!people.success) {
    return { success: false, error: people.error ?? "Failed to sync conference people." };
  }

  return { success: true };
}

export async function createSuggestedMeetingProducts(
  conferenceId: string
): Promise<{
  success: boolean;
  error?: string;
  data?: {
    created: string[];
    updated: string[];
    skipped: string[];
    blocked: string[];
    totalMeetingCells: number;
  };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: moduleRow, error: moduleError } = await adminClient
    .from("conference_schedule_modules")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("module_key", "meetings")
    .maybeSingle();

  if (moduleError) return { success: false, error: moduleError.message };
  if (!moduleRow || !moduleRow.enabled) {
    return { success: false, error: "Meetings module is not enabled for this conference." };
  }

  const cfg = (moduleRow.config_json ?? {}) as Record<string, unknown>;
  const meetingDaySettings = (cfg.meeting_day_settings ?? {}) as Record<
    string,
    {
      meeting_count?: number;
    }
  >;
  const meetingsPerDayByDate = ((cfg.meetings_per_day_by_date ?? {}) as Record<string, unknown>) ?? {};
  const meetingDays = Array.isArray(cfg.meeting_days)
    ? (cfg.meeting_days.filter((v): v is string => typeof v === "string") ?? [])
    : [];
  const fallbackDayCount = [...new Set([...meetingDays, ...Object.keys(meetingsPerDayByDate)])].reduce(
    (sum, date) => {
      const n = Number(meetingsPerDayByDate[date] ?? 0);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    },
    0
  );
  const meetingSuites = Number(cfg.meeting_suites ?? 0);
  const maxDelegatesPerSuite = Number(cfg.max_delegates_per_suite ?? 1);

  const totalMeetingsPerSuite = Object.values(meetingDaySettings).reduce((sum, value) => {
    const n = Number(value?.meeting_count ?? 0);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
  const normalizedMeetingsPerSuite = totalMeetingsPerSuite > 0 ? totalMeetingsPerSuite : fallbackDayCount;
  const totalMeetingCells = Math.max(normalizedMeetingsPerSuite, 0) * Math.max(meetingSuites, 0);

  if (totalMeetingCells <= 0) {
    return {
      success: false,
      error:
        "Meeting product suggestion requires meeting suites and per-day meeting counts greater than zero.",
    };
  }

  const suggested = [
    {
      slug: "delegate_meetings_access",
      name: "Delegate Meetings Access",
      description: "Conference delegate access to scheduled meetings.",
      capacity: totalMeetingCells * Math.max(maxDelegatesPerSuite, 1),
      max_per_account: 10,
      metadata: {
        source: "meetings_module_suggestion",
        suggested_total_meeting_cells: totalMeetingCells,
      },
    },
    {
      slug: "exhibitor_meetings_access",
      name: "Exhibitor Meetings Access",
      description: "Conference exhibitor access to scheduled meetings.",
      capacity: totalMeetingCells,
      max_per_account: 10,
      metadata: {
        source: "meetings_module_suggestion",
        suggested_total_meeting_cells: totalMeetingCells,
      },
    },
  ];

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const blocked: string[] = [];

  for (const item of suggested) {
    const { data: existing, error: existingError } = await adminClient
      .from("conference_products")
      .select("id, slug, capacity, current_sold")
      .eq("conference_id", conferenceId)
      .eq("slug", item.slug)
      .maybeSingle();

    if (existingError) return { success: false, error: existingError.message };

    if (existing) {
      const currentCapacity = Number(existing.capacity ?? 0);
      const currentSold = Number(existing.current_sold ?? 0);
      const targetCapacity = Math.max(0, Number(item.capacity ?? 0));

      if (currentCapacity === targetCapacity) {
        skipped.push(item.slug);
        continue;
      }

      if (targetCapacity < currentSold) {
        blocked.push(`${item.slug} (target ${targetCapacity} < sold ${currentSold})`);
        continue;
      }

      const { error: updateError } = await adminClient
        .from("conference_products")
        .update({
          name: item.name,
          description: item.description,
          capacity: targetCapacity,
          max_per_account: item.max_per_account,
          metadata: item.metadata,
          is_active: true,
        })
        .eq("id", existing.id);
      if (updateError) return { success: false, error: updateError.message };
      updated.push(item.slug);
      continue;
    }

    const { error: createError } = await adminClient.from("conference_products").insert({
      conference_id: conferenceId,
      slug: item.slug,
      name: item.name,
      description: item.description,
      price_cents: 0,
      currency: "CAD",
      is_taxable: true,
      is_tax_exempt: false,
      capacity: item.capacity,
      max_per_account: item.max_per_account,
      display_order: 999,
      is_active: true,
      metadata: item.metadata,
    });

    if (createError) {
      if (createError.code === "23505") {
        skipped.push(item.slug);
        continue;
      }
      return { success: false, error: createError.message };
    }
    created.push(item.slug);
  }

  return {
    success: true,
    data: { created, updated, skipped, blocked, totalMeetingCells },
  };
}

export async function createSuggestedTradeShowProducts(
  conferenceId: string
): Promise<{
  success: boolean;
  error?: string;
  data?: {
    created: string[];
    updated: string[];
    skipped: string[];
    blocked: string[];
    totalBoothInventory: number;
  };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: moduleRow, error: moduleError } = await adminClient
    .from("conference_schedule_modules")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("module_key", "trade_show")
    .maybeSingle();

  if (moduleError) return { success: false, error: moduleError.message };
  if (!moduleRow || !moduleRow.enabled) {
    return { success: false, error: "Trade Show module is not enabled for this conference." };
  }

  const cfg = (moduleRow.config_json ?? {}) as Record<string, unknown>;
  const tradeShowDays = Array.isArray(cfg.trade_show_days)
    ? (cfg.trade_show_days.filter((v): v is string => typeof v === "string") ?? [])
    : [];
  const boothCountTotal = Math.max(0, Number(cfg.booth_count_total ?? 0));
  const boothSaleMode = String(cfg.booth_sale_mode ?? "multi_day");
  const daysCount = Math.max(1, tradeShowDays.length);
  const totalBoothInventory =
    boothSaleMode === "single_day" ? boothCountTotal * daysCount : boothCountTotal;

  if (totalBoothInventory <= 0) {
    return {
      success: false,
      error:
        "Trade show product suggestion requires booth count greater than zero.",
    };
  }

  const suggested = [
    {
      slug: "trade_show_booth_access",
      name: "Trade Show Booth Access",
      description: "Exhibitor booth access allocation for the conference trade show.",
      capacity: totalBoothInventory,
      max_per_account: 10,
      metadata: {
        source: "trade_show_module_suggestion",
        booth_sale_mode: boothSaleMode,
        booth_count_total: boothCountTotal,
        trade_show_days_count: tradeShowDays.length,
      },
    },
  ];

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const blocked: string[] = [];

  for (const item of suggested) {
    const { data: existing, error: existingError } = await adminClient
      .from("conference_products")
      .select("id, slug, capacity, current_sold")
      .eq("conference_id", conferenceId)
      .eq("slug", item.slug)
      .maybeSingle();

    if (existingError) return { success: false, error: existingError.message };

    if (existing) {
      const currentCapacity = Number(existing.capacity ?? 0);
      const currentSold = Number(existing.current_sold ?? 0);
      const targetCapacity = Math.max(0, Number(item.capacity ?? 0));

      if (currentCapacity === targetCapacity) {
        skipped.push(item.slug);
        continue;
      }

      if (targetCapacity < currentSold) {
        blocked.push(`${item.slug} (target ${targetCapacity} < sold ${currentSold})`);
        continue;
      }

      const { error: updateError } = await adminClient
        .from("conference_products")
        .update({
          name: item.name,
          description: item.description,
          capacity: targetCapacity,
          max_per_account: item.max_per_account,
          metadata: item.metadata,
          is_active: true,
        })
        .eq("id", existing.id);
      if (updateError) return { success: false, error: updateError.message };
      updated.push(item.slug);
      continue;
    }

    const { error: createError } = await adminClient.from("conference_products").insert({
      conference_id: conferenceId,
      slug: item.slug,
      name: item.name,
      description: item.description,
      price_cents: 0,
      currency: "CAD",
      is_taxable: true,
      is_tax_exempt: false,
      capacity: item.capacity,
      max_per_account: item.max_per_account,
      display_order: 999,
      is_active: true,
      metadata: item.metadata,
    });

    if (createError) {
      if (createError.code === "23505") {
        skipped.push(item.slug);
        continue;
      }
      return { success: false, error: createError.message };
    }
    created.push(item.slug);
  }

  return {
    success: true,
    data: { created, updated, skipped, blocked, totalBoothInventory },
  };
}

export async function createSuggestedEducationProducts(
  conferenceId: string
): Promise<{
  success: boolean;
  error?: string;
  data?: {
    created: string[];
    updated: string[];
    skipped: string[];
    blocked: string[];
    totalEducationCapacity: number;
  };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: moduleRow, error: moduleError } = await adminClient
    .from("conference_schedule_modules")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("module_key", "education")
    .maybeSingle();

  if (moduleError) return { success: false, error: moduleError.message };
  if (!moduleRow || !moduleRow.enabled) {
    return { success: false, error: "Education module is not enabled for this conference." };
  }

  const cfg = (moduleRow.config_json ?? {}) as Record<string, unknown>;
  const sessionCountTarget = Math.max(0, Number(cfg.session_count_target ?? 0));
  const roomCount = Math.max(1, Number(cfg.room_count ?? 1));
  const totalEducationCapacity = sessionCountTarget * roomCount;

  if (totalEducationCapacity <= 0) {
    return {
      success: false,
      error: "Education product suggestion requires session count and room count greater than zero.",
    };
  }

  const suggested = [
    {
      slug: "education_sessions_access",
      name: "Education Sessions Access",
      description: "Access allocation for education sessions and tracks.",
      capacity: totalEducationCapacity,
      max_per_account: 10,
      metadata: {
        source: "education_module_suggestion",
        session_count_target: sessionCountTarget,
        room_count: roomCount,
        audience_mode: String(cfg.audience_mode ?? "all"),
      },
    },
  ];

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const blocked: string[] = [];

  for (const item of suggested) {
    const { data: existing, error: existingError } = await adminClient
      .from("conference_products")
      .select("id, slug, capacity, current_sold")
      .eq("conference_id", conferenceId)
      .eq("slug", item.slug)
      .maybeSingle();

    if (existingError) return { success: false, error: existingError.message };

    if (existing) {
      const currentCapacity = Number(existing.capacity ?? 0);
      const currentSold = Number(existing.current_sold ?? 0);
      const targetCapacity = Math.max(0, Number(item.capacity ?? 0));

      if (currentCapacity === targetCapacity) {
        skipped.push(item.slug);
        continue;
      }

      if (targetCapacity < currentSold) {
        blocked.push(`${item.slug} (target ${targetCapacity} < sold ${currentSold})`);
        continue;
      }

      const { error: updateError } = await adminClient
        .from("conference_products")
        .update({
          name: item.name,
          description: item.description,
          capacity: targetCapacity,
          max_per_account: item.max_per_account,
          metadata: item.metadata,
          is_active: true,
        })
        .eq("id", existing.id);
      if (updateError) return { success: false, error: updateError.message };
      updated.push(item.slug);
      continue;
    }

    const { error: createError } = await adminClient.from("conference_products").insert({
      conference_id: conferenceId,
      slug: item.slug,
      name: item.name,
      description: item.description,
      price_cents: 0,
      currency: "CAD",
      is_taxable: true,
      is_tax_exempt: false,
      capacity: item.capacity,
      max_per_account: item.max_per_account,
      display_order: 999,
      is_active: true,
      metadata: item.metadata,
    });

    if (createError) {
      if (createError.code === "23505") {
        skipped.push(item.slug);
        continue;
      }
      return { success: false, error: createError.message };
    }
    created.push(item.slug);
  }

  return {
    success: true,
    data: { created, updated, skipped, blocked, totalEducationCapacity },
  };
}

export async function createSuggestedMealProducts(
  conferenceId: string
): Promise<{
  success: boolean;
  error?: string;
  data?: {
    created: string[];
    updated: string[];
    skipped: string[];
    blocked: string[];
    totalMealEntitlements: number;
  };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: moduleRow, error: moduleError } = await adminClient
    .from("conference_schedule_modules")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("module_key", "meals")
    .maybeSingle();

  if (moduleError) return { success: false, error: moduleError.message };
  if (!moduleRow || !moduleRow.enabled) {
    return { success: false, error: "Meals module is not enabled for this conference." };
  }

  const cfg = (moduleRow.config_json ?? {}) as Record<string, unknown>;
  const mealDays = Array.isArray(cfg.meal_days)
    ? (cfg.meal_days.filter((v): v is string => typeof v === "string") ?? [])
    : [];
  const mealDaySettings = ((cfg.meal_day_settings ?? {}) as Record<string, unknown>) ?? {};
  const boothCountTotal = Math.max(0, Number(cfg.meal_plan_capacity ?? 0));

  const totalMealServices = mealDays.reduce((sum, date) => {
    const raw = mealDaySettings[date];
    const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const hasBreakfast = Boolean(row.breakfast);
    const hasLunch = Boolean(row.lunch);
    const hasDinner = Boolean(row.dinner);
    const hasCustom = Boolean(row.custom_enabled);
    const snackBreakCount = Array.isArray(row.snack_breaks)
      ? (row.snack_breaks as Array<unknown>).length
      : 0;
    const fixedMeals = [hasBreakfast, hasLunch, hasDinner, hasCustom].filter(Boolean).length;
    return sum + fixedMeals + snackBreakCount;
  }, 0);

  const effectiveCapacity = boothCountTotal > 0 ? boothCountTotal : 1;
  const totalMealEntitlements = effectiveCapacity * Math.max(1, totalMealServices);
  if (totalMealServices <= 0) {
    return {
      success: false,
      error: "Meal product suggestion requires at least one meal service on at least one day.",
    };
  }

  const suggested = [
    {
      slug: "conference_meal_plan",
      name: "Conference Meal Plan",
      description: "Meal plan allocation across configured conference meal services.",
      capacity: totalMealEntitlements,
      max_per_account: 10,
      metadata: {
        source: "meals_module_suggestion",
        meal_days_count: mealDays.length,
        meal_services_count: totalMealServices,
        base_capacity: effectiveCapacity,
      },
    },
  ];

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const blocked: string[] = [];

  for (const item of suggested) {
    const { data: existing, error: existingError } = await adminClient
      .from("conference_products")
      .select("id, slug, capacity, current_sold")
      .eq("conference_id", conferenceId)
      .eq("slug", item.slug)
      .maybeSingle();

    if (existingError) return { success: false, error: existingError.message };

    if (existing) {
      const currentCapacity = Number(existing.capacity ?? 0);
      const currentSold = Number(existing.current_sold ?? 0);
      const targetCapacity = Math.max(0, Number(item.capacity ?? 0));

      if (currentCapacity === targetCapacity) {
        skipped.push(item.slug);
        continue;
      }

      if (targetCapacity < currentSold) {
        blocked.push(`${item.slug} (target ${targetCapacity} < sold ${currentSold})`);
        continue;
      }

      const { error: updateError } = await adminClient
        .from("conference_products")
        .update({
          name: item.name,
          description: item.description,
          capacity: targetCapacity,
          max_per_account: item.max_per_account,
          metadata: item.metadata,
          is_active: true,
        })
        .eq("id", existing.id);
      if (updateError) return { success: false, error: updateError.message };
      updated.push(item.slug);
      continue;
    }

    const { error: createError } = await adminClient.from("conference_products").insert({
      conference_id: conferenceId,
      slug: item.slug,
      name: item.name,
      description: item.description,
      price_cents: 0,
      currency: "CAD",
      is_taxable: true,
      is_tax_exempt: false,
      capacity: item.capacity,
      max_per_account: item.max_per_account,
      display_order: 999,
      is_active: true,
      metadata: item.metadata,
    });

    if (createError) {
      if (createError.code === "23505") {
        skipped.push(item.slug);
        continue;
      }
      return { success: false, error: createError.message };
    }
    created.push(item.slug);
  }

  return {
    success: true,
    data: { created, updated, skipped, blocked, totalMealEntitlements },
  };
}

export async function createSuggestedOffsiteProducts(
  conferenceId: string
): Promise<{
  success: boolean;
  error?: string;
  data?: {
    created: string[];
    updated: string[];
    skipped: string[];
    blocked: string[];
    totalOffsiteCapacity: number;
  };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: moduleRow, error: moduleError } = await adminClient
    .from("conference_schedule_modules")
    .select("*")
    .eq("conference_id", conferenceId)
    .eq("module_key", "offsite")
    .maybeSingle();

  if (moduleError) return { success: false, error: moduleError.message };
  if (!moduleRow || !moduleRow.enabled) {
    return { success: false, error: "Offsite module is not enabled for this conference." };
  }

  const cfg = (moduleRow.config_json ?? {}) as Record<string, unknown>;
  const events = Array.isArray(cfg.offsite_events) ? (cfg.offsite_events as Array<Record<string, unknown>>) : [];
  const totalOffsiteCapacity = events.reduce((sum, event) => {
    const n = Number(event.capacity ?? 0);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);

  if (events.length === 0 || totalOffsiteCapacity <= 0) {
    return {
      success: false,
      error: "Offsite product suggestion requires at least one offsite event with capacity.",
    };
  }

  const sponsoredCount = events.filter((event) => Boolean(event.is_sponsored)).length;
  const suggested = [
    {
      slug: "offsite_events_access",
      name: "Offsite Events Access",
      description: "Access allocation for offsite conference events.",
      capacity: totalOffsiteCapacity,
      max_per_account: 10,
      metadata: {
        source: "offsite_module_suggestion",
        event_count: events.length,
        sponsored_event_count: sponsoredCount,
      },
    },
  ];

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const blocked: string[] = [];

  for (const item of suggested) {
    const { data: existing, error: existingError } = await adminClient
      .from("conference_products")
      .select("id, slug, capacity, current_sold")
      .eq("conference_id", conferenceId)
      .eq("slug", item.slug)
      .maybeSingle();

    if (existingError) return { success: false, error: existingError.message };

    if (existing) {
      const currentCapacity = Number(existing.capacity ?? 0);
      const currentSold = Number(existing.current_sold ?? 0);
      const targetCapacity = Math.max(0, Number(item.capacity ?? 0));

      if (currentCapacity === targetCapacity) {
        skipped.push(item.slug);
        continue;
      }

      if (targetCapacity < currentSold) {
        blocked.push(`${item.slug} (target ${targetCapacity} < sold ${currentSold})`);
        continue;
      }

      const { error: updateError } = await adminClient
        .from("conference_products")
        .update({
          name: item.name,
          description: item.description,
          capacity: targetCapacity,
          max_per_account: item.max_per_account,
          metadata: item.metadata,
          is_active: true,
        })
        .eq("id", existing.id);
      if (updateError) return { success: false, error: updateError.message };
      updated.push(item.slug);
      continue;
    }

    const { error: createError } = await adminClient.from("conference_products").insert({
      conference_id: conferenceId,
      slug: item.slug,
      name: item.name,
      description: item.description,
      price_cents: 0,
      currency: "CAD",
      is_taxable: true,
      is_tax_exempt: false,
      capacity: item.capacity,
      max_per_account: item.max_per_account,
      display_order: 999,
      is_active: true,
      metadata: item.metadata,
    });

    if (createError) {
      if (createError.code === "23505") {
        skipped.push(item.slug);
        continue;
      }
      return { success: false, error: createError.message };
    }
    created.push(item.slug);
  }

  return {
    success: true,
    data: { created, updated, skipped, blocked, totalOffsiteCapacity },
  };
}
