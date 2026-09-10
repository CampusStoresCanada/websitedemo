import { describe, expect, it } from "vitest";
import {
  arrangeBadges,
  defaultArrangement,
  normalizeArrangement,
  type ArrangeableBadge,
} from "../arrangement";

/**
 * Arrangement is the print-file question: what order, and what is grouped with
 * what. It must not assume two types, and it must not assume anybody's sort.
 */

const VIP = "t-vip";
const PUBLIC = "t-public";
const TRADE = "t-trade";

function badge(over: Partial<ArrangeableBadge> & { entityId: string }): ArrangeableBadge {
  return {
    entityName: "Type",
    firstName: null,
    lastName: null,
    displayName: null,
    organizationName: null,
    roomNumber: null,
    seatedAt: null,
    ...over,
  };
}

const roster: ArrangeableBadge[] = [
  badge({ entityId: VIP, entityName: "VIP", lastName: "Zeta", displayName: "Ann Zeta", organizationName: "Bravo Co", roomNumber: "9", seatedAt: "2026-03-01" }),
  badge({ entityId: VIP, entityName: "VIP", lastName: "Alpha", displayName: "Bo Alpha", organizationName: "Alpha Co", roomNumber: "10", seatedAt: "2026-01-01" }),
  badge({ entityId: PUBLIC, entityName: "Public", lastName: "Mid", displayName: "Cy Mid", organizationName: "Charlie Co", roomNumber: "2", seatedAt: "2026-02-01" }),
];

describe("defaultArrangement", () => {
  it("gives one section per registration type, in the order given", () => {
    const a = defaultArrangement([
      { entityId: VIP, name: "VIP" },
      { entityId: PUBLIC, name: "Public" },
    ]);
    expect(a.sections.map((s) => s.label)).toEqual(["VIP", "Public"]);
    expect(a.sections[0].entityIds).toEqual([VIP]);
  });
});

describe("arrangeBadges", () => {
  it("prints sections in the order the operator set", () => {
    const out = arrangeBadges(roster, {
      sections: [
        { id: "b", label: "Public first", entityIds: [PUBLIC], sortBy: "person_last_name", direction: "asc" },
        { id: "a", label: "VIP second", entityIds: [VIP], sortBy: "person_last_name", direction: "asc" },
      ],
    });
    expect(out.map((s) => s.section.label)).toEqual(["Public first", "VIP second"]);
  });

  // The thing the old two-type model could not express.
  it("joins several registration types into one section", () => {
    const out = arrangeBadges(roster, {
      sections: [
        { id: "all", label: "Everyone", entityIds: [VIP, PUBLIC], sortBy: "person_last_name", direction: "asc" },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].badges.map((b) => b.lastName)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("sorts by organisation, and honours direction per section", () => {
    const out = arrangeBadges(roster, {
      sections: [
        { id: "s", label: "By org desc", entityIds: [VIP, PUBLIC], sortBy: "organization_name", direction: "desc" },
      ],
    });
    expect(out[0].badges.map((b) => b.organizationName)).toEqual(["Charlie Co", "Bravo Co", "Alpha Co"]);
  });

  // "Some people want them by registration date" — a real ask, not a hypothetical.
  it("sorts by when the seat was allocated", () => {
    const out = arrangeBadges(roster, {
      sections: [
        { id: "s", label: "By date", entityIds: [VIP, PUBLIC], sortBy: "seated_at", direction: "asc" },
      ],
    });
    expect(out[0].badges.map((b) => b.seatedAt)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("sorts hotel rooms numerically, so 10 comes after 9", () => {
    const out = arrangeBadges(roster, {
      sections: [
        { id: "s", label: "By room", entityIds: [VIP, PUBLIC], sortBy: "hotel_room_number", direction: "asc" },
      ],
    });
    expect(out[0].badges.map((b) => b.roomNumber)).toEqual(["2", "9", "10"]);
  });

  // ⛔ A badge silently missing from a print run is the most expensive failure
  // here. An arrangement that has fallen behind the catalogue must degrade to
  // "wrong pile", never "not printed".
  it("still prints a badge whose type is in no section", () => {
    const withOrphan = [...roster, badge({ entityId: TRADE, entityName: "Trade", lastName: "Orphan", displayName: "Dee Orphan" })];
    const out = arrangeBadges(withOrphan, {
      sections: [{ id: "s", label: "VIP only", entityIds: [VIP], sortBy: "person_last_name", direction: "asc" }],
    });
    expect(out.flatMap((s) => s.badges)).toHaveLength(4);
    expect(out.at(-1)!.section.label).toBe("Not in any section");
  });
});

describe("normalizeArrangement", () => {
  const types = [{ entityId: VIP, name: "VIP" }, { entityId: PUBLIC, name: "Public" }];

  it("falls back to the default for junk or absent state", () => {
    expect(normalizeArrangement(null, types).sections).toHaveLength(2);
    expect(normalizeArrangement({ sections: [] }, types).sections).toHaveLength(2);
    expect(normalizeArrangement({ sections: [{ entityIds: [] }] }, types).sections).toHaveLength(2);
  });

  // ⛔ The bug the user caught: a saved arrangement is a snapshot of the types
  // that existed when it was saved. Add a Speaker type tomorrow and it must
  // appear, or the admin cannot arrange what they cannot see — and it silently
  // lands in the "not in any section" pile on its first sale.
  it("adds a registration type the catalogue gained after the arrangement was saved", () => {
    const saved = { sections: [{ id: "x", label: "Everyone", entityIds: [VIP, PUBLIC], sortBy: "person_last_name", direction: "asc" }] };
    const a = normalizeArrangement(saved, [
      { entityId: VIP, name: "VIP" },
      { entityId: PUBLIC, name: "Public" },
      { entityId: TRADE, name: "Speaker" },
    ]);
    expect(a.sections).toHaveLength(2);
    expect(a.sections[0].label).toBe("Everyone");
    expect(a.sections[1]).toMatchObject({ label: "Speaker", entityIds: [TRADE] });
  });

  it("drops a type the catalogue no longer has", () => {
    const saved = { sections: [{ id: "x", label: "Mixed", entityIds: [VIP, "deleted-type"], sortBy: "person_last_name", direction: "asc" }] };
    const a = normalizeArrangement(saved, [{ entityId: VIP, name: "VIP" }]);
    expect(a.sections[0].entityIds).toEqual([VIP]);
  });

  it("keeps a saved arrangement and repairs an unknown sort key", () => {
    const a = normalizeArrangement(
      { sections: [{ id: "x", label: "Mine", entityIds: [VIP, PUBLIC], sortBy: "by_vibes", direction: "desc" }] },
      types
    );
    expect(a.sections).toHaveLength(1);
    expect(a.sections[0].label).toBe("Mine");
    expect(a.sections[0].sortBy).toBe("person_last_name");
    expect(a.sections[0].direction).toBe("desc");
  });
});
