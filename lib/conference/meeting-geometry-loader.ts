import { createAdminClient } from "@/lib/supabase/admin";
import { CONTAINMENT_ROLE, holderOf, type InclusionRef } from "./inclusion";
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
  const [{ data: dayRows }, { data: suiteRows }, { data: refRows }, { data: balanceRows }] =
    await Promise.all([
      db.from("conference_entities").select("id, attributes").eq("conference_id", conferenceId).eq("kind", "day"),
      db.from("conference_entities").select("id, name, attributes").eq("conference_id", conferenceId).eq("kind", "suite"),
      // Containment, for deriving who holds a suite. See ./inclusion.
      db.from("conference_entity_refs")
        .select("from_entity_id, to_entity_id, role")
        .eq("conference_id", conferenceId)
        .eq("role", CONTAINMENT_ROLE),
      // The real record of who bought what. A sale writes here and nowhere else.
      db.from("entity_balances")
        .select("entity_id, organization_id")
        .eq("conference_id", conferenceId),
    ]);

  /**
   * Who holds each suite — DERIVED, never typed.
   *
   * This used to come from `suite.attributes.organization_id`: a copy of the
   * booth sale, kept by hand. It had already fallen behind by one — booth 202
   * (Ookami Promo) had a suite with empty attributes, so the scheduler could
   * never have put anyone in it.
   *
   * The sale is recorded once, on the booth. The booth `includes` the suite.
   * That is the whole derivation, and it cannot drift because there is no
   * second copy left to drift from.
   */
  const holdersByEntityId = new Map<string, string>();
  for (const b of balanceRows ?? []) {
    if (b.entity_id && b.organization_id) holdersByEntityId.set(b.entity_id, b.organization_id);
  }
  const refs = (refRows ?? []) as InclusionRef[];

  const days = (dayRows ?? []).map((r) => {
    const a = (r.attributes ?? {}) as Record<string, unknown>;
    return { date: typeof a.date === "string" ? a.date : "", attributes: a };
  });

  const suiteEntities = (suiteRows ?? []).map((r, index) => {
    const a = (r.attributes ?? {}) as Record<string, unknown>;
    /**
     * The NAME is the suite number. `attributes.suite_number` is only set on
     * suites that syncSuiteCount created; 18 of the 31 on CSC 2027 have it
     * null. (Measured: 13 set, all 31 numeric names, 0 disagreements — so the
     * two sources never conflict, one is just absent more often.)
     *
     * ⚠️ The old fallback was `index + 1`, i.e. array position. That would have
     * seeded 13 suites correctly and the other 18
     * numbered by array position — colliding with each other and bearing no relation to
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
    const org = holderOf(r.id, refs, holdersByEntityId);
    return { id: r.id, suiteNumber, organizationId: org, attributes: a };
  });

  /**
   * ⚠️ resolveMeetingGeometryFromEntities had the SAME `index + 1` fallback, and
   * this call used to strip the name before handing suites over — so fixing the
   * fallback here alone left the pure resolver still numbering by position.
   * Pass the resolved values instead of the raw bag, so there is one derivation.
   */
  const geometry = resolveMeetingGeometryFromEntities(
    days,
    suiteEntities.map((s) => ({
      attributes: s.attributes,
      suiteNumber: s.suiteNumber,
      organizationId: s.organizationId,
    }))
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
