export interface MeetingDayGeometry {
  date: string;
  dayNumber: number;
  meetingCount: number;
  slotDurationMinutes: number;
  bufferMinutes: number;
  startTime: string;
  endTime: string | null;
}

export interface MeetingGeometryResolution {
  meetingDays: string[];
  dayConfigs: MeetingDayGeometry[];
  suitesTarget: number;
  suiteOrgAssignmentsBySuiteNumber: Record<string, string>;
}

function normalizeTimeValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return fallback;
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function deriveMeetingCountFromWindow(
  startTime: string,
  endTime: string,
  slotDurationMinutes: number,
  bufferMinutes: number
): number {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null || end <= start) return 0;
  const totalWindowMinutes = end - start;
  const slotSpanMinutes = slotDurationMinutes + bufferMinutes;
  if (slotSpanMinutes <= 0) return 0;
  return Math.max(0, Math.floor((totalWindowMinutes + bufferMinutes) / slotSpanMinutes));
}

export function resolveMeetingGeometryFromModulesConfig(
  config: Record<string, unknown>
): MeetingGeometryResolution {
  const explicitMeetingDays = Array.isArray(config.meeting_days)
    ? config.meeting_days.filter((value): value is string => typeof value === "string")
    : [];

  const daySettingsRaw =
    config.meeting_day_settings &&
    typeof config.meeting_day_settings === "object" &&
    !Array.isArray(config.meeting_day_settings)
      ? (config.meeting_day_settings as Record<string, unknown>)
      : {};

  const meetingsPerDayByDate =
    config.meetings_per_day_by_date &&
    typeof config.meetings_per_day_by_date === "object" &&
    !Array.isArray(config.meetings_per_day_by_date)
      ? (config.meetings_per_day_by_date as Record<string, unknown>)
      : {};

  const meetingDays = [...new Set([...explicitMeetingDays, ...Object.keys(daySettingsRaw)])].sort();

  const defaultStartTime = normalizeTimeValue(config.meeting_start_time, "09:00:00");
  const defaultEndTime = normalizeTimeValue(config.meeting_end_time, "17:00:00");
  const defaultSlotDuration = normalizePositiveInt(config.slot_duration_minutes, 15);
  const defaultBufferMinutes = normalizeNonNegativeInt(config.meeting_buffer_minutes, 0);

  const dayConfigs = meetingDays
    .map((date, index) => {
      const raw = daySettingsRaw[date];
      const settings =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};

      const slotDurationMinutes = normalizePositiveInt(settings.slot_duration_minutes, defaultSlotDuration);
      const bufferMinutes = normalizeNonNegativeInt(settings.buffer_minutes, defaultBufferMinutes);
      const startTime = normalizeTimeValue(settings.start_time, defaultStartTime);
      const endTime = normalizeTimeValue(settings.end_time, defaultEndTime);
      const fallbackCount = meetingsPerDayByDate[date];
      const configuredCount = normalizePositiveInt(
        settings.meeting_count ?? settings.meeting_slots_per_day ?? fallbackCount,
        0
      );
      const derivedCountFromWindow =
        slotDurationMinutes > 0
          ? deriveMeetingCountFromWindow(startTime, endTime, slotDurationMinutes, bufferMinutes)
          : 0;
      const meetingCount = Math.max(configuredCount, derivedCountFromWindow);
      if (meetingCount <= 0) return null;

      return {
        date,
        dayNumber: index + 1,
        meetingCount,
        slotDurationMinutes,
        bufferMinutes,
        startTime,
        endTime,
      } satisfies MeetingDayGeometry;
    })
    .filter(Boolean) as MeetingDayGeometry[];

  const suitesTarget = normalizePositiveInt(config.meeting_suites, 0);

  const suiteOrgAssignmentsRaw =
    config.suite_org_assignments &&
    typeof config.suite_org_assignments === "object" &&
    !Array.isArray(config.suite_org_assignments)
      ? (config.suite_org_assignments as Record<string, unknown>)
      : {};

  const suiteOrgAssignmentsBySuiteNumber: Record<string, string> = {};
  for (const [suiteNumber, value] of Object.entries(suiteOrgAssignmentsRaw)) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    suiteOrgAssignmentsBySuiteNumber[suiteNumber] = value.trim();
  }

  return {
    meetingDays,
    dayConfigs,
    suitesTarget,
    suiteOrgAssignmentsBySuiteNumber,
  };
}
