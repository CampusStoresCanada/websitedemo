/**
 * Gathers the rows `composePublication()` arranges.
 *
 * One pass over the database per publication: the orgs, their booths, and the
 * conference's surfaces. Completeness is computed here with the pure
 * `computeOrgCompleteness` rather than re-queried, so a listing and its
 * completeness can never disagree about the same org.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePlacements, resolveSurfaces, defaultSurfaceId } from "@/lib/conference/floor-surfaces";
import {
  COMPLETENESS_ORG_COLUMNS,
  computeOrgCompleteness,
  type OrgCompletenessSource,
} from "./completeness";
import {
  compareBoothNumbers,
  type DirectoryEntry,
  type PlacedThing,
  type PublicationSource,
  type SurfaceForPublication,
} from "./composition";

type OrgRow = Omit<OrgCompletenessSource, "contactCount">;

/** org id → booth numbers held at this conference, ascending. */
async function boothNumbersByOrg(conferenceId: string): Promise<Map<string, string[]>> {
  const db = createAdminClient();
  const { data } = await db
    .from("entity_balances")
    .select("organization_id, entity:conference_entities!entity_balances_entity_id_fkey(kind, name)")
    .eq("conference_id", conferenceId);

  const byOrg = new Map<string, string[]>();
  for (const row of data ?? []) {
    const entity = Array.isArray(row.entity) ? row.entity[0] : row.entity;
    // A booth entity's `name` IS its number — `attributes.number` is null for
    // every booth in the catalogue.
    if (entity?.kind !== "booth" || !row.organization_id || !entity.name) continue;
    const list = byOrg.get(row.organization_id) ?? [];
    if (!list.includes(entity.name)) list.push(entity.name);
    byOrg.set(row.organization_id, list);
  }
  for (const list of byOrg.values()) list.sort(compareBoothNumbers);
  return byOrg;
}

/** Surfaces for the map section, with the same legacy fallback the viewer uses. */
export async function loadSurfacesForPublication(conferenceId: string): Promise<SurfaceForPublication[]> {
  const db = createAdminClient();
  const [{ data: entities }, { data: conf }] = await Promise.all([
    db.from("conference_entities").select("id, name, attributes").eq("conference_id", conferenceId).eq("kind", "floorplan"),
    db.from("conference_instances").select("floor_plan_url").eq("id", conferenceId).maybeSingle(),
  ]);
  return resolveSurfaces(entities ?? [], conf?.floor_plan_url ?? null);
}

/**
 * Load the entries for a publication's source.
 *
 * A conference source lists orgs that actually bought a booth (`entity_balances`),
 * not the for-sale catalogue — the same line `getConfirmedExhibitors()` already
 * draws between inventory and real exhibitors.
 */
export async function loadDirectoryEntries(source: PublicationSource): Promise<DirectoryEntry[]> {
  const db = createAdminClient();

  let boothsByOrg = new Map<string, string[]>();
  let orgIds: string[] | null = null;

  if (source.kind === "conference") {
    boothsByOrg = await boothNumbersByOrg(source.conferenceId);
    orgIds = [...boothsByOrg.keys()];
    if (orgIds.length === 0) return [];
  }

  let query = db
    .from("organizations")
    .select(COMPLETENESS_ORG_COLUMNS)
    .is("archived_at", null)
    .or("is_test.is.null,is_test.eq.false");
  // Narrow on the discriminant, not on orgIds — TS can't tell the two apart
  // otherwise. `type` is capitalised in the DB; a lowercase filter silently
  // returns [].
  if (source.kind === "organizations") query = query.eq("type", source.orgType);
  else if (orgIds) query = query.in("id", orgIds);

  const { data, error } = await query;
  if (error || !data) return [];
  // A runtime column list defeats the client's generic inference; the shape is
  // pinned by COMPLETENESS_ORG_COLUMNS, which OrgCompletenessSource mirrors.
  const orgs = data as unknown as OrgRow[];

  const { data: contacts } = await db
    .from("contacts")
    .select("id, organization_id")
    .in("organization_id", orgs.map((o) => o.id));
  const contactCount = new Map<string, number>();
  for (const c of (contacts ?? []) as { organization_id: string | null }[]) {
    if (c.organization_id) contactCount.set(c.organization_id, (contactCount.get(c.organization_id) ?? 0) + 1);
  }

  return orgs
    .map((o): DirectoryEntry => {
      const withContacts: OrgCompletenessSource = { ...o, contactCount: contactCount.get(o.id) ?? 0 };
      return {
        orgId: o.id,
        orgName: o.name,
        orgSlug: o.slug,
        logoUrl: o.logo_url,
        description: o.company_description,
        featuredProduct: o.highlight_product_name,
        featuredProductDetail: o.highlight_product_description,
        catalogueUrl: o.catalogue_url,
        rawCategories: o.primary_category,
        boothNumbers: boothsByOrg.get(o.id) ?? [],
        completeness: computeOrgCompleteness(withContacts),
      };
    })
    .sort((a, b) => a.orgName.localeCompare(b.orgName));
}

/**
 * Booths as drawable things, on the surface each sits on.
 *
 * Unplaced booths (no coordinates) are omitted — there is nowhere to draw them.
 * They are not lost: they still appear in the listings and the booth index,
 * which is where a reader looking for a company actually starts.
 */
export async function loadPlacementsForPublication(
  conferenceId: string,
  surfaces: SurfaceForPublication[]
): Promise<PlacedThing[]> {
  const db = createAdminClient();
  const [{ data: booths }, { data: refs }, { data: balances }] = await Promise.all([
    db.from("conference_entities").select("id, name, attributes").eq("conference_id", conferenceId).eq("kind", "booth"),
    db.from("conference_entity_refs").select("from_entity_id, to_entity_id, role").eq("conference_id", conferenceId),
    db.from("entity_balances")
      .select("entity_id, organizations(name)")
      .eq("conference_id", conferenceId),
  ]);

  const bySurface = resolvePlacements(refs ?? [], surfaces);
  const fallback = defaultSurfaceId(surfaces);

  const orgByEntity = new Map<string, string>();
  for (const row of balances ?? []) {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (row.entity_id && org?.name && !orgByEntity.has(row.entity_id)) orgByEntity.set(row.entity_id, org.name);
  }

  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

  return (booths ?? []).flatMap((b): PlacedThing[] => {
    const a = (b.attributes ?? {}) as Record<string, unknown>;
    const x = num(a.x); const y = num(a.y); const w = num(a.w); const h = num(a.h);
    if (x == null || y == null || w == null || h == null) return [];
    const surfaceId = bySurface.get(b.id) ?? fallback;
    if (!surfaceId) return [];
    return [{
      entityId: b.id, surfaceId, label: b.name, x, y, w, h,
      rotation: num(a.rotation) ?? 0,
      orgName: orgByEntity.get(b.id) ?? null,
    }];
  });
}
