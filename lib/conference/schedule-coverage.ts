import type {
  ScheduleOpsAssignment,
  ScheduleOpsSlot,
  ScheduleOpsSummary,
} from "./schedule-ops";

/**
 * Pure types + math for the meeting matrix. No server imports (type-only from
 * schedule-ops), so the client component AND tests can use it; the server-only
 * data loader lives in schedule-matrix.ts.
 */

export type MatrixParticipant = {
  registrationId: string;
  name: string;
  orgName: string | null;
  type: "delegate" | "exhibitor";
};

export type ScheduleMatrixData = {
  summary: ScheduleOpsSummary;
  delegates: MatrixParticipant[];
  exhibitors: MatrixParticipant[];
};

export type CoverageReport = {
  totalCells: number;
  filledCells: number;
  emptyCells: number;
  fillPct: number;
  totalMeetings: number;
  exhibitorOnlyMeetings: number;
  unscheduledExhibitors: MatrixParticipant[];
  unscheduledDelegates: MatrixParticipant[];
  suiteUtil: Array<{ suiteId: string; filled: number; total: number }>;
};

/** Pure "how is the grid filling in" math, given the slots, assignments, roster. */
export function computeCoverage(
  slots: ScheduleOpsSlot[],
  assignments: ScheduleOpsAssignment[],
  delegates: MatrixParticipant[],
  exhibitors: MatrixParticipant[]
): CoverageReport {
  const filledSlotIds = new Set(assignments.map((a) => a.meetingSlotId));
  const totalCells = slots.length;
  const filledCells = slots.filter((s) => filledSlotIds.has(s.id)).length;

  const scheduledExhibitorIds = new Set(assignments.map((a) => a.exhibitorRegistrationId));
  const scheduledDelegateIds = new Set(assignments.flatMap((a) => a.delegateRegistrationIds));

  const suiteMap = new Map<string, { filled: number; total: number }>();
  for (const slot of slots) {
    const cur = suiteMap.get(slot.suiteId) ?? { filled: 0, total: 0 };
    cur.total += 1;
    if (filledSlotIds.has(slot.id)) cur.filled += 1;
    suiteMap.set(slot.suiteId, cur);
  }

  return {
    totalCells,
    filledCells,
    emptyCells: totalCells - filledCells,
    fillPct: totalCells > 0 ? Math.round((filledCells / totalCells) * 100) : 0,
    totalMeetings: assignments.length,
    exhibitorOnlyMeetings: assignments.filter((a) => a.delegateRegistrationIds.length === 0).length,
    unscheduledExhibitors: exhibitors.filter((e) => !scheduledExhibitorIds.has(e.registrationId)),
    unscheduledDelegates: delegates.filter((d) => !scheduledDelegateIds.has(d.registrationId)),
    suiteUtil: [...suiteMap.entries()].map(([suiteId, v]) => ({ suiteId, ...v })),
  };
}
