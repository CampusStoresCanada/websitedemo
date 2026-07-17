import { describe, expect, it } from "vitest";

import type { ScheduleOpsAssignment, ScheduleOpsSlot } from "../schedule-ops";
import { computeCoverage, type MatrixParticipant } from "../schedule-coverage";

function slot(id: string, suiteId: string, slotNumber: number): ScheduleOpsSlot {
  return { id, suiteId, dayNumber: 1, slotNumber, startTime: "09:00:00", endTime: "09:15:00" };
}

function assignment(
  meetingSlotId: string,
  suiteId: string,
  exhibitorRegistrationId: string,
  delegateRegistrationIds: string[]
): ScheduleOpsAssignment {
  return {
    id: `a-${meetingSlotId}`,
    schedulerRunId: "run-1",
    meetingSlotId,
    suiteId,
    dayNumber: 1,
    slotNumber: 1,
    exhibitorRegistrationId,
    exhibitorOrganizationName: "Acme",
    delegateRegistrationIds,
    delegateNames: delegateRegistrationIds,
    status: "scheduled",
    isManual: false,
  };
}

function participant(id: string, type: "delegate" | "exhibitor"): MatrixParticipant {
  return { registrationId: id, name: id.toUpperCase(), orgName: null, type };
}

describe("computeCoverage", () => {
  // 2 suites × 2 slots = 4 cells. s1 filled (ex1 + 2 delegates), s4 filled
  // (ex2, exhibitor-only). s2 + s3 empty.
  const slots = [slot("s1", "sA", 1), slot("s2", "sA", 2), slot("s3", "sB", 1), slot("s4", "sB", 2)];
  const assignments = [
    assignment("s1", "sA", "ex1", ["d1", "d2"]),
    assignment("s4", "sB", "ex2", []),
  ];
  const exhibitors = ["ex1", "ex2", "ex3"].map((id) => participant(id, "exhibitor"));
  const delegates = ["d1", "d2", "d3"].map((id) => participant(id, "delegate"));
  const cov = computeCoverage(slots, assignments, delegates, exhibitors);

  it("counts grid fill", () => {
    expect(cov.totalCells).toBe(4);
    expect(cov.filledCells).toBe(2);
    expect(cov.emptyCells).toBe(2);
    expect(cov.fillPct).toBe(50);
  });

  it("counts meetings and exhibitor-only ones", () => {
    expect(cov.totalMeetings).toBe(2);
    expect(cov.exhibitorOnlyMeetings).toBe(1);
  });

  it("finds who isn't scheduled", () => {
    expect(cov.unscheduledExhibitors.map((e) => e.registrationId)).toEqual(["ex3"]);
    expect(cov.unscheduledDelegates.map((d) => d.registrationId)).toEqual(["d3"]);
  });

  it("reports per-suite utilization", () => {
    const bySuite = Object.fromEntries(cov.suiteUtil.map((s) => [s.suiteId, s]));
    expect(bySuite.sA).toEqual({ suiteId: "sA", filled: 1, total: 2 });
    expect(bySuite.sB).toEqual({ suiteId: "sB", filled: 1, total: 2 });
  });

  it("handles no slots without dividing by zero", () => {
    expect(computeCoverage([], [], [], []).fillPct).toBe(0);
  });
});
