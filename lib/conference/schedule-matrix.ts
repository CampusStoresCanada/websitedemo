import { createAdminClient } from "@/lib/supabase/admin";
import { loadMeetingCandidates } from "./meeting-candidates";
import { loadScheduleOpsSummary } from "./schedule-ops";
import type { MatrixParticipant, ScheduleMatrixData } from "./schedule-coverage";

/**
 * Server loader for the meeting matrix: the ops summary (suites / slots /
 * assignments) plus the eligible roster, so the coverage lens can answer "who
 * hasn't been scheduled yet". Pure types + the coverage math live in
 * schedule-coverage.ts (client-/test-safe).
 */

export async function loadScheduleMatrixData(conferenceId: string): Promise<ScheduleMatrixData> {
  const db = createAdminClient();
  /**
   * ⛔ WHO IS IN MEETINGS has one answer: the scheduler's (loadMeetingCandidates).
   * This used to keep its own copy of the rule — named registration seats, split
   * by "does the type need a booth" — and missed the half that asks whether the
   * type is in meetings at all, so CSC's own staff were listed as delegates with
   * no meetings (2026-10-26).
   */
  const [summary, candidates] = await Promise.all([
    loadScheduleOpsSummary(conferenceId),
    loadMeetingCandidates(db, conferenceId),
  ]);

  const seatIds = [...candidates.delegates, ...candidates.exhibitors].map((p) => p.registrationId);
  const orgIds = [
    ...new Set(seatIds.map((id) => candidates.seatById.get(id)?.organizationId).filter((id): id is string => !!id)),
  ];
  const { data: orgData } = orgIds.length
    ? await db.from("organizations").select("id, name").in("id", orgIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const orgById = new Map(((orgData ?? []) as Array<{ id: string; name: string }>).map((o) => [o.id, o.name] as const));

  const toParticipant = (seatId: string, type: MatrixParticipant["type"]): MatrixParticipant => {
    const seat = candidates.seatById.get(seatId);
    const orgName = seat?.organizationId ? orgById.get(seat.organizationId) ?? null : null;
    return {
      registrationId: seatId,
      // An exhibitor seat may have nobody named yet; it stands for its company.
      name: seat?.holderName?.trim() || orgName || seatId,
      orgName,
      type,
    };
  };

  /**
   * One exhibitor per company for the cell editor's picker, a named seat first:
   * a company is the exhibitor (meeting-candidates.ts), and listing each of its
   * unnamed staff seats would repeat it dozens of times.
   */
  const exhibitorSeats = new Map<string, string[]>();
  for (const e of candidates.exhibitors) {
    exhibitorSeats.set(e.organizationId, [...(exhibitorSeats.get(e.organizationId) ?? []), e.registrationId]);
  }
  const exhibitors = [...exhibitorSeats.values()].flatMap((ids) => {
    const named = ids.filter((id) => candidates.seatById.get(id)?.holderPersonId);
    return named.length > 0 ? named : ids.slice(0, 1);
  });

  return {
    summary,
    delegates: candidates.delegates.map((d) => toParticipant(d.registrationId, "delegate")),
    exhibitors: exhibitors.map((id) => toParticipant(id, "exhibitor")),
  };
}
