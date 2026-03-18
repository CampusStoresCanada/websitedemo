"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveMeetingGeometryFromModulesConfig } from "@/lib/conference/meeting-geometry";

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

type ProgramInsertRow = Database["public"]["Tables"]["conference_program_items"]["Insert"];

type TimeBlock = {
  start: string;
  end: string;
  label: string;
};

function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isTimeRangeOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aStartMin = parseTimeToMinutes(aStart);
  const aEndMin = parseTimeToMinutes(aEnd);
  const bStartMin = parseTimeToMinutes(bStart);
  const bEndMin = parseTimeToMinutes(bEnd);
  if (aStartMin === null || aEndMin === null || bStartMin === null || bEndMin === null) return false;
  return aStartMin < bEndMin && bStartMin < aEndMin;
}

function isTransitionRow(row: ProgramInsertRow): boolean {
  return row.item_type === "custom" && row.title === "Meeting Transition";
}

function hasTimeOverlapWithBlocks(start: string, end: string, blocks: TimeBlock[]): boolean {
  return blocks.some((block) => isTimeRangeOverlap(start, end, block.start, block.end));
}

function findTimelineOverlap(rows: ProgramInsertRow[]): {
  previous: ProgramInsertRow;
  current: ProgramInsertRow;
} | null {
  const sorted = [...rows].sort((a, b) => {
    const startDiff = new Date(a.starts_at as string).valueOf() - new Date(b.starts_at as string).valueOf();
    if (startDiff !== 0) return startDiff;
    return new Date(a.ends_at as string).valueOf() - new Date(b.ends_at as string).valueOf();
  });
  for (let idx = 1; idx < sorted.length; idx += 1) {
    const previous = sorted[idx - 1];
    const current = sorted[idx];
    if (isTransitionRow(previous) || isTransitionRow(current)) continue;
    const previousEnd = new Date(previous.ends_at as string).valueOf();
    const currentStart = new Date(current.starts_at as string).valueOf();
    if (previousEnd > currentStart) {
      return { previous, current };
    }
  }
  return null;
}

export async function generateProgramFromSetup(
  conferenceId: string,
  options?: { replaceExisting?: boolean; strictOverlapCheck?: boolean }
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

  const byKey = new Map(
    (modules ?? []).map((row) => [row.module_key, (row.config_json ?? {}) as Record<string, unknown>] as const)
  );
  const meetingBlocksByDate = new Map<string, TimeBlock[]>();
  const offsiteMealCoverageByDate = new Map<string, TimeBlock[]>();
  const addMeetingBlock = (date: string, start: string, end: string, label: string) => {
    if (!date || !start || !end) return;
    const startMin = parseTimeToMinutes(start);
    const endMin = parseTimeToMinutes(end);
    if (startMin === null || endMin === null || endMin <= startMin) return;
    const existing = meetingBlocksByDate.get(date) ?? [];
    existing.push({ start, end, label });
    meetingBlocksByDate.set(date, existing);
  };
  const addOffsiteMealCoverage = (date: string, start: string, end: string, label: string) => {
    if (!date || !start || !end) return;
    const startMin = parseTimeToMinutes(start);
    const endMin = parseTimeToMinutes(end);
    if (startMin === null || endMin === null || endMin <= startMin) return;
    const existing = offsiteMealCoverageByDate.get(date) ?? [];
    existing.push({ start, end, label });
    offsiteMealCoverageByDate.set(date, existing);
  };

  const inserts: ProgramInsertRow[] = [];
  let displayOrder = 0;

  const tradeShowConfig = byKey.get("trade_show");
  if (tradeShowConfig) {
    const days = Array.isArray(tradeShowConfig.trade_show_days)
      ? (tradeShowConfig.trade_show_days.filter((v): v is string => typeof v === "string") ?? [])
      : [];
    const start = normalizeTime(tradeShowConfig.start_time, "10:00:00");
    const end = normalizeTime(tradeShowConfig.end_time, "16:00:00");
    days.forEach((date) => addMeetingBlock(date, start, end, "Trade Show"));
  }

  const educationConfig = byKey.get("education");
  if (educationConfig) {
    const days = Array.isArray(educationConfig.education_days)
      ? (educationConfig.education_days.filter((v): v is string => typeof v === "string") ?? [])
      : [];
    const daySettings = ((educationConfig.education_day_settings ?? {}) as Record<string, unknown>) ?? {};
    days.forEach((date) => {
      const row = daySettings[date];
      const settings =
        row && typeof row === "object" && !Array.isArray(row)
          ? (row as Record<string, unknown>)
          : {};
      const start = normalizeTime(settings.start_time, "09:00:00");
      const duration = Math.max(30, Number(settings.session_duration_minutes ?? 240) || 240);
      const end = addMinutes(start, duration);
      addMeetingBlock(date, start, end, "Education");
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
      const mealDefs: Array<{ enabledKey: string; durKey: string; label: string }> = [
        { enabledKey: "breakfast", durKey: "breakfast_duration_minutes", label: "Breakfast" },
        { enabledKey: "lunch", durKey: "lunch_duration_minutes", label: "Lunch" },
        { enabledKey: "dinner", durKey: "dinner_duration_minutes", label: "Dinner" },
        { enabledKey: "custom_enabled", durKey: "custom_duration_minutes", label: "Custom Meal" },
      ];
      mealDefs.forEach((def) => {
        const enabled = Boolean(settings[def.enabledKey]);
        if (!enabled) return;
        const start =
          def.enabledKey === "breakfast"
            ? normalizeTime(settings.breakfast_time, "08:00:00")
            : def.enabledKey === "lunch"
              ? normalizeTime(settings.lunch_time, "12:00:00")
              : def.enabledKey === "dinner"
                ? normalizeTime(settings.dinner_time, "18:00:00")
                : normalizeTime(settings.custom_time, "17:00:00");
        const duration = Math.max(15, Number(settings[def.durKey] ?? 60) || 60);
        const end = addMinutes(start, duration);
        addMeetingBlock(date, start, end, def.label);
      });
      const snackBreaks = Array.isArray(settings.snack_breaks)
        ? (settings.snack_breaks as Array<Record<string, unknown>>)
        : [];
      snackBreaks.forEach((entry, index) => {
        const start = normalizeTime(entry.start_time, "15:00:00");
        const duration = Math.max(5, Number(entry.duration_minutes ?? 30) || 30);
        const end = addMinutes(start, duration);
        addMeetingBlock(date, start, end, `Snack Break ${index + 1}`);
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
      addMeetingBlock(date, start, end, `Offsite ${index + 1}`);
      if (event.includes_meal === true) {
        addOffsiteMealCoverage(date, start, end, `Offsite ${index + 1} (includes meal)`);
      }
    });
  }

  for (const [date, blocks] of meetingBlocksByDate.entries()) {
    blocks.sort((a, b) => {
      const aStart = parseTimeToMinutes(a.start) ?? 0;
      const bStart = parseTimeToMinutes(b.start) ?? 0;
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = parseTimeToMinutes(a.end) ?? 0;
      const bEnd = parseTimeToMinutes(b.end) ?? 0;
      return aEnd - bEnd;
    });
    meetingBlocksByDate.set(date, blocks);
  }

  const meetingConfig = byKey.get("meetings");
  if (meetingConfig) {
    const geometry = resolveMeetingGeometryFromModulesConfig(meetingConfig);

    geometry.dayConfigs.forEach((dayConfig, index) => {
      const dayEnd = normalizeTime(dayConfig.endTime, "17:00:00");
      const dayEndMinutes = parseTimeToMinutes(dayEnd) ?? 0;
      const blockers = meetingBlocksByDate.get(dayConfig.date) ?? [];
      let slotStart = dayConfig.startTime;
      let generatedForDay = 0;
      for (let requestedSlotNumber = 1; requestedSlotNumber <= dayConfig.meetingCount; requestedSlotNumber += 1) {
        let slotEnd = addMinutes(slotStart, dayConfig.slotDurationMinutes);
        const shiftReasons = new Set<string>();
        let iterations = 0;
        while (iterations < 50) {
          iterations += 1;
          const overlap = blockers.find((block) =>
            isTimeRangeOverlap(slotStart, slotEnd, block.start, block.end)
          );
          if (!overlap) break;
          shiftReasons.add(overlap.label);
          const overlapEndMinutes = parseTimeToMinutes(overlap.end);
          const slotStartMinutes = parseTimeToMinutes(slotStart);
          if (overlapEndMinutes === null || slotStartMinutes === null) break;
          if (overlapEndMinutes <= slotStartMinutes) break;
          slotStart = overlap.end;
          slotEnd = addMinutes(slotStart, dayConfig.slotDurationMinutes);
        }

        const slotEndMinutes = parseTimeToMinutes(slotEnd) ?? 0;
        if (dayEndMinutes > 0 && slotEndMinutes > dayEndMinutes) {
          break;
        }

        const slotStartsAt = zonedToUtcIso(dayConfig.date, slotStart, conferenceTimeZone);
        const slotEndsAt = zonedToUtcIso(dayConfig.date, slotEnd, conferenceTimeZone);
        if (slotStartsAt && slotEndsAt) {
          generatedForDay += 1;
          inserts.push({
            conference_id: conferenceId,
            item_type: "meeting",
            title: `Meeting ${generatedForDay}`,
            description:
              shiftReasons.size > 0
                ? `Day ${index + 1} · ${dayConfig.slotDurationMinutes}m · shifted after ${[...shiftReasons].join(", ")}`
                : `Day ${index + 1} · ${dayConfig.slotDurationMinutes}m`,
            starts_at: slotStartsAt,
            ends_at: slotEndsAt,
            audience_mode: "target_roles",
            target_roles: ["delegate", "exhibitor"],
            is_required: false,
            display_order: displayOrder++,
            created_by: auth.ctx.userId,
          });
        }

        if (requestedSlotNumber < dayConfig.meetingCount && dayConfig.bufferMinutes > 0) {
          const bufferEnd = addMinutes(slotEnd, dayConfig.bufferMinutes);
          const bufferStartsAt = zonedToUtcIso(dayConfig.date, slotEnd, conferenceTimeZone);
          const bufferEndsAt = zonedToUtcIso(dayConfig.date, bufferEnd, conferenceTimeZone);
          if (bufferStartsAt && bufferEndsAt) {
            inserts.push({
              conference_id: conferenceId,
              item_type: "custom",
              title: "Meeting Transition",
              description: `${dayConfig.bufferMinutes}m between slots`,
              starts_at: bufferStartsAt,
              ends_at: bufferEndsAt,
              audience_mode: "target_roles",
              target_roles: ["delegate", "exhibitor"],
              is_required: false,
              display_order: displayOrder++,
              created_by: auth.ctx.userId,
            });
          }
          slotStart = bufferEnd;
          continue;
        }
        slotStart = slotEnd;
      }
    });
  }

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

  if (mealsConfig) {
    const daySettings = ((mealsConfig.meal_day_settings ?? {}) as Record<string, unknown>) ?? {};
    const days = Object.keys(daySettings).sort();
    days.forEach((date) => {
      const offsiteMealCoverage = offsiteMealCoverageByDate.get(date) ?? [];
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
        if (hasTimeOverlapWithBlocks(start, end, offsiteMealCoverage)) return;
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
        if (hasTimeOverlapWithBlocks(start, end, offsiteMealCoverage)) return;
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

  const overlap = findTimelineOverlap(inserts);
  if (overlap && options?.strictOverlapCheck === true) {
    return {
      success: false,
      error: `Schedule conflict detected: "${overlap.previous.title}" (${overlap.previous.starts_at} - ${overlap.previous.ends_at}) overlaps "${overlap.current.title}" (${overlap.current.starts_at} - ${overlap.current.ends_at}). Adjust setup times before regenerating.`,
    };
  }

  if (hasExisting && replaceExisting) {
    const { error: deleteError } = await adminClient
      .from("conference_program_items")
      .delete()
      .eq("conference_id", conferenceId);
    if (deleteError) return { success: false, error: deleteError.message };
  }

  const { error: insertError } = await adminClient
    .from("conference_program_items")
    .insert(inserts);

  if (insertError) return { success: false, error: insertError.message };
  return { success: true, data: { created: inserts.length } };
}
