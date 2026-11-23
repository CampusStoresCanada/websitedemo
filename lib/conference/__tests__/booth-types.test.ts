import { describe, expect, it } from "vitest";
import { boothTypes } from "../entity-commerce";
import { indexById } from "../entity-graph";
import type { BuildEntity, EntityRefView } from "../../actions/conference-entities";

function thing(p: Partial<BuildEntity> & { id: string; kind: string; name: string }): BuildEntity {
  return { isForSale: false, priceCents: null, currency: "CAD", attributes: {}, needsDefinition: false, inventory: null, tierPrices: {}, qboItemId: null, salesWindow: null, refs: [], ...p };
}
const ref = (toEntityId: string, toName: string, toKind: string, role: string, quantity: number | null = null): EntityRefView =>
  ({ toEntityId, toName, toKind, role, quantity });

// The 2027 shape: booth "1" is both a booth and the Exhibitor type; booth
// "600" is the Connected type; numbered booths are instances of one or the other.
function world() {
  const table = thing({ id: "tbl", kind: "item", name: "6' x 2' Folding Table" });
  const chair = thing({ id: "chr", kind: "item", name: "Folding Chair" });
  const reg = thing({ id: "reg", kind: "registration", name: "Exhibitor Staff Registration", refs: [ref("meal", "Lunch", "meal", "includes", 1)] });
  const meal = thing({ id: "meal", kind: "meal", name: "Lunch" });
  const suite = thing({ id: "s600", kind: "suite", name: "600" });
  const exhibitor = thing({
    id: "b1", kind: "booth", name: "1", isForSale: true, priceCents: 400000,
    attributes: { size: "8' x 10'", pitch: "Exhibit Wed & Thu." },
    refs: [ref("tbl", table.name, "item", "includes", 1), ref("chr", chair.name, "item", "includes", 2), ref("reg", reg.name, "registration", "includes", 4)],
  });
  const connected = thing({
    id: "b600", kind: "booth", name: "600", isForSale: true, priceCents: 600000,
    attributes: { size: "8' x 10' " },
    refs: [ref("tbl", table.name, "item", "includes", 1), ref("s600", "600", "suite", "includes", 1)],
  });
  const instance = (id: string, name: string, typeId: string, typeName: string, isForSale = true) =>
    thing({ id, kind: "booth", name, isForSale, refs: [ref(typeId, typeName, "booth", "instance_of")] });
  return indexById([
    table, chair, reg, meal, suite, exhibitor, connected,
    instance("b10", "10", "b1", "1"), instance("b2", "2", "b1", "1"),
    instance("b100", "100", "b600", "600"),
    instance("b999", "999", "b600", "600", false),
  ]);
}

describe("boothTypes", () => {
  it("groups booths under their type, cheapest type first", () => {
    const types = boothTypes(world());
    expect(types.map((t) => t.id)).toEqual(["b1", "b600"]);
  });

  it("lists booth numbers in number order, not string order", () => {
    expect(boothTypes(world())[0].boothNumbers).toEqual(["1", "2", "10"]);
  });

  it("keeps a booth taken off sale, because it is still someone's booth", () => {
    expect(boothTypes(world())[1].boothNumbers).toEqual(["100", "600", "999"]);
  });

  it("lists what one booth comes with, one level deep", () => {
    const [exhibitor] = boothTypes(world());
    expect(exhibitor.includes.map((i) => [i.name, i.quantity])).toEqual([
      ["6' x 2' Folding Table", 1],
      ["Folding Chair", 2],
      ["Exhibitor Staff Registration", 4],
    ]);
    // The registration's own meal is not a booth inclusion.
    expect(exhibitor.includes.some((i) => i.kind === "meal")).toBe(false);
  });

  it("trims the size and keeps a missing pitch missing", () => {
    const connected = boothTypes(world())[1];
    expect(connected.size).toBe("8' x 10'");
    expect(connected.pitch).toBeNull();
  });
});
