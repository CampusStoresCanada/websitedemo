"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export type ProgramItemType =
  | "meeting"
  | "meal"
  | "education"
  | "trade_show"
  | "offsite"
  | "move_in"
  | "move_out"
  | "custom";

export type ProgramAudienceMode = "all_attendees" | "target_roles" | "manual_curated";

export interface ConferenceProgramItem {
  id: string;
  conference_id: string;
  item_type: ProgramItemType;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  location_label: string | null;
  audience_mode: ProgramAudienceMode;
  target_roles: string[];
  is_required: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertConferenceProgramItemInput {
  id?: string;
  item_type: ProgramItemType;
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at: string;
  location_label?: string | null;
  audience_mode: ProgramAudienceMode;
  target_roles?: string[];
  is_required?: boolean;
  display_order?: number;
}

export async function listConferenceProgramItems(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: ConferenceProgramItem[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_program_items")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("starts_at", { ascending: true })
    .order("display_order", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as ConferenceProgramItem[] };
}

export async function upsertConferenceProgramItem(
  conferenceId: string,
  input: UpsertConferenceProgramItemInput
): Promise<{ success: boolean; error?: string; data?: ConferenceProgramItem }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!input.title?.trim()) {
    return { success: false, error: "Program item title is required." };
  }

  if (!input.starts_at || !input.ends_at) {
    return { success: false, error: "Program item start and end times are required." };
  }

  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(input.ends_at);
  if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf())) {
    return { success: false, error: "Program item dates are invalid." };
  }
  if (endsAt <= startsAt) {
    return { success: false, error: "Program item end time must be after start time." };
  }

  const adminClient = createAdminClient();
  const payload = {
    conference_id: conferenceId,
    item_type: input.item_type,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    location_label: input.location_label?.trim() || null,
    audience_mode: input.audience_mode,
    target_roles: input.audience_mode === "target_roles" ? input.target_roles ?? [] : [],
    is_required: input.is_required === true,
    display_order: input.display_order ?? 0,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await adminClient
      .from("conference_program_items")
      .update(payload)
      .eq("id", input.id)
      .eq("conference_id", conferenceId)
      .select("*")
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: data as ConferenceProgramItem };
  }

  const { data, error } = await adminClient
    .from("conference_program_items")
    .insert({
      ...payload,
      created_by: auth.ctx.userId,
    })
    .select("*")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data: data as ConferenceProgramItem };
}

export async function deleteConferenceProgramItem(
  conferenceId: string,
  itemId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("conference_program_items")
    .delete()
    .eq("id", itemId)
    .eq("conference_id", conferenceId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

function normalizeTime(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return fallback;
  return value.length === 5 ? `${value}:00` : value;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m, s] = time.split(":").map((part) => Number(part));
  const base = new Date(Date.UTC(1970, 0, 1, h || 0, m || 0, s || 0, 0));
  base.setUTCMinutes(base.getUTCMinutes() + Math.max(0, Math.floor(minutes)));
  const hh = String(base.getUTCHours()).padStart(2, "0");
  const mm = String(base.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

function zonedToUtcIso(date: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const safeTime = normalizeTime(time, "09:00:00");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = safeTime.split(":").map(Number);
  const targetUtcLike = Date.UTC(year, month - 1, day, hour, minute, second || 0);

  const partsFor = (input: Date) => {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(input);
    const read = (type: string): number =>
      Number(parts.find((entry) => entry.type === type)?.value ?? "0");
    return {
      year: read("year"),
      month: read("month"),
      day: read("day"),
      hour: read("hour"),
      minute: read("minute"),
      second: read("second"),
    };
  };

  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0));
  for (let i = 0; i < 4; i += 1) {
    const zoned = partsFor(candidate);
    const zonedUtcLike = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second
    );
    const diff = targetUtcLike - zonedUtcLike;
    if (diff === 0) break;
    candidate = new Date(candidate.getTime() + diff);
  }

  return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
}

export async function generateProgramFromSetup(
  conferenceId: string,
  options?: { replaceExisting?: boolean }
): Promise<{ success: boolean; error?: string; data?: { created: number } }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const replaceExisting = options?.replaceExisting === true;
  const adminClient = createAdminClient();
  const { data: conferenceRow, error: conferenceError } = await adminClient
    .from("conference_instances")
    .select("timezone")
    .eq("id", conferenceId)
    .single();
  if (conferenceError || !conferenceRow) {
    return { success: false, error: conferenceError?.message ?? "Conference not found." };
  }
  const conferenceTimeZone =
    typeof conferenceRow.timezone === "string" && conferenceRow.timezone.trim()
      ? conferenceRow.timezone
      : "America/Toronto";

  const [{ data: existingItems, error: existingError }, { data: modules, error: modulesError }] =
    await Promise.all([
      adminClient
        .from("conference_program_items")
        .select("id")
        .eq("conference_id", conferenceId),
      adminClient
        .from("conference_schedule_modules")
        .select("module_key, enabled, config_json")
        .eq("conference_id", conferenceId)
        .eq("enabled", true),
    ]);

  if (existingError) return { success: false, error: existingError.message };
  if (modulesError) return { success: false, error: modulesError.message };

  const hasExisting = (existingItems ?? []).length > 0;
  if (hasExisting && !replaceExisting) {
    return {
      success: false,
      error: "Program timeline already exists. Use replace mode to rebuild from setup.",
    };
  }

  if (hasExisting && replaceExisting) {
    const { error: deleteError } = await adminClient
      .from("conference_program_items")
      .delete()
      .eq("conference_id", conferenceId);
    if (deleteError) return { success: false, error: deleteError.message };
  }

  const byKey = new Map(
    (modules ?? []).map((row) => [row.module_key, (row.config_json ?? {}) as Record<string, unknown>] as const)
  );

  const inserts: Database["public"]["Tables"]["conference_program_items"]["Insert"][] = [];
  let displayOrder = 0;

  const meetingConfig = byKey.get("meetings");
  if (meetingConfig) {
    const days = Array.isArray(meetingConfig.meeting_days)
      ? (meetingConfig.meeting_days.filter((v): v is string => typeof v === "string") ?? [])
      : [];
    const daySettings = ((meetingConfig.meeting_day_settings ?? {}) as Record<string, unknown>) ?? {};

    days.forEach((date, index) => {
      const row = daySettings[date];
      const settings =
        row && typeof row === "object" && !Array.isArray(row)
          ? (row as Record<string, unknown>)
          : {};
      const meetingCount = Math.max(
        1,
        Number(
          settings.meeting_count ??
            settings.meeting_slots_per_day ??
            meetingConfig.meeting_slots_per_day ??
            meetingConfig.meetings_per_day ??
            0
        ) || 1
      );
      const slotDuration = Math.max(
        1,
        Number(settings.slot_duration_minutes ?? meetingConfig.slot_duration_minutes ?? 15) || 15
      );
      const buffer = Math.max(0, Number(settings.buffer_minutes ?? 0) || 0);
      const start = normalizeTime(settings.start_time, "09:00:00");
      const computedMinutes = meetingCount * slotDuration + Math.max(0, meetingCount - 1) * buffer;
      const explicitEnd = normalizeTime(settings.end_time, "");
      const end = explicitEnd ? explicitEnd : addMinutes(start, computedMinutes);
      const startsAt = zonedToUtcIso(date, start, conferenceTimeZone);
      const endsAt = zonedToUtcIso(date, end, conferenceTimeZone);
      if (!startsAt || !endsAt) return;
      inserts.push({
        conference_id: conferenceId,
        item_type: "meeting",
        title: `Meetings Day ${index + 1}`,
        description: `${meetingCount} slots (${slotDuration}m, buffer ${buffer}m)`,
        starts_at: startsAt,
        ends_at: endsAt,
        audience_mode: "target_roles",
        target_roles: ["delegate", "exhibitor"],
        is_required: false,
        display_order: displayOrder++,
        created_by: auth.ctx.userId,
      });
    });
  }

  const tradeShowConfig = byKey.get("trade_show");
  if (tradeShowConfig) {
    const days = Array.isArray(tradeShowConfig.trade_show_days)
      ? (tradeShowConfig.trade_show_days.filter((v): v is string => typeof v === "string") ?? [])
      : [];
    days.forEach((date, index) => {
      const start = normalizeTime(tradeShowConfig.start_time, "10:00:00");
      const end = normalizeTime(tradeShowConfig.end_time, "16:00:00");
      const startsAt = zonedToUtcIso(date, start, conferenceTimeZone);
      const endsAt = zonedToUtcIso(date, end, conferenceTimeZone);
      if (!startsAt || !endsAt) return;
      inserts.push({
        conference_id: conferenceId,
        item_type: "trade_show",
        title: `Trade Show Day ${index + 1}`,
        description: null,
        starts_at: startsAt,
        ends_at: endsAt,
        audience_mode: "target_roles",
        target_roles: ["delegate", "exhibitor"],
        is_required: false,
        display_order: displayOrder++,
        created_by: auth.ctx.userId,
      });
    });
  }

  const educationConfig = byKey.get("education");
  if (educationConfig) {
    const days = Array.isArray(educationConfig.education_days)
      ? (educationConfig.education_days.filter((v): v is string => typeof v === "string") ?? [])
      : [];
    const daySettings = ((educationConfig.education_day_settings ?? {}) as Record<string, unknown>) ?? {};
    days.forEach((date, index) => {
      const row = daySettings[date];
      const settings =
        row && typeof row === "object" && !Array.isArray(row)
          ? (row as Record<string, unknown>)
          : {};
      const start = normalizeTime(settings.start_time, "09:00:00");
      const duration = Math.max(30, Number(settings.session_duration_minutes ?? 240) || 240);
      const end = addMinutes(start, duration);
      const startsAt = zonedToUtcIso(date, start, conferenceTimeZone);
      const endsAt = zonedToUtcIso(date, end, conferenceTimeZone);
      if (!startsAt || !endsAt) return;
      inserts.push({
        conference_id: conferenceId,
        item_type: "education",
        title: `Education Day ${index + 1}`,
        description:
          (typeof settings.notes === "string" && settings.notes.trim()) ||
          (typeof settings.description === "string" && settings.description.trim()) ||
          null,
        location_label:
          (typeof settings.location_label === "string" && settings.location_label.trim()) ||
          (typeof settings.room_name === "string" && settings.room_name.trim()) ||
          null,
        starts_at: startsAt,
        ends_at: endsAt,
        audience_mode: "all_attendees",
        target_roles: [],
        is_required: false,
        display_order: displayOrder++,
        created_by: auth.ctx.userId,
      });
    });
  }

  const mealsConfig = byKey.get("meals");
  if (mealsConfig) {
    const daySettings = ((mealsConfig.meal_day_settings ?? {}) as Record<string, unknown>) ?? {};
    const days = Object.keys(daySettings).sort();
    days.forEach((date) => {
      const row = daySettings[date];
      const settings =
        row && typeof row === "object" && !Array.isArray(row)
          ? (row as Record<string, unknown>)
          : {};
      const mealDefs: Array<{ enabledKey: string; startKey: string; durKey: string; title: string }> = [
        { enabledKey: "breakfast_enabled", startKey: "breakfast_start_time", durKey: "breakfast_duration_minutes", title: "Breakfast" },
        { enabledKey: "lunch_enabled", startKey: "lunch_start_time", durKey: "lunch_duration_minutes", title: "Lunch" },
        { enabledKey: "dinner_enabled", startKey: "dinner_start_time", durKey: "dinner_duration_minutes", title: "Dinner" },
        { enabledKey: "custom_enabled", startKey: "custom_start_time", durKey: "custom_duration_minutes", title: "Custom Meal" },
      ];
      mealDefs.forEach((def) => {
        const enabled =
          def.enabledKey === "breakfast_enabled"
            ? Boolean(settings.breakfast)
            : def.enabledKey === "lunch_enabled"
              ? Boolean(settings.lunch)
              : def.enabledKey === "dinner_enabled"
                ? Boolean(settings.dinner)
                : Boolean(settings.custom_enabled);
        if (!enabled) return;
        const start =
          def.startKey === "breakfast_start_time"
            ? normalizeTime(settings.breakfast_time, "08:00:00")
            : def.startKey === "lunch_start_time"
              ? normalizeTime(settings.lunch_time, "12:00:00")
              : def.startKey === "dinner_start_time"
                ? normalizeTime(settings.dinner_time, "18:00:00")
                : normalizeTime(settings.custom_time, "17:00:00");
        const duration = Math.max(15, Number(settings[def.durKey] ?? 60) || 60);
        const end = addMinutes(start, duration);
        const startsAt = zonedToUtcIso(date, start, conferenceTimeZone);
        const endsAt = zonedToUtcIso(date, end, conferenceTimeZone);
        if (!startsAt || !endsAt) return;
        inserts.push({
          conference_id: conferenceId,
          item_type: "meal",
          title: def.title,
          description: null,
          starts_at: startsAt,
          ends_at: endsAt,
          audience_mode: "all_attendees",
          target_roles: [],
          is_required: false,
          display_order: displayOrder++,
          created_by: auth.ctx.userId,
        });
      });

      const snackBreaks = Array.isArray(settings.snack_breaks)
        ? (settings.snack_breaks as Array<Record<string, unknown>>)
        : [];
      snackBreaks.forEach((entry) => {
        const start = normalizeTime(entry.start_time, "15:00:00");
        const duration = Math.max(5, Number(entry.duration_minutes ?? 30) || 30);
        const end = addMinutes(start, duration);
        const startsAt = zonedToUtcIso(date, start, conferenceTimeZone);
        const endsAt = zonedToUtcIso(date, end, conferenceTimeZone);
        if (!startsAt || !endsAt) return;
        inserts.push({
          conference_id: conferenceId,
          item_type: "meal",
          title: "Snack Break",
          description: null,
          starts_at: startsAt,
          ends_at: endsAt,
          audience_mode: "all_attendees",
          target_roles: [],
          is_required: false,
          display_order: displayOrder++,
          created_by: auth.ctx.userId,
        });
      });
    });
  }

  const offsiteConfig = byKey.get("offsite");
  if (offsiteConfig) {
    const events = Array.isArray(offsiteConfig.offsite_events)
      ? (offsiteConfig.offsite_events as Array<Record<string, unknown>>)
      : [];
    events.forEach((event, index) => {
      const date = typeof event.date === "string" ? event.date : "";
      const start = normalizeTime(event.start_time, "18:00:00");
      const end = normalizeTime(event.end_time, "20:00:00");
      const startsAt = zonedToUtcIso(date, start, conferenceTimeZone);
      const endsAt = zonedToUtcIso(date, end, conferenceTimeZone);
      if (!startsAt || !endsAt) return;
      const title =
        (typeof event.name === "string" && event.name.trim()) ||
        (typeof event.title === "string" && event.title.trim()) ||
        `Offsite Event ${index + 1}`;
      inserts.push({
        conference_id: conferenceId,
        item_type: "offsite",
        title,
        description: typeof event.notes === "string" ? event.notes : null,
        location_label:
          (typeof event.venue_name === "string" && event.venue_name.trim()) ||
          (typeof event.venue_address === "string" && event.venue_address.trim()) ||
          null,
        starts_at: startsAt,
        ends_at: endsAt,
        audience_mode: "all_attendees",
        target_roles: [],
        is_required: false,
        display_order: displayOrder++,
        created_by: auth.ctx.userId,
      });
    });
  }

  if (inserts.length === 0) {
    return { success: false, error: "No schedule data available in setup to generate timeline." };
  }

  const { error: insertError } = await adminClient
    .from("conference_program_items")
    .insert(inserts);

  if (insertError) return { success: false, error: insertError.message };
  return { success: true, data: { created: inserts.length } };
}
