import { describe, expect, it } from "vitest";
import {
  LEGACY_SURFACE_ID,
  defaultSurfaceId,
  resolvePlacements,
  resolvePlacementsWithInheritance,
  resolveSurfaces,
} from "../floor-surfaces";

const LEGACY = "https://cdn.test/floor_plan.svg";
const hall = { id: "hall-1", name: "Trade Show Hall", attributes: {} };

describe("resolveSurfaces — legacy fallback", () => {
  it("renders today's conference unchanged: one imageless surface inherits the legacy URL", () => {
    // CSC 2027 exactly: a "Trade Show Hall" entity with attributes {}, and the
    // image still on conference_instances.floor_plan_url.
    const r = resolveSurfaces([hall], LEGACY);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("hall-1");
    expect(r[0].imageUrl).toBe(LEGACY);
  });

  it("synthesises a surface when a conference has none but has legacy art", () => {
    const r = resolveSurfaces([], LEGACY);
    expect(r).toEqual([{ id: LEGACY_SURFACE_ID, name: "Floor Plan", imageUrl: LEGACY, level: 0 }]);
  });

  it("never spreads one legacy image across several surfaces", () => {
    // The dangerous case: two halls, one legacy URL. Guessing which it belongs
    // to would put booths on the wrong floor plan — worse than showing none.
    const r = resolveSurfaces([hall, { id: "hall-2", name: "Second Hall", attributes: {} }], LEGACY);
    expect(r.map((s) => s.imageUrl)).toEqual([null, null]);
  });

  it("prefers a surface's own image over the legacy URL", () => {
    const own = "https://cdn.test/own.svg";
    const r = resolveSurfaces([{ ...hall, attributes: { image_url: own } }], LEGACY);
    expect(r[0].imageUrl).toBe(own);
  });

  it("returns nothing when there is no art at all", () => {
    expect(resolveSurfaces([], null)).toEqual([]);
    expect(resolveSurfaces([hall], null)[0].imageUrl).toBeNull();
  });
});

describe("resolveSurfaces — ordering", () => {
  it("orders by level, then name, so a floor switcher is stable", () => {
    const r = resolveSurfaces([
      { id: "c", name: "Mezzanine", attributes: { level: 2 } },
      { id: "a", name: "Basement", attributes: { level: -1 } },
      { id: "b", name: "Ballroom", attributes: { level: 1 } },
      { id: "d", name: "Atrium", attributes: { level: 1 } },
    ], null);
    expect(r.map((s) => s.name)).toEqual(["Basement", "Atrium", "Ballroom", "Mezzanine"]);
  });

  it("defaults a missing level to 0 rather than dropping the surface", () => {
    expect(resolveSurfaces([hall], null)[0].level).toBe(0);
  });
});

describe("resolvePlacements", () => {
  const surfaces = resolveSurfaces([hall, { id: "hall-2", name: "Second", attributes: {} }], null);

  it("places an entity via a `placed_on` ref at a surface", () => {
    const m = resolvePlacements(
      [{ from_entity_id: "booth-1", to_entity_id: "hall-2", role: "placed_on" }],
      surfaces
    );
    expect(m.get("booth-1")).toBe("hall-2");
  });

  it("ignores placement refs aimed at non-surfaces", () => {
    const m = resolvePlacements(
      [{ from_entity_id: "session-1", to_entity_id: "venue-9", role: "placed_on" }],
      surfaces
    );
    expect(m.size).toBe(0);
  });

  it("never treats a `where` ref as a placement", () => {
    // The reason placement has its own role: `where` is scheduling, is
    // single-valued in saveScheduleItem, and is read by agenda.ts as an item's
    // display venue. A suite is both scheduled and placed.
    const m = resolvePlacements(
      [{ from_entity_id: "suite-1", to_entity_id: "hall-1", role: "where" }],
      surfaces
    );
    expect(m.size).toBe(0);
  });

  it("ignores other roles entirely", () => {
    const m = resolvePlacements(
      [{ from_entity_id: "booth-1", to_entity_id: "hall-1", role: "instance_of" }],
      surfaces
    );
    expect(m.size).toBe(0);
  });

  it("takes the first placement when an entity somehow has two", () => {
    const m = resolvePlacements([
      { from_entity_id: "booth-1", to_entity_id: "hall-1", role: "placed_on" },
      { from_entity_id: "booth-1", to_entity_id: "hall-2", role: "placed_on" },
    ], surfaces);
    expect(m.get("booth-1")).toBe("hall-1");
  });
});

describe("defaultSurfaceId", () => {
  it("sends unplaced things to the only surface — the pre-surface behaviour", () => {
    expect(defaultSurfaceId(resolveSurfaces([hall], LEGACY))).toBe("hall-1");
  });

  it("refuses to guess a floor when there are several", () => {
    const many = resolveSurfaces([hall, { id: "hall-2", name: "Second", attributes: {} }], null);
    expect(defaultSurfaceId(many)).toBeNull();
  });

  it("is null when there are no surfaces", () => {
    expect(defaultSurfaceId([])).toBeNull();
  });
});

describe("resolvePlacementsWithInheritance", () => {
  const surfaces = resolveSurfaces([hall, { id: "hall-2", name: "Second", attributes: {} }], null);
  const place = (from: string, to: string) => ({ from_entity_id: from, to_entity_id: to, role: "placed_on" });
  const contains = (from: string, to: string) => ({ from_entity_id: from, to_entity_id: to, role: "includes" });

  it("gives a suite its containing booth's placement — the CSC 2027 case", () => {
    // booth 100 --includes--> suite 100, exactly as the live data has it.
    const r = resolvePlacementsWithInheritance(
      [place("booth-100", "hall-1"), contains("booth-100", "suite-100")],
      surfaces
    );
    expect(r.get("suite-100")).toEqual({ surfaceId: "hall-1", viaEntityId: "booth-100", direct: false });
  });

  it("marks a directly placed thing as direct, drawn by itself", () => {
    const r = resolvePlacementsWithInheritance([place("booth-100", "hall-1")], surfaces);
    expect(r.get("booth-100")).toEqual({ surfaceId: "hall-1", viaEntityId: "booth-100", direct: true });
  });

  it("lets an explicit placement override the container's", () => {
    // A future edition that moves suites to their own floor just places them.
    const r = resolvePlacementsWithInheritance([
      place("booth-100", "hall-1"),
      contains("booth-100", "suite-100"),
      place("suite-100", "hall-2"),
    ], surfaces);
    expect(r.get("suite-100")).toMatchObject({ surfaceId: "hall-2", direct: true });
  });

  it("inherits transitively down a chain", () => {
    const r = resolvePlacementsWithInheritance([
      place("booth-1", "hall-1"),
      contains("booth-1", "suite-1"),
      contains("suite-1", "table-1"),
    ], surfaces);
    expect(r.get("table-1")).toEqual({ surfaceId: "hall-1", viaEntityId: "booth-1", direct: false });
  });

  it("terminates on a containment cycle instead of hanging", () => {
    const r = resolvePlacementsWithInheritance([
      place("a", "hall-1"), contains("a", "b"), contains("b", "c"), contains("c", "a"),
    ], surfaces);
    expect(r.get("b")?.surfaceId).toBe("hall-1");
    expect(r.get("a")?.direct).toBe(true);
  });

  it("leaves a thing contained by nothing placed unresolved", () => {
    // Venues live elsewhere in the hotel; inventing a spot for them on the
    // trade show floor would be worse than admitting we don't know.
    const r = resolvePlacementsWithInheritance([contains("unplaced-parent", "venue-1")], surfaces);
    expect(r.has("venue-1")).toBe(false);
  });
});
