import { describe, expect, it } from "vitest";
import { canBuy, eligibleTiers, priceForTier, priceTable, availability } from "../entity-pricing";
import { indexById } from "../entity-graph";
import type { BuildEntity, EntityRefView } from "../../actions/conference-entities";

function thing(p: Partial<BuildEntity> & { id: string; kind: string; name: string }): BuildEntity {
  return {
    isForSale: false, priceCents: null, currency: "CAD", attributes: {}, needsDefinition: false,
    inventory: null, tierPrices: {}, qboItemId: null, refs: [], ...p,
  };
}
const ref = (toEntityId: string, toName: string, toKind: string, role: string): EntityRefView =>
  ({ toEntityId, toName, toKind, role, quantity: null });

// A registration sold to members ($500) and the public ($800), not to partners.
function regWorld() {
  const member = thing({ id: "member", kind: "audience", name: "Member", attributes: { source_role: "member" } });
  const pub = thing({ id: "public", kind: "audience", name: "Public", attributes: { source_role: "public" } });
  const reg = thing({
    id: "reg", kind: "registration", name: "Delegate Registration", isForSale: true, priceCents: 80000,
    tierPrices: { member: 50000, public: 80000 },
    refs: [ref("member", "Member", "audience", "who"), ref("public", "Public", "audience", "who")],
  });
  return { byId: indexById([member, pub, reg]), reg };
}

describe("eligibility — who can buy", () => {
  it("lists the Offer's eligible tiers from its who-audiences", () => {
    const { reg, byId } = regWorld();
    expect(eligibleTiers(reg, byId).sort()).toEqual(["member", "public"]);
  });

  it("lets an eligible tier buy", () => {
    const { reg, byId } = regWorld();
    expect(canBuy(reg, "member", byId).ok).toBe(true);
    expect(canBuy(reg, "public", byId).ok).toBe(true);
  });

  it("blocks a tier that isn't on the list", () => {
    const { reg, byId } = regWorld();
    const r = canBuy(reg, "partner", byId);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/member|public/);
  });

  it("an Offer with no who-audiences is open to anyone", () => {
    const open = thing({ id: "o", kind: "ticket", name: "Open Ticket", isForSale: true, priceCents: 1000 });
    expect(canBuy(open, "partner", indexById([open])).ok).toBe(true);
  });

  it("an instance inherits its type's who-audiences even with no who-ref of its own", () => {
    // Matches the real booth catalog shape: the type ("1") carries who:
    // Partner directly; every instance ("100", "101", ...) only carries
    // instance_of back to the type. A Member org must not see these as
    // eligible just because the instance itself has no direct who-ref.
    const partner = thing({ id: "partner", kind: "audience", name: "Partner", attributes: { source_role: "partner" } });
    const boothType = thing({
      id: "booth-type", kind: "booth", name: "1", isForSale: true, priceCents: 400000,
      refs: [ref("partner", "Partner", "audience", "who")],
    });
    const boothInstance = thing({
      id: "booth-100", kind: "booth", name: "100", isForSale: true, priceCents: 600000,
      refs: [ref("booth-type", "1", "booth", "instance_of")],
    });
    const byId = indexById([partner, boothType, boothInstance]);

    expect(eligibleTiers(boothInstance, byId)).toEqual(["partner"]);
    expect(canBuy(boothInstance, "member", byId).ok).toBe(false);
    expect(canBuy(boothInstance, "partner", byId).ok).toBe(true);
  });

  it("a thing that isn't for sale can't be bought", () => {
    const x = thing({ id: "x", kind: "session", name: "Talk" });
    expect(canBuy(x, "member", indexById([x])).ok).toBe(false);
  });
});

describe("tiered pricing", () => {
  it("charges the tier override when present", () => {
    const { reg } = regWorld();
    expect(priceForTier(reg, "member")).toBe(50000);
    expect(priceForTier(reg, "public")).toBe(80000);
  });

  it("falls back to the base price when a tier has no override", () => {
    const reg = thing({ id: "r", kind: "registration", name: "Reg", isForSale: true, priceCents: 80000, tierPrices: { member: 50000 } });
    expect(priceForTier(reg, "partner")).toBe(80000);
  });

  it("builds a price table by tier for display", () => {
    const { reg, byId } = regWorld();
    const table = priceTable(reg, byId);
    expect(table).toEqual(expect.arrayContaining([
      { tier: "member", cents: 50000 },
      { tier: "public", cents: 80000 },
    ]));
  });
});

describe("inventory / availability", () => {
  it("unlimited when no cap", () => {
    const o = thing({ id: "o", kind: "booth", name: "Booth", isForSale: true, inventory: null });
    expect(availability(o, 5)).toEqual({ cap: null, sold: 5, remaining: null, soldOut: false });
  });

  it("computes remaining and sold-out from a cap", () => {
    const o = thing({ id: "o", kind: "booth", name: "Booth", isForSale: true, inventory: 50 });
    expect(availability(o, 48)).toMatchObject({ remaining: 2, soldOut: false });
    expect(availability(o, 50)).toMatchObject({ remaining: 0, soldOut: true });
    expect(availability(o, 55)).toMatchObject({ remaining: 0, soldOut: true });
  });
});
