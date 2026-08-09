import { describe, expect, it } from "vitest";
import { expandOffer, offerGrants, resolveAccess, accessibleThings } from "../entity-commerce";
import { indexById } from "../entity-graph";
import type { BuildEntity, EntityRefView } from "../../actions/conference-entities";

function thing(p: Partial<BuildEntity> & { id: string; kind: string; name: string }): BuildEntity {
  return { isForSale: false, priceCents: null, currency: "CAD", attributes: {}, needsDefinition: false, inventory: null, tierPrices: {}, qboItemId: null, salesWindow: null, refs: [], ...p };
}
const ref = (toEntityId: string, toName: string, toKind: string, role: string, quantity: number | null = null): EntityRefView =>
  ({ toEntityId, toName, toKind, role, quantity });

// The Booth scenario: a Booth includes equipment + sellable registrations/ticket;
// each registration is involved_in the Trade Show and includes a Day.
function boothWorld() {
  const day = thing({ id: "day", kind: "day", name: "Wed" });
  const tradeShow = thing({ id: "ts", kind: "session", name: "Trade Show" });
  const reg = thing({
    id: "reg", kind: "registration", name: "Exhibitor Reg", isForSale: true, priceCents: 0,
    refs: [ref("ts", "Trade Show", "session", "involved_in"), ref("day", "Wed", "day", "includes", 1)],
  });
  const networking = thing({ id: "net", kind: "ticket", name: "Networking", isForSale: true, priceCents: 5000 });
  const table = thing({ id: "tbl", kind: "equipment", name: "Table" });
  const chair = thing({ id: "chr", kind: "equipment", name: "Chair" });
  const booth = thing({
    id: "booth", kind: "booth", name: "Standard Booth", isForSale: true, priceCents: 250000,
    refs: [
      ref("tbl", "Table", "equipment", "includes", 1),
      ref("chr", "Chair", "equipment", "includes", 2),
      ref("reg", "Exhibitor Reg", "registration", "includes", 4),
      ref("net", "Networking", "ticket", "includes", 1),
    ],
  });
  return indexById([day, tradeShow, reg, networking, table, chair, booth]);
}

describe("expandOffer — minting what an Offer grants", () => {
  it("expands a Booth into its included things, with quantities", () => {
    const m = expandOffer("booth", boothWorld(), 1);
    expect(m.get("tbl")).toBe(1);
    expect(m.get("chr")).toBe(2);
    expect(m.get("reg")).toBe(4);
    expect(m.get("net")).toBe(1);
  });

  it("multiplies quantity down nested edges (4 regs each include a day → 4 days)", () => {
    const m = expandOffer("booth", boothWorld(), 1);
    expect(m.get("day")).toBe(4);
  });

  it("multiplies by purchase quantity (2 booths → 8 registrations)", () => {
    const m = expandOffer("booth", boothWorld(), 2);
    expect(m.get("reg")).toBe(8);
    expect(m.get("day")).toBe(8);
  });

  it("sums a diamond across paths instead of visiting once", () => {
    const d = thing({ id: "d", kind: "x", name: "D" });
    const b = thing({ id: "b", kind: "x", name: "B", refs: [ref("d", "D", "x", "includes", 3)] });
    const c = thing({ id: "c", kind: "x", name: "C", refs: [ref("d", "D", "x", "includes", 1)] });
    const a = thing({ id: "a", kind: "x", name: "A", refs: [ref("b", "B", "x", "includes", 2), ref("c", "C", "x", "includes", 1)] });
    // D via B: 2*3=6; via C: 1*1=1 → 7
    expect(expandOffer("a", indexById([a, b, c, d]), 1).get("d")).toBe(7);
  });

  it("offerGrants drops the offer itself and names the rest", () => {
    const grants = offerGrants("booth", boothWorld(), 1);
    expect(grants.some((g) => g.entityId === "booth")).toBe(false);
    expect(grants.find((g) => g.entityId === "reg")?.quantity).toBe(4);
  });
});

describe("resolveAccess — the bundling rule, generalized", () => {
  it("a holder of an Exhibitor Reg can get into the Trade Show (involved_in) and the Day (includes)", () => {
    const access = resolveAccess(["reg"], boothWorld());
    expect(access.has("ts")).toBe(true);
    expect(access.has("day")).toBe(true);
  });

  it("the non-member 'bankruptcy' scenario: a reg minted inside a booth still grants Trade Show access", () => {
    const byId = boothWorld();
    // Jordan, a non-member, holds one registration that came bundled in a booth.
    const things = accessibleThings(["reg"], byId);
    expect(things.map((t) => t.name)).toContain("Trade Show");
  });

  it("holding nothing grants nothing", () => {
    expect(accessibleThings([], boothWorld())).toHaveLength(0);
  });

  it("an instance inherits its type's involvement (resolves through instance_of)", () => {
    const ts = thing({ id: "ts", kind: "session", name: "Trade Show" });
    const type = thing({ id: "booth", kind: "booth", name: "Booth", refs: [ref("ts", "Trade Show", "session", "involved_in")] });
    const inst = thing({ id: "b601", kind: "booth", name: "Booth 601", refs: [ref("booth", "Booth", "booth", "instance_of")] });
    expect(resolveAccess(["b601"], indexById([ts, type, inst])).has("ts")).toBe(true);
  });
});
