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
    db.from("conference_entities").select("id, name, attributes").eq("conference_id", conferenceId).eq("kind", "suite"),
  ]);

  const days = (dayRows ?? []).map((r) => {
    const a = (r.attributes ?? {}) as Record<string, unknown>;
    return { date: typeof a.date === "string" ? a.date : "", attributes: a };
  });

  const suiteEntities = (suiteRows ?? []).map((r, index) => {
    const a = (r.attributes ?? {}) as Record<string, unknown>;
    /**
     * The NAME is the suite number. `attributes.suite_number` is only set on
     * suites that syncSuiteCount created; 29 of the 31 on CSC 2027 were made
     * by hand and have it null.
     *
     * ⚠️ The old fallback was `index + 1`, i.e. array position. That would have
     * seeded conference_suites with suites 100 and 101 correct and the other 29
     * numbered 3, 4, 5… — colliding with each other and bearing no relation to
     * the booth a member actually walks to. A suite is the meeting use of a
     * booth of the same number (booth --includes--> suite), so the name is the
     * only thing tying the two together, and it was the one field never read.
     *
     * Position is kept as the last resort for a suite named something
     * non-numeric, which no conference has yet. Better a made-up number than a
     * crash, but it must never be reached ahead of a real one.
     */
    const fromAttribute = Number(a.suite_number);
    const fromName = Number(r.name);
    const suiteNumber =
      Number.isFinite(fromAttribute) && fromAttribute > 0
        ? Math.floor(fromAttribute)
        : Number.isFinite(fromName) && fromName > 0
          ? Math.floor(fromName)
          : index + 1;
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
