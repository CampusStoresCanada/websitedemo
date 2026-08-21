/**
 * Loads the rows `computeOrgCompleteness` scores.
 *
 * Split from completeness.ts deliberately: that module is pure and carries no
 * "use server", so a client component (a partner's completeness meter) can
 * import the field definitions and the scoring without dragging the admin
 * Supabase client into the bundle.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  COMPLETENESS_ORG_COLUMNS,
  computeOrgCompleteness,
  summarizeCompleteness,
  type CompletenessSummary,
  type OrgCompleteness,
  type OrgCompletenessSource,
} from "./completeness";

export type CompletenessScope = {
  /**
   * Restrict to orgs actually in the directory for one conference — i.e. those
   * holding a booth. Sourced from `entity_balances` (real purchases), matching
   * how getConfirmedExhibitors() draws the same line. Omit to score every
   * active Vendor Partner.
   */
  conferenceId?: string;
  /** Restrict to specific orgs — used by a single partner's own meter. */
  orgIds?: string[];
};

/** Org ids holding at least one booth at this conference. */
async function boothHolderOrgIds(conferenceId: string): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("entity_balances")
    .select("organization_id, entity:conference_entities!entity_balances_entity_id_fkey(kind)")
    .eq("conference_id", conferenceId);

  const ids = new Set<string>();
  for (const row of data ?? []) {
    const entity = Array.isArray(row.entity) ? row.entity[0] : row.entity;
    if (entity?.kind === "booth" && row.organization_id) ids.add(row.organization_id);
  }
  return Array.from(ids);
}

/**
 * Score orgs for publication readiness. Reads columns only — an org with no
 * user account and no onboarding journey scores exactly as accurately as one
 * whose admin logs in daily.
 */
export async function loadDirectoryCompleteness(
  scope: CompletenessScope = {}
): Promise<OrgCompleteness[]> {
  const db = createAdminClient();

  let orgIds = scope.orgIds;
  if (scope.conferenceId) {
    const holders = await boothHolderOrgIds(scope.conferenceId);
    orgIds = orgIds ? orgIds.filter((id) => holders.includes(id)) : holders;
    // Scoped to a conference with no booths sold — nothing to score.
    if (orgIds.length === 0) return [];
  }

  let query = db
    .from("organizations")
    .select(COMPLETENESS_ORG_COLUMNS)
    .is("archived_at", null)
    .or("is_test.is.null,is_test.eq.false");

  // Without an explicit org set, the directory population is active partners.
  // `type` is capitalised in the DB — a lowercase filter silently returns [].
  if (orgIds) query = query.in("id", orgIds);
  else query = query.eq("type", "Vendor Partner");

  const { data, error } = await query;
  if (error || !data) return [];
  // A runtime column list defeats the client's generic inference — the shape is
  // pinned by COMPLETENESS_ORG_COLUMNS, which OrgCompletenessSource mirrors.
  const orgs = data as unknown as Omit<OrgCompletenessSource, "contactCount">[];

  // Contact counts in one pass rather than per-org.
  const ids = orgs.map((o) => o.id);
  const { data: contacts } = await db
    .from("contacts")
    .select("id, organization_id")
    .in("organization_id", ids);

  const contactCount = new Map<string, number>();
  for (const c of (contacts ?? []) as { organization_id: string | null }[]) {
    if (!c.organization_id) continue;
    contactCount.set(c.organization_id, (contactCount.get(c.organization_id) ?? 0) + 1);
  }

  return orgs
    .map((o) => computeOrgCompleteness({ ...o, contactCount: contactCount.get(o.id) ?? 0 }))
    .sort((a, b) => a.overallPct - b.overallPct || a.orgName.localeCompare(b.orgName));
}

/** The gap report: scored rows plus the per-field rollup, worst gap first. */
export async function loadCompletenessReport(
  scope: CompletenessScope = {}
): Promise<{ rows: OrgCompleteness[]; summary: CompletenessSummary }> {
  const rows = await loadDirectoryCompleteness(scope);
  return { rows, summary: summarizeCompleteness(rows) };
}
