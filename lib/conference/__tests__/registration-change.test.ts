import { describe, expect, it } from "vitest";
import { registrationChangeTargets, registrationChangeErrorMessage } from "../registration-change";
import { indexById } from "../entity-graph";
import type { BuildEntity, EntityRefView } from "../../actions/conference-entities";

function thing(p: Partial<BuildEntity> & { id: string; kind: string; name: string }): BuildEntity {
  return {
    isForSale: false, priceCents: null, currency: "CAD", attributes: {}, needsDefinition: false,
    inventory: null, tierPrices: {}, qboItemId: null, salesWindow: null, refs: [], ...p,
  };
}
const ref = (toEntityId: string, toName: string, toKind: string, role: string): EntityRefView =>
  ({ toEntityId, toName, toKind, role, quantity: null });

// The CSC 2027 day passes as they stand (2026-11-09).
function world() {
  const member = thing({ id: "member", kind: "audience", name: "Member", attributes: { source_role: "member" } });
  const nonMember = thing({ id: "non", kind: "audience", name: "Non-Member", attributes: { source_role: "non_member" } });
  const who = (...ids: string[]) => ids.map((id) => ref(id, id, "audience", "who"));
  const tue = thing({ id: "tue", kind: "registration", name: "Tuesday Day Pass", isForSale: true, priceCents: 19900, tierPrices: { public: 24900 }, refs: who("member") });
  const wed = thing({ id: "wed", kind: "registration", name: "Wednesday Day Pass", isForSale: true, priceCents: 19900, tierPrices: { non_member: 29900 }, refs: who("member", "non") });
  const thu = thing({ id: "thu", kind: "registration", name: "Thursday Day Pass", isForSale: true, priceCents: 19900, tierPrices: { public: 24900 }, refs: who("member") });
  const thuNon = thing({ id: "thu-non", kind: "registration", name: "Thursday Day Pass (Non-Member)", isForSale: true, priceCents: 29900, refs: who("non") });
  const full = thing({ id: "full", kind: "registration", name: "Full Conference Registration", isForSale: true, priceCents: 29900, refs: who("member") });
  const funded = thing({ id: "funded", kind: "registration", name: "Full Conference Registration (covered by CANCOLL)", priceCents: 0, attributes: { funded_by: "cancoll", funds_offer_id: "full" } });
  const board = thing({ id: "board", kind: "registration", name: "Board Registration", priceCents: 0 });
  const reception = thing({ id: "mg", kind: "event", name: "Meet & Greet Reception", isForSale: true, priceCents: 19900 });
  return indexById([member, nonMember, tue, wed, thu, thuNon, full, funded, board, reception]);
}

const names = (targets: Array<{ name: string }>) => targets.map((t) => t.name);

describe("registrationChangeTargets", () => {
  it("offers a member's Tuesday pass the other days at the same price", () => {
    const targets = registrationChangeTargets({ fromEntityId: "tue", paidUnitCents: 19900, buyerTier: "member", byId: world() });
    expect(names(targets)).toEqual(["Thursday Day Pass", "Wednesday Day Pass"]);
  });

  it("never offers a registration at another price: that would move money", () => {
    const targets = registrationChangeTargets({ fromEntityId: "tue", paidUnitCents: 19900, buyerTier: "member", byId: world() });
    expect(names(targets)).not.toContain("Full Conference Registration");
  });

  it("prices by the buyer's tier, so a non-member's $299 pass matches the non-member passes", () => {
    const targets = registrationChangeTargets({ fromEntityId: "thu-non", paidUnitCents: 29900, buyerTier: "non_member", byId: world() });
    expect(names(targets)).toEqual(["Wednesday Day Pass"]);
  });

  it("only offers what the buyer could have bought", () => {
    // A non-member who paid $199 somehow still cannot reach the member passes.
    const targets = registrationChangeTargets({ fromEntityId: "wed", paidUnitCents: 19900, buyerTier: "non_member", byId: world() });
    expect(targets).toEqual([]);
  });

  it("leaves the CANCOLL-funded registration to its own switch, both ways", () => {
    const w = world();
    expect(registrationChangeTargets({ fromEntityId: "funded", paidUnitCents: 0, buyerTier: "member", byId: w })).toEqual([]);
    const fromFull = registrationChangeTargets({ fromEntityId: "full", paidUnitCents: 0, buyerTier: "member", byId: w });
    expect(names(fromFull)).not.toContain("Full Conference Registration (covered by CANCOLL)");
  });

  it("never offers a registration that is not for sale, such as the board's", () => {
    const targets = registrationChangeTargets({ fromEntityId: "tue", paidUnitCents: 0, buyerTier: "member", byId: world() });
    expect(names(targets)).not.toContain("Board Registration");
  });

  it("never offers a capped registration that is sold out", () => {
    const w = world();
    w.set("wed", { ...w.get("wed")!, inventory: 40 });
    const full = registrationChangeTargets({
      fromEntityId: "tue", paidUnitCents: 19900, buyerTier: "member", byId: w, soldByEntity: new Map([["wed", 40]]),
    });
    expect(names(full)).toEqual(["Thursday Day Pass"]);
    const room = registrationChangeTargets({
      fromEntityId: "tue", paidUnitCents: 19900, buyerTier: "member", byId: w, soldByEntity: new Map([["wed", 39]]),
    });
    expect(names(room)).toContain("Wednesday Day Pass");
  });

  it("changes registrations only, not events", () => {
    expect(registrationChangeTargets({ fromEntityId: "mg", paidUnitCents: 19900, buyerTier: "member", byId: world() })).toEqual([]);
    const targets = registrationChangeTargets({ fromEntityId: "tue", paidUnitCents: 19900, buyerTier: "member", byId: world() });
    expect(names(targets)).not.toContain("Meet & Greet Reception");
  });
});

describe("registrationChangeErrorMessage", () => {
  it("explains a scheduled seat in plain words", () => {
    expect(registrationChangeErrorMessage("P0001: SEAT_IS_ON_A_SCHEDULE")).toMatch(/meeting schedule/);
  });
  it("passes through anything it does not know", () => {
    expect(registrationChangeErrorMessage("boom")).toBe("boom");
  });
});
