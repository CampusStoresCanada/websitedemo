import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveMeetingGeometryFromEntities,
  type MeetingGeometryResolution,
} from "./meeting-geometry";

/**
 * v3 meeting geometry, loaded from the entity graph (Day-cadence + Suite things)
 * instead of the schedule_modules config. Server-side util (not an action) so the
 * scheduler (ops access) and the program generator (admin) both reuse it without
 * an auth-gate mismatch — callers gate. Returns the same geometry shape, plus the
 * Suite entities so the scheduler can seed conference_suites 1:1.
 */
export interface ConferenceMeetingGeometry extends MeetingGeometryResolution {
  suites: Array<{ id: string; suiteNumber: number; organizationId: string | null }>;
}

export async function loadConferenceMeetingGeometry(
  conferenceId: string
): Promise<ConferenceMeetingGeometry> {
  const db = createAdminClient();
  const [{ data: dayRows }, { data: suiteRows }] = await Promise.all([
    db.from("conference_entities").select("id, attributes").eq("conference_id", conferenceId).eq("kind", "day"),
    db.from("conference_entities").select("id, attributes").eq("conference_id", conferenceId).eq("kind", "suite"),
  ]);

  const days = (dayRows ?? []).map((r) => {
    const a = (r.attributes ?? {}) as Record<string, unknown>;
    return { date: typeof a.date === "string" ? a.date : "", attributes: a };
  });

  const suiteEntities = (suiteRows ?? []).map((r, index) => {
    const a = (r.attributes ?? {}) as Record<string, unknown>;
    const parsed = Number(a.suite_number);
    const suiteNumber = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : index + 1;
    const org = typeof a.organization_id === "string" && a.organization_id.trim() ? a.organization_id.trim() : null;
    return { id: r.id, suiteNumber, organizationId: org, attributes: a };
  });

  const geometry = resolveMeetingGeometryFromEntities(
    days,
    suiteEntities.map((s) => ({ attributes: s.attributes }))
  );

  return {
    ...geometry,
    suites: suiteEntities.map((s) => ({
      id: s.id,
      suiteNumber: s.suiteNumber,
      organizationId: s.organizationId,
    })),
  };
}
