/**
 * Gathers the rows `composePublication()` arranges.
 *
 * One pass over the database per publication: the orgs, their booths, and the
 * conference's surfaces. Completeness is computed here with the pure
 * `computeOrgCompleteness` rather than re-queried, so a listing and its
 * completeness can never disagree about the same org.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { listDirectoryContacts } from "@/lib/contacts/directory";
import {
  resolvePlacements,
  resolveSurfaces,
  defaultSurfaceId,
} from "@/lib/conference/floor-surfaces";
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
async function boothNumbersByOrg(
  conferenceId: string,
): Promise<Map<string, string[]>> {
  const db = createAdminClient();
  const { data } = await db
    .from("entity_balances")
    .select(
      "organization_id, entity:conference_entities!entity_balances_entity_id_fkey(kind, name)",
    )
    .eq("conference_id", conferenceId);

  const byOrg = new Map<string, string[]>();
  for (const row of data ?? []) {
    const entity = Array.isArray(row.entity) ? row.entity[0] : row.entity;
    // A booth entity's `name` IS its number — `attributes.number` is null for
    // every booth in the catalogue.
    if (entity?.kind !== "booth" || !row.organization_id || !entity.name)
      continue;
    const list = byOrg.get(row.organization_id) ?? [];
    if (!list.includes(entity.name)) list.push(entity.name);
    byOrg.set(row.organization_id, list);
  }
  for (const list of byOrg.values()) list.sort(compareBoothNumbers);
  return byOrg;
}

/** Surfaces for the map section, with the same legacy fallback the viewer uses. */
export async function loadSurfacesForPublication(
  conferenceId: string,
): Promise<SurfaceForPublication[]> {
  const db = createAdminClient();
  const [{ data: entities }, { data: conf }] = await Promise.all([
    db
      .from("conference_entities")
      .select("id, name, attributes")
      .eq("conference_id", conferenceId)
      .eq("kind", "floorplan"),
    db
      .from("conference_instances")
      .select("floor_plan_url")
      .eq("id", conferenceId)
      .maybeSingle(),
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
export async function loadDirectoryEntries(
  source: PublicationSource,
): Promise<DirectoryEntry[]> {
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
  if (source.kind === "organizations") {
    query = query.eq("type", source.orgType);
    // "Active" is a membership status, NOT the absence of archived_at. Without
    // this the network directory would print 27 canceled members and 7 lapsed
    // partners as if they were current — in a book that cannot be corrected.
    //
    // Deliberately NOT `membership_expires_at >= <date>`, which is the other
    // meaning of "active" in this codebase and the right one for the conference
    // gate: that asks "does your membership cover the event?". A directory asks
    // "are you a member now?" — a different question. Using coverage here would
    // print 19 of 52 members today, because the membership year ends Aug 31 and
    // renewals are mid-collection.
    //
    // Deliberately not the `active_organizations` view either: that filters only
    // archived_at, so its name means the wrong thing here.
    if (!source.includeInactive) query = query.eq("membership_status", "active");
  } else if (orgIds) {
    // Conference source: no membership filter, because checkout already
    // enforces it. Buying a booth or a registration requires a membership that
    // covers the conference dates — see membershipCoversConference() and the
    // `requires` membership-renewal ref, which drags a renewal into the cart
    // when it doesn't. Confirmed against live data: every one of the 36 booth
    // holdings belongs to an org with membership_status 'active'.
    //
    // So filtering here would be a redundant no-op, and a redundant filter
    // would hide it if that invariant ever broke.
    query = query.in("id", orgIds);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  // A runtime column list defeats the client's generic inference; the shape is
  // pinned by COMPLETENESS_ORG_COLUMNS, which OrgCompletenessSource mirrors.
  const orgs = data as unknown as OrgRow[];

  // Printed directory: exclude people who have left or asked not to be listed.
  const contacts = await listDirectoryContacts<{
    id: string;
    organization_id: string | null;
    name: string | null;
    role_title: string | null;
    work_email: string | null;
    email: string | null;
    work_phone_number: string | null;
    phone: string | null;
  }>({
    organizationIds: orgs.map((o) => o.id),
    fields:
      "id, organization_id, name, role_title, work_email, email, work_phone_number, phone",
  });

  type ContactRow = {
    organization_id: string | null;
    name: string | null;
    role_title: string | null;
    work_email: string | null;
    email: string | null;
    work_phone_number: string | null;
    phone: string | null;
  };
  const contactCount = new Map<string, number>();
  const primaryContact = new Map<string, DirectoryEntry["primaryContact"]>();
  // Every listable person, for the People section. listDirectoryContacts has
  // already dropped opt-outs and departures.
  const allContacts = new Map<string, DirectoryEntry["contacts"]>();
  for (const c of (contacts ?? []) as ContactRow[]) {
    if (!c.organization_id) continue;
    contactCount.set(
      c.organization_id,
      (contactCount.get(c.organization_id) ?? 0) + 1,
    );
    if (!c.name?.trim()) continue;
    const candidate = {
      name: c.name.trim(),
      roleTitle: c.role_title?.trim() || null,
      email: c.work_email?.trim() || c.email?.trim() || null,
      phone: c.work_phone_number?.trim() || c.phone?.trim() || null,
    };
    // Prefer a contact with a stated role — "Sales Manager" tells a reader who
    // they're calling, which is the difference between a name and a lead.
    const held = primaryContact.get(c.organization_id);
    if (!held || (!held.roleTitle && candidate.roleTitle)) {
      primaryContact.set(c.organization_id, candidate);
    }
    allContacts.set(c.organization_id, [...(allContacts.get(c.organization_id) ?? []), candidate]);
  }

  return orgs
    .map((o): DirectoryEntry => {
      const withContacts: OrgCompletenessSource = {
        ...o,
        contactCount: contactCount.get(o.id) ?? 0,
      };
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
        publicCode: o.public_code ?? null,
        orgType: o.type ?? null,
        city: o.city ?? null,
        province: o.province ?? null,
        website: o.website ?? null,
        orgPhone: o.phone ?? null,
        primaryContact: primaryContact.get(o.id) ?? null,
        contacts: allContacts.get(o.id) ?? [],
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
  surfaces: SurfaceForPublication[],
): Promise<PlacedThing[]> {
  const db = createAdminClient();
  const [{ data: booths }, { data: refs }, { data: balances }] =
    await Promise.all([
      db
        .from("conference_entities")
        .select("id, name, attributes")
        .eq("conference_id", conferenceId)
        .eq("kind", "booth"),
      db
        .from("conference_entity_refs")
        .select("from_entity_id, to_entity_id, role")
        .eq("conference_id", conferenceId),
      db
        .from("entity_balances")
        .select("entity_id, organizations(name)")
        .eq("conference_id", conferenceId),
    ]);

  const bySurface = resolvePlacements(refs ?? [], surfaces);
  const fallback = defaultSurfaceId(surfaces);

  const orgByEntity = new Map<string, string>();
  for (const row of balances ?? []) {
    const org = Array.isArray(row.organizations)
      ? row.organizations[0]
      : row.organizations;
    if (row.entity_id && org?.name && !orgByEntity.has(row.entity_id))
      orgByEntity.set(row.entity_id, org.name);
  }

  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

  return (booths ?? []).flatMap((b): PlacedThing[] => {
    const a = (b.attributes ?? {}) as Record<string, unknown>;
    const x = num(a.x);
    const y = num(a.y);
    const w = num(a.w);
    const h = num(a.h);
    if (x == null || y == null || w == null || h == null) return [];
    const surfaceId = bySurface.get(b.id) ?? fallback;
    if (!surfaceId) return [];
    return [
      {
        entityId: b.id,
        surfaceId,
        label: b.name,
        x,
        y,
        w,
        h,
        rotation: num(a.rotation) ?? 0,
        orgName: orgByEntity.get(b.id) ?? null,
      },
    ];
  });
}
