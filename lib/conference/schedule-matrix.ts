import { createAdminClient } from "@/lib/supabase/admin";
import { loadSeatHoldings } from "./seats";
import { offerRequiresOwnershipOfEntityIds } from "./ownership-gate";
import { loadScheduleOpsSummary } from "./schedule-ops";
import type { MatrixParticipant, ScheduleMatrixData } from "./schedule-coverage";

/**
 * Server loader for the meeting matrix: the ops summary (suites / slots /
 * assignments) plus the eligible roster, so the coverage lens can answer "who
 * hasn't been scheduled yet". Pure types + the coverage math live in
 * schedule-coverage.ts (client-/test-safe).
 */

export async function loadScheduleMatrixData(conferenceId: string): Promise<ScheduleMatrixData> {
  const summary = await loadScheduleOpsSummary(conferenceId);
  const db = createAdminClient();

  /**
   * The eligible roster is NAMED SEATS — the same gate the scheduler uses, now
   * that both read seats instead of conference_registrations (0 rows, no
   * writer). This used to filter `registration_type` against the string
   * literals "delegate"/"observer"/"exhibitor"; which side someone is on is a
   * property of the type they hold — an exhibiting registration
   * `requires_ownership_of` a booth.
   */
  const { seats, entitiesById } = await loadSeatHoldings(db, {
    conferenceId,
    entityKinds: ["registration"],
    assigned: true,
  });

  const exhibitingTypeIds = new Set(
    [...entitiesById.values()]
      .filter(
        (e) =>
          e.kind === "registration" &&
          offerRequiresOwnershipOfEntityIds(e.refs).some((id) => entitiesById.get(id)?.kind === "booth")
      )
      .map((e) => e.id)
  );

  const orgIds = Array.from(new Set(seats.map((s) => s.organizationId).filter(Boolean)));
  let orgs: Array<{ id: string; name: string }> = [];
  if (orgIds.length > 0) {
    const { data: orgData } = await db.from("organizations").select("id, name").in("id", orgIds);
    orgs = (orgData ?? []) as Array<{ id: string; name: string }>;
  }
  const orgById = new Map(orgs.map((o) => [o.id, o.name] as const));

  const toParticipant = (seat: (typeof seats)[number]): MatrixParticipant => ({
    registrationId: seat.seatId,
    name: seat.holderName?.trim() || seat.seatId,
    orgName: seat.organizationId ? orgById.get(seat.organizationId) ?? null : null,
    type: exhibitingTypeIds.has(seat.entityId) ? "exhibitor" : "delegate",
  });

  return {
    summary,
    delegates: seats.filter((s) => !exhibitingTypeIds.has(s.entityId)).map(toParticipant),
    exhibitors: seats.filter((s) => exhibitingTypeIds.has(s.entityId)).map(toParticipant),
  };
}
