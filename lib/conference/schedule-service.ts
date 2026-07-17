/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from "@/lib/supabase/admin";
import { buildEntityGraph, ENTITY_SELECT } from "@/lib/conference/entity-rows";
import { deriveAgenda } from "@/lib/conference/agenda";

export type ConferenceScheduleViewerRole =
  | "admin"
  | "delegate"
  | "observer"
  | "exhibitor"
  | "staff";

export interface ConferenceMeetingAssignment {
  scheduleId: string;
  schedulerRunId: string;
  meetingSlotId: string;
  exhibitorRegistrationId: string;
  exhibitorOrganizationId: string | null;
  exhibitorName: string;
  delegateRegistrationIds: string[];
  dayNumber: number;
  slotNumber: number;
  suiteId: string;
  suiteNumber: number | null;
  startTime: string;
  endTime: string;
}

export interface ConferenceScheduleItem {
  id: string;
  conferenceId: string;
  source: "program" | "meeting_assignment";
  /**
   * The catalog `kind` for program items ("session", "meal", "event", …) or
   * "meeting" for assignments. Drives the type label + colour. (Was the legacy
   * `ConferenceScheduleItemType`; now carries the real kind.)
   */
  itemType: string;
  /** Alias of itemType — the raw catalog kind. */
  kind: string;
  title: string;
  description: string | null;
  /** Short teaser text, for list views that expand to the full description on demand. */
  summary: string | null;
  startsAt: string;
  endsAt: string;
  startsAtLocal: string;
  endsAtLocal: string;
  dayKeyLocal: string;
  locationLabel: string | null;
  audienceMode: "all_attendees" | "target_roles" | "manual_curated";
  targetRoles: string[];
  isRequired: boolean;
  displayOrder: number;
  createdAt: string | null;
  updatedAt: string | null;
  meetingAssignment: ConferenceMeetingAssignment | null;
  /** Agenda nesting: the row this nests under, or null at the top level. */
  parentId: string | null;
  /** 0 at the top level, +1 per nesting level. */
  depth: number;
  /** `who` audience names carried for admin lenses (not a visibility gate). */
  audienceNames: string[];
}

export interface ConferenceScheduleTimeline {
  conferenceId: string;
  timeZone: string;
  generatedAt: string;
  viewerRole: ConferenceScheduleViewerRole;
  activeRunId: string | null;
  programItems: ConferenceScheduleItem[];
  meetingAssignmentItems: ConferenceScheduleItem[];
  items: ConferenceScheduleItem[];
}

export interface ConferenceAttendeeMeetingRow {
  scheduleId: string;
  meetingSlotId: string;
  exhibitorRegistrationId: string;
  exhibitorOrganizationId: string;
  exhibitorName: string;
  dayNumber: number;
  slotNumber: number;
  startTime: string;
  endTime: string;
  suiteNumber: number | null;
}

function formatLocalDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDayOnly(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function parseTimeParts(time: string): { hour: number; minute: number; second: number } {
  const [hourRaw, minuteRaw, secondRaw] = time.split(":");
  return {
    hour: Number(hourRaw ?? 0),
    minute: Number(minuteRaw ?? 0),
    second: Number(secondRaw ?? 0),
  };
}

function sortScheduleItems(a: ConferenceScheduleItem, b: ConferenceScheduleItem): number {
  const byStart = new Date(a.startsAt).valueOf() - new Date(b.startsAt).valueOf();
  if (byStart !== 0) return byStart;
  const byDisplayOrder = a.displayOrder - b.displayOrder;
  if (byDisplayOrder !== 0) return byDisplayOrder;
  return a.title.localeCompare(b.title);
}

export async function getConferenceScheduleTimeline(
  conferenceId: string,
  options: {
    viewerRole: ConferenceScheduleViewerRole;
    viewerRegistrationId?: string | null;
    viewerMeetingRole?: "delegate" | "exhibitor";
  }
): Promise<ConferenceScheduleTimeline> {
  const adminClient = createAdminClient();
  const viewerMeetingRole = options.viewerMeetingRole ?? "delegate";

  const ac = adminClient as any;
  const { data: conference } = (await ac
    .from("conference_instances")
    .select("id, timezone")
    .eq("id", conferenceId)
    .maybeSingle()) as { data: any };

  const timeZone =
    typeof conference?.timezone === "string" && conference.timezone.trim().length > 0
      ? conference.timezone
      : "America/Toronto";

  const { data: activeRun } = (await ac
    .from("scheduler_runs")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("run_mode", "active")
    .eq("status", "completed")
    .maybeSingle()) as { data: any };

  // Program/agenda items are derived live from the v3 catalog (entity graph) —
  // every "thing" that lands on a Day with a time. The legacy
  // conference_program_items table is retired; the catalog is the single source.
  const [{ data: entityRows }, { data: refRows }] = (await Promise.all([
    ac.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    ac
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conferenceId),
  ])) as [{ data: any[] | null }, { data: any[] | null }];

  const entities = buildEntityGraph(entityRows ?? [], refRows ?? []);

  // Meeting days for assignment placement = Day things carrying a meeting
  // cadence, ordered by date (mirrors loadConferenceMeetingGeometry's ordering).
  const meetingDays = entities
    .filter((e) => e.kind === "day")
    .map((e) => ({
      date: typeof e.attributes.date === "string" ? e.attributes.date : "",
      hasCadence:
        typeof e.attributes.meeting_start_time === "string" &&
        e.attributes.meeting_start_time.trim().length > 0,
    }))
    .filter((d) => d.date && d.hasCadence)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => d.date);

  // The agenda is visible to everyone (admin sees all regardless). `who`
  // audiences ride along as metadata for admin lenses, not as a row-level gate.
  const agenda = deriveAgenda(entities, timeZone);
  const programItems: ConferenceScheduleItem[] = agenda.map((a, idx) => {
    const timed = a.startTime != null;
    return {
      id: a.id,
      conferenceId,
      source: "program" as const,
      itemType: a.kind,
      kind: a.kind,
      title: a.title,
      description: a.description,
      summary: a.summary,
      startsAt: a.startsAtUtc,
      endsAt: a.endsAtUtc,
      startsAtLocal: timed
        ? formatLocalDateTime(a.startsAtUtc, timeZone)
        : formatDayOnly(a.startsAtUtc, timeZone),
      endsAtLocal: timed && a.endTime != null ? formatLocalDateTime(a.endsAtUtc, timeZone) : "",
      dayKeyLocal: a.dayKey,
      locationLabel: a.locationLabel,
      audienceMode: "all_attendees" as const,
      targetRoles: [],
      isRequired: false,
      displayOrder: idx,
      createdAt: null,
      updatedAt: null,
      meetingAssignment: null,
      parentId: a.parentId,
      depth: a.depth,
      audienceNames: a.audienceNames,
    };
  });

  const meetingAssignmentItems: ConferenceScheduleItem[] = [];

  if (activeRun?.id) {
    let scheduleQuery = ac
      .from("schedules")
      .select(
        "id, scheduler_run_id, meeting_slot_id, exhibitor_registration_id, delegate_registration_ids, status"
      )
      .eq("conference_id", conferenceId)
      .eq("scheduler_run_id", activeRun.id)
      .neq("status", "canceled");

    if (options.viewerRole !== "admin" && options.viewerRegistrationId) {
      if (viewerMeetingRole === "delegate") {
        scheduleQuery = scheduleQuery.contains("delegate_registration_ids", [options.viewerRegistrationId]);
      } else {
        scheduleQuery = scheduleQuery.eq("exhibitor_registration_id", options.viewerRegistrationId);
      }
    } else if (options.viewerRole !== "admin" && !options.viewerRegistrationId) {
      scheduleQuery = scheduleQuery.limit(0);
    }

    const { data: scheduleRows } = (await scheduleQuery) as { data: any[] | null };
    const rows = scheduleRows ?? [];
    const meetingSlotIds = [...new Set(rows.map((row) => row.meeting_slot_id).filter(Boolean))];
    const exhibitorRegIds = [
      ...new Set(rows.map((row) => row.exhibitor_registration_id).filter(Boolean)),
    ];

    const [{ data: meetingSlots }, { data: exhibitorRegs }] = (await Promise.all([
      meetingSlotIds.length > 0
        ? ac
            .from("meeting_slots")
            .select("id, day_number, slot_number, start_time, end_time, suite_id")
            .in("id", meetingSlotIds)
        : Promise.resolve({ data: [] }),
      exhibitorRegIds.length > 0
        ? ac
            .from("conference_registrations")
            .select("id, organization_id")
            .in("id", exhibitorRegIds)
        : Promise.resolve({ data: [] }),
    ])) as [{ data: any[] | null }, { data: any[] | null }];

    const suiteIds = [...new Set((meetingSlots ?? []).map((slot) => slot.suite_id).filter(Boolean))];
    const organizationIds = [
      ...new Set((exhibitorRegs ?? []).map((row) => row.organization_id).filter(Boolean)),
    ];

    const [{ data: suites }, { data: organizations }] = (await Promise.all([
      suiteIds.length > 0
        ? ac.from("conference_suites").select("id, suite_number").in("id", suiteIds)
        : Promise.resolve({ data: [] }),
      organizationIds.length > 0
        ? ac.from("organizations").select("id, name").in("id", organizationIds)
        : Promise.resolve({ data: [] }),
    ])) as [{ data: any[] | null }, { data: any[] | null }];

    const slotById = new Map((meetingSlots ?? []).map((slot) => [slot.id, slot] as const));
    const exhibitorByRegId = new Map((exhibitorRegs ?? []).map((row) => [row.id, row] as const));
    const suiteById = new Map((suites ?? []).map((row) => [row.id, row] as const));
    const orgById = new Map((organizations ?? []).map((row) => [row.id, row] as const));

    for (const row of rows) {
      const slot = slotById.get(row.meeting_slot_id);
      const exhibitorReg = exhibitorByRegId.get(row.exhibitor_registration_id);
      if (!slot || !exhibitorReg) continue;

      const exhibitorOrg = exhibitorReg.organization_id
        ? orgById.get(exhibitorReg.organization_id)
        : null;
      const suite = suiteById.get(slot.suite_id);

      const startParts = parseTimeParts(slot.start_time);
      const endParts = parseTimeParts(slot.end_time);
      const meetingDate = meetingDays[Math.max(0, Number(slot.day_number ?? 1) - 1)] ?? null;
      const year = meetingDate ? Number(meetingDate.slice(0, 4)) : 1970;
      const month = meetingDate ? Number(meetingDate.slice(5, 7)) - 1 : 0;
      const day = meetingDate ? Number(meetingDate.slice(8, 10)) : Math.max(1, Math.min(28, Number(slot.day_number ?? 1)));
      const startsAt = new Date(
        Date.UTC(year, month, day, startParts.hour, startParts.minute, startParts.second)
      ).toISOString();
      const endsAt = new Date(
        Date.UTC(year, month, day, endParts.hour, endParts.minute, endParts.second)
      ).toISOString();

      const assignment: ConferenceMeetingAssignment = {
        scheduleId: row.id,
        schedulerRunId: row.scheduler_run_id,
        meetingSlotId: row.meeting_slot_id,
        exhibitorRegistrationId: row.exhibitor_registration_id,
        exhibitorOrganizationId: exhibitorReg.organization_id ?? null,
        exhibitorName: exhibitorOrg?.name ?? "Unknown exhibitor",
        delegateRegistrationIds: Array.isArray(row.delegate_registration_ids)
          ? row.delegate_registration_ids
          : [],
        dayNumber: Number(slot.day_number ?? 0),
        slotNumber: Number(slot.slot_number ?? 0),
        suiteId: slot.suite_id,
        suiteNumber: suite?.suite_number ?? null,
        startTime: slot.start_time,
        endTime: slot.end_time,
      };

      meetingAssignmentItems.push({
        id: `meeting-assignment-${row.id}`,
        conferenceId,
        source: "meeting_assignment",
        itemType: "meeting",
        kind: "meeting",
        title: assignment.exhibitorName,
        description: null,
        summary: null,
        startsAt,
        endsAt,
        startsAtLocal: `Day ${assignment.dayNumber}, Slot ${assignment.slotNumber} (${assignment.startTime})`,
        endsAtLocal: assignment.endTime,
        dayKeyLocal: `day-${assignment.dayNumber}`,
        locationLabel: assignment.suiteNumber ? `Suite ${assignment.suiteNumber}` : null,
        audienceMode: "target_roles",
        targetRoles: ["delegate", "exhibitor"],
        isRequired: false,
        displayOrder: assignment.slotNumber,
        createdAt: null,
        updatedAt: null,
        meetingAssignment: assignment,
        parentId: null,
        depth: 0,
        audienceNames: [],
      });
    }
  }

  const items = [...programItems, ...meetingAssignmentItems].sort(sortScheduleItems);

  return {
    conferenceId,
    timeZone,
    generatedAt: new Date().toISOString(),
    viewerRole: options.viewerRole,
    activeRunId: activeRun?.id ?? null,
    programItems: [...programItems].sort(sortScheduleItems),
    meetingAssignmentItems: [...meetingAssignmentItems].sort(sortScheduleItems),
    items,
  };
}

export function buildAttendeeMeetingRows(
  timeline: ConferenceScheduleTimeline
): ConferenceAttendeeMeetingRow[] {
  return timeline.meetingAssignmentItems
    .map((item) => item.meetingAssignment)
    .filter((item): item is ConferenceMeetingAssignment => Boolean(item))
    .map((assignment) => ({
      scheduleId: assignment.scheduleId,
      meetingSlotId: assignment.meetingSlotId,
      exhibitorRegistrationId: assignment.exhibitorRegistrationId,
      exhibitorOrganizationId: assignment.exhibitorOrganizationId ?? "",
      exhibitorName: assignment.exhibitorName,
      dayNumber: assignment.dayNumber,
      slotNumber: assignment.slotNumber,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      suiteNumber: assignment.suiteNumber,
    }))
    .sort((a, b) => {
      if (a.dayNumber !== b.dayNumber) return a.dayNumber - b.dayNumber;
      if (a.slotNumber !== b.slotNumber) return a.slotNumber - b.slotNumber;
      return a.exhibitorName.localeCompare(b.exhibitorName);
    });
}
