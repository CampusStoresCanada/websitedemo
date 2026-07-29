import { describe, expect, it } from "vitest";
import { effectiveRefs, openQuestions, wouldCycleIncludes, indexById } from "../entity-graph";
import type { BuildEntity, EntityRefView } from "../../actions/conference-entities";

function thing(partial: Partial<BuildEntity> & { id: string; kind: string; name: string }): BuildEntity {
  return {
    isForSale: false, priceCents: null, currency: "CAD", attributes: {}, needsDefinition: false,
    inventory: null, tierPrices: {}, qboItemId: null, refs: [],
    ...partial,
  };
}
const ref = (toEntityId: string, toName: string, toKind: string, role: string, quantity: number | null = null): EntityRefView =>
  ({ toEntityId, toName, toKind, role, quantity });

describe("effectiveRefs — instance inheritance", () => {
  it("an instance inherits its type's includes (real, not just on screen)", () => {
    const type = thing({
      id: "booth", kind: "booth", name: "Standard Booth",
      refs: [ref("reg", "Exhibitor Reg", "registration", "includes", 4), ref("table", "Table", "equipment", "includes", 1)],
    });
    const inst = thing({ id: "b601", kind: "booth", name: "Booth 601", refs: [ref("booth", "Standard Booth", "booth", "instance_of")] });
    const byId = indexById([type, inst]);

    const eff = effectiveRefs(inst, byId);
    const includes = eff.filter((r) => r.role === "includes");
    expect(includes).toHaveLength(2);
    expect(includes.every((r) => r.inherited)).toBe(true);
    expect(includes.find((r) => r.toEntityId === "reg")?.quantity).toBe(4);
  });

  it("an instance's own edge overrides the inherited one on the same role+target", () => {
    const type = thing({ id: "booth", kind: "booth", name: "Booth", refs: [ref("reg", "Reg", "registration", "includes", 4)] });
    const inst = thing({
      id: "b601", kind: "booth", name: "Booth 601",
      refs: [ref("booth", "Booth", "booth", "instance_of"), ref("reg", "Reg", "registration", "includes", 6)],
    });
    const includes = effectiveRefs(inst, indexById([type, inst])).filter((r) => r.role === "includes");
    expect(includes).toHaveLength(1);
    expect(includes[0].quantity).toBe(6);
    expect(includes[0].inherited).toBe(false);
  });

  it("a non-instance just returns its own refs", () => {
    const t = thing({ id: "x", kind: "session", name: "Talk", refs: [ref("day", "Wed", "day", "when")] });
    const eff = effectiveRefs(t, indexById([t]));
    expect(eff).toHaveLength(1);
    expect(eff[0].inherited).toBe(false);
  });
});

describe("openQuestions — kind-aware completeness", () => {
  it("flags an inline stub", () => {
    const e = thing({ id: "r", kind: "registration", name: "Exhibitor Reg", needsDefinition: true });
    expect(openQuestions(e, indexById([e]))).toContain("Coined on the fly — define what it is");
  });

  it("flags a session with no When", () => {
    const e = thing({ id: "s", kind: "session", name: "Keynote" });
    expect(openQuestions(e, indexById([e])).some((r) => r.includes("When"))).toBe(true);
  });

  it("does not flag a session that inherits its When from its type", () => {
    const type = thing({ id: "t", kind: "session", name: "Template", refs: [ref("day", "Wed", "day", "when")] });
    const inst = thing({ id: "i", kind: "session", name: "Copy", refs: [ref("t", "Template", "session", "instance_of")] });
    expect(openQuestions(inst, indexById([type, inst])).some((r) => r.includes("When"))).toBe(false);
  });

  it("flags an Offer with no audience and no price", () => {
    const e = thing({ id: "o", kind: "ticket", name: "VIP", isForSale: true, priceCents: null });
    const qs = openQuestions(e, indexById([e]));
    expect(qs.some((r) => r.includes("price"))).toBe(true);
    expect(qs.some((r) => r.includes("who can buy"))).toBe(true);
  });

  it("flags a required property that's missing (a Venue with no capacity)", () => {
    const e = thing({ id: "v", kind: "venue", name: "Hall A" });
    expect(openQuestions(e, indexById([e])).some((r) => r.includes("Capacity"))).toBe(true);
  });

  it("does not flag a required property once it has a value", () => {
    const e = thing({ id: "v", kind: "venue", name: "Hall A", attributes: { capacity: 400 } });
    expect(openQuestions(e, indexById([e])).some((r) => r.includes("Capacity"))).toBe(false);
  });

  it("a fully-specified booth raises no questions", () => {
    const e = thing({
      id: "b", kind: "booth", name: "Booth", isForSale: true, priceCents: 1000,
      refs: [ref("reg", "Reg", "registration", "includes", 4), ref("aud", "Exhibitors", "audience", "who")],
    });
    expect(openQuestions(e, indexById([e]))).toHaveLength(0);
  });

  it("a plain policy with no body still wants its text", () => {
    const e = thing({ id: "p", kind: "policy", name: "Refund rule" });
    expect(openQuestions(e, indexById([e])).some((r) => r.includes("Text"))).toBe(true);
  });

  it("a legal-backed policy is defined by its linked document, not a body field", () => {
    const e = thing({
      id: "p", kind: "policy", name: "Terms & Conditions",
      attributes: { legal_document_type: "terms_and_conditions" },
    });
    expect(openQuestions(e, indexById([e]))).toHaveLength(0);
  });
});

describe("wouldCycleIncludes — graph safety", () => {
  it("rejects self-reference", () => {
    expect(wouldCycleIncludes([], "a", "a")).toBe(true);
  });
  it("rejects a back-edge that closes a loop (B already includes A)", () => {
    expect(wouldCycleIncludes([{ from: "b", to: "a" }], "a", "b")).toBe(true);
  });
  it("rejects a longer loop (C→A, B→C, add A→B)", () => {
    expect(wouldCycleIncludes([{ from: "c", to: "a" }, { from: "b", to: "c" }], "a", "b")).toBe(true);
  });
  it("allows a plain acyclic edge", () => {
    expect(wouldCycleIncludes([{ from: "a", to: "b" }], "a", "c")).toBe(false);
  });
});
