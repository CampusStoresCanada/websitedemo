import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseOrgCategories } from "@/lib/publication/categories";
import {
  defaultSurfaceId,
  resolvePlacements,
  resolveSurfaces,
  type FloorPlanSurface,
} from "./floor-surfaces";

/**
 * The map a member uses to find something at the conference.
 *
 * The second viewer over one placement model. The first is the sales floor
 * plan under /conference/[year]/[edition]/floor-plan, which exists to sell
 * booths: it is single-surface, booth-only, and its geometry predates
 * surfaces. This one answers a different question — "where is this, and what
 * else is near it" — so it reads every placed thing on every surface.
 *
 * Deliberately NOT filtered to kind `booth`. A registration desk, a session
 * room and a suite are all things a member is looking for, and the placement
 * model has never cared what kind a thing is: a placement is
 * (surface, x, y, w, h). Filtering by kind here would rebuild the assumption
 * the surfaces model was built to remove.
 */

export type MappedThing = {
  entityId: string;
  surfaceId: string;
  /** What is written in the box — booth number, room name. */
  label: string;
  kind: string;
  /** Fractions of the background image, 0..1, so one number set fits any size. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** Who is there, when the thing is held by an organisation. */
  orgName: string | null;
  orgSlug: string | null;
  /** Carried so the map answers the same questions the directory does. */
  orgDescription: string | null;
  departments: string[];
  classes: string[];
  /**
   * People at this org who may be named publicly.
   *
   * ⛔ Filtered to `directory_visibility = 'public'` — NOT 'members'. This map
   * is reachable by anyone once the conference is visible, and making someone
   * findable by name is publishing them. Consent to be listed is per person,
   * and the person who agreed to appear in the members' directory did not
   * thereby agree to be searchable by the open web.
   *
   * Empty for every org today: 910 contacts have never set a visibility and 40
   * are hidden, so nobody has opted in yet.
   */
  people: string[];
};

export type MemberMap = {
  surfaces: FloorPlanSurface[];
  things: MappedThing[];
};

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export async function loadMemberMap(conferenceId: string): Promise<MemberMap> {
  const db = createAdminClient();
  const [{ data: surfaceRows }, { data: conf }, { data: entities }, { data: refs }, { data: balances }] =
    await Promise.all([
      db.from("conference_entities").select("id, name, attributes")
        .eq("conference_id", conferenceId).eq("kind", "floorplan"),
      db.from("conference_instances").select("floor_plan_url").eq("id", conferenceId).maybeSingle(),
      db.from("conference_entities").select("id, name, kind, attributes")
        .eq("conference_id", conferenceId).neq("kind", "floorplan"),
      db.from("conference_entity_refs").select("from_entity_id, to_entity_id, role")
        .eq("conference_id", conferenceId),
      db.from("entity_balances")
        .select("entity_id, organization_id, organizations(name, slug, company_description, primary_category, is_test)")
        .eq("conference_id", conferenceId),
    ]);

  const surfaces = resolveSurfaces(surfaceRows ?? [], conf?.floor_plan_url ?? null);
  if (surfaces.length === 0) return { surfaces: [], things: [] };

  const bySurface = resolvePlacements(refs ?? [], surfaces);
  const fallback = defaultSurfaceId(surfaces);

  type OrgHere = {
    name: string; slug: string | null;
    description: string | null; departments: string[]; classes: string[];
  };
  const orgByEntity = new Map<string, OrgHere>();
  const orgIdByEntity = new Map<string, string>();
  for (const row of balances ?? []) {
    if (row.entity_id && row.organization_id) orgIdByEntity.set(row.entity_id, row.organization_id);
    const org = (Array.isArray(row.organizations) ? row.organizations[0] : row.organizations) as
      | {
          name: string; slug: string | null; company_description: string | null;
          primary_category: string | null; is_test?: boolean;
        }
      | null;
    /**
     * ⛔ Same exclusion as the directory, and it was missing here too: `is_test`
     * is honoured by the homepage and the publication loaders but not by the two
     * surfaces a member actually navigates the show with. A seeded test
     * exhibitor would have been drawn on the floor plan, in a room, with a booth
     * number.
     */
    if (org?.is_test) continue;
    if (row.entity_id && org?.name && !orgByEntity.has(row.entity_id)) {
      // Same parse the directory and the printed index use, so "apparel"
      // finds the same companies on all three.
      const parsed = parseOrgCategories(org.primary_category);
      orgByEntity.set(row.entity_id, {
        name: org.name,
        slug: org.slug ?? null,
        description: org.company_description ?? null,
        // Same parse the directory and the printed index use, so "apparel"
        // finds the same companies on all three.
        departments: parsed.departments,
        classes: parsed.classes,
      });
    }
  }

  /**
   * Only people who have said yes, and only the strongest yes.
   *
   * `public` and not `members`: this page is reachable by anyone once the
   * conference is visible, and being findable by name here is being published.
   * Someone who agreed to the members' directory did not agree to that.
   */
  const orgIds = [...new Set(orgIdByEntity.values())];
  const peopleByOrgId = new Map<string, string[]>();
  if (orgIds.length > 0) {
    const { data: contacts } = await db
      .from("contacts")
      .select("organization_id, name")
      .in("organization_id", orgIds)
      .is("archived_at", null)
      .eq("directory_visibility", "public");
    for (const c of contacts ?? []) {
      if (!c.organization_id || !c.name) continue;
      const list = peopleByOrgId.get(c.organization_id) ?? [];
      list.push(c.name);
      peopleByOrgId.set(c.organization_id, list);
    }
  }

  const things: MappedThing[] = [];
  for (const e of entities ?? []) {
    const a = (e.attributes ?? {}) as Record<string, unknown>;
    const x = num(a.x), y = num(a.y), w = num(a.w), h = num(a.h);
    // No coordinates means not on the map. Not an error — most entities in a
    // conference are things like offers and policies that were never placed.
    if (x == null || y == null || w == null || h == null) continue;
    const surfaceId = bySurface.get(e.id) ?? fallback;
    // Placed nowhere resolvable, with several surfaces to choose from. Guessing
    // a floor would put a company in the wrong room; an admin has to say.
    if (!surfaceId) continue;
    const org = orgByEntity.get(e.id) ?? null;
    things.push({
      entityId: e.id,
      surfaceId,
      label: e.name,
      kind: e.kind,
      x, y, w, h,
      rotation: num(a.rotation) ?? 0,
      orgName: org?.name ?? null,
      orgSlug: org?.slug ?? null,
      orgDescription: org?.description ?? null,
      departments: org?.departments ?? [],
      classes: org?.classes ?? [],
      people: peopleByOrgId.get(orgIdByEntity.get(e.id) ?? "") ?? [],
    });
  }

  return { surfaces, things };
}
