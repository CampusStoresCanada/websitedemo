import { createAdminClient } from "@/lib/supabase/admin";
import { loadScheduleOpsSummary } from "./schedule-ops";
import type { MatrixParticipant, ScheduleMatrixData } from "./schedule-coverage";

/**
 * Server loader for the meeting matrix: the ops summary (suites / slots /
 * assignments) plus the eligible roster, so the coverage lens can answer "who
 * hasn't been scheduled yet". Pure types + the coverage math live in
 * schedule-coverage.ts (client-/test-safe).
 */

type RegRow = {
  id: string;
  registration_type: string;
  delegate_name: string | null;
  legal_name: string | null;
  organization_id: string | null;
};

export async function loadScheduleMatrixData(conferenceId: string): Promise<ScheduleMatrixData> {
  const summary = await loadScheduleOpsSummary(conferenceId);
  const db = createAdminClient();

  // Eligible roster = submitted/confirmed delegate/observer/exhibitor
  // registrations (same gate the scheduler uses).
  const { data: regData } = await db
    .from("conference_registrations")
    .select("id, registration_type, delegate_name, legal_name, organization_id")
    .eq("conference_id", conferenceId)
    .in("status", ["submitted", "confirmed"])
    .in("registration_type", ["delegate", "observer", "exhibitor"]);
  const rows = (regData ?? []) as RegRow[];

  const orgIds = Array.from(
    new Set(rows.map((r) => r.organization_id).filter((v): v is string => Boolean(v)))
  );
  let orgs: Array<{ id: string; name: string }> = [];
  if (orgIds.length > 0) {
    const { data: orgData } = await db.from("organizations").select("id, name").in("id", orgIds);
    orgs = (orgData ?? []) as Array<{ id: string; name: string }>;
  }
  const orgById = new Map(orgs.map((o) => [o.id, o.name] as const));

  const toParticipant = (r: RegRow): MatrixParticipant => ({
    registrationId: r.id,
    name: r.delegate_name?.trim() || r.legal_name?.trim() || r.id,
    orgName: r.organization_id ? orgById.get(r.organization_id) ?? null : null,
    type: r.registration_type === "exhibitor" ? "exhibitor" : "delegate",
  });

  return {
    summary,
    delegates: rows.filter((r) => r.registration_type !== "exhibitor").map(toParticipant),
    exhibitors: rows.filter((r) => r.registration_type === "exhibitor").map(toParticipant),
  };
}
