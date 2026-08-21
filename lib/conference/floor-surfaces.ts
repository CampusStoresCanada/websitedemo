/**
 * Surfaces — the thing placement is relative to.
 *
 * A placement is (surface, x, y, w, h, rotation). It was previously (x, y, w, h,
 * rotation) against an image nobody named: one `conference_instances.floor_plan_url`
 * per conference, and no ref from a booth saying which image its fractions
 * belonged to. That works right up until an edition spans two halls or a
 * multi-floor property — the same class of assumption as the previous project's
 * hardcoded booth rectangles, one level up the stack.
 *
 * A surface is a `floorplan` entity. The kind already existed and was already
 * used as a place (`session --where--> floorplan`); it simply held no image and
 * owned no placements. So this is a completion, not a new subsystem.
 *
 * Placement uses its own role, `placed_on`, NOT `where`. Reusing `where` was the
 * first design and it is unsafe, for two concrete reasons found in the code:
 *
 *   - `saveScheduleItem` (lib/actions/conference-schedule-edit.ts) treats `where`
 *     as single-valued: it drops every scheduling-role ref and rebuilds from one
 *     `whereId`. Editing a thing that is both scheduled AND placed would
 *     silently destroy its placement.
 *   - `agenda.ts` takes the FIRST `where` ref as an item's display location, so
 *     a surface ref could surface as a session's venue.
 *
 * A suite is both scheduled and placed, so this is not hypothetical. Two
 * meanings, two roles.
 *
 * Pure and DB-free so the fallback matrix below can be tested directly: booth
 * sales are live on the legacy column right now, and a mistake here blanks the
 * public map mid-purchase.
 */

/** One surface: one background image, one coordinate space. */
export type FloorPlanSurface = {
  /** `floorplan` entity id, or LEGACY_SURFACE_ID for the synthesised one. */
  id: string;
  name: string;
  imageUrl: string | null;
  /** Ordering for a floor switcher — lower is lower down the building. */
  level: number;
};

/**
 * Stands in for a conference with no `floorplan` entity yet, so its
 * conference-level image still renders. Retire once every conference owns
 * real surface entities.
 */
export const LEGACY_SURFACE_ID = "__legacy_conference_floor_plan__";

/** The ref role that means "is placed on this surface". Deliberately not `where`. */
export const PLACEMENT_ROLE = "placed_on";

export type SurfaceEntityRow = {
  id: string;
  name: string;
  attributes: unknown;
};

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Resolve a conference's surfaces, newest model first and legacy as fallback.
 *
 * Two fallbacks, both deliberately narrow:
 *
 *  1. Exactly ONE surface carrying no image of its own inherits `legacyUrl`.
 *     Only when there is exactly one — spreading a single conference image
 *     across several surfaces would be actively wrong, not merely stale.
 *  2. NO surfaces at all, but a `legacyUrl`, synthesises a single surface.
 *
 * With neither, the result is empty and the caller renders no background —
 * correct for a conference whose art doesn't exist yet.
 */
export function resolveSurfaces(
  entities: SurfaceEntityRow[],
  legacyUrl: string | null
): FloorPlanSurface[] {
  const surfaces = entities
    .map((e) => {
      const a = (e.attributes ?? {}) as Record<string, unknown>;
      return { id: e.id, name: e.name, imageUrl: str(a.image_url), level: num(a.level) ?? 0 };
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  if (surfaces.length === 1 && !surfaces[0].imageUrl && legacyUrl) {
    return [{ ...surfaces[0], imageUrl: legacyUrl }];
  }
  if (surfaces.length === 0 && legacyUrl) {
    return [{ id: LEGACY_SURFACE_ID, name: "Floor Plan", imageUrl: legacyUrl, level: 0 }];
  }
  return surfaces;
}

export type PlacementRef = { from_entity_id: string; to_entity_id: string; role: string };

/**
 * Map placed entity → surface, from `placed_on` refs aimed at a real surface.
 * A ref pointing anywhere else is ignored — placement means a surface.
 */
export function resolvePlacements(
  refs: PlacementRef[],
  surfaces: FloorPlanSurface[]
): Map<string, string> {
  const ids = new Set(surfaces.map((s) => s.id));
  const byEntity = new Map<string, string>();
  for (const ref of refs) {
    if (ref.role !== PLACEMENT_ROLE || !ids.has(ref.to_entity_id)) continue;
    if (!byEntity.has(ref.from_entity_id)) byEntity.set(ref.from_entity_id, ref.to_entity_id);
  }
  return byEntity;
}

/**
 * The surface an unplaced entity belongs to. With exactly one surface that's
 * unambiguous — and is precisely the pre-surface behaviour, now stated rather
 * than assumed. With several, an unplaced thing genuinely has no home and must
 * be placed by an admin rather than guessed onto a floor.
 */
export function defaultSurfaceId(surfaces: FloorPlanSurface[]): string | null {
  return surfaces.length === 1 ? surfaces[0].id : null;
}

/**
 * Where a thing sits, once containment is taken into account.
 *
 * `viaEntityId` is whose x/y to draw with — itself when directly placed, or the
 * ancestor it was inherited from. A suite has no coordinates of its own; it is
 * inside booth 100, so it is drawn at booth 100's rectangle.
 */
export type PlacementResolution = {
  surfaceId: string;
  viaEntityId: string;
  /** False when this came from a container rather than the thing's own ref. */
  direct: boolean;
};

/**
 * Resolve placement for everything, following containment.
 *
 * The rule is general: **a contained thing inherits its container's placement
 * unless it has one of its own.** For CSC 2027 that means all 31 suites resolve
 * for free — each is already `booth --includes--> suite`, name for name, which
 * is the data saying what the user put plainly: the trade show hall *is* the
 * suites. Nobody has to place them by hand, and if a future edition puts the
 * suites on their own floor, giving them their own `placed_on` overrides the
 * inheritance without touching this code.
 *
 * Direct placement always wins. Inheritance is transitive, and a containment
 * cycle terminates rather than looping.
 */
export function resolvePlacementsWithInheritance(
  refs: PlacementRef[],
  surfaces: FloorPlanSurface[]
): Map<string, PlacementResolution> {
  const resolved = new Map<string, PlacementResolution>();
  for (const [entityId, surfaceId] of resolvePlacements(refs, surfaces)) {
    resolved.set(entityId, { surfaceId, viaEntityId: entityId, direct: true });
  }

  const contains = refs.filter((r) => r.role === "includes");
  // Iterate to a fixed point so a chain (surface → booth → suite → sub-thing)
  // resolves fully. Bounded by depth, so a cycle stops instead of hanging.
  for (let pass = 0; pass < contains.length + 1; pass++) {
    let changed = false;
    for (const ref of contains) {
      const parent = resolved.get(ref.from_entity_id);
      if (!parent || resolved.has(ref.to_entity_id)) continue;
      resolved.set(ref.to_entity_id, {
        surfaceId: parent.surfaceId,
        viaEntityId: parent.viaEntityId,
        direct: false,
      });
      changed = true;
    }
    if (!changed) break;
  }
  return resolved;
}
