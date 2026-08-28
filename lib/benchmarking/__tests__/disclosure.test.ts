import { describe, it, expect } from "vitest";
import {
  resolveCut,
  explainSuppression,
  MIN_CUT_SIZE,
  type CutMember,
} from "../disclosure";

/**
 * The failure these guard against is not a crash — it is a store that was
 * promised anonymity and gets identified by subtraction anyway. Every case
 * below is a way that promise can be broken while the code looks fine.
 */

function member(id: string, level: CutMember["disclosureLevel"] = "full"): CutMember {
  return { organizationId: id, organizationName: `Store ${id}`, disclosureLevel: level };
}

describe("the small-n hazard", () => {
  it("THE case from the plan: three stores, two disclosing, names nobody", () => {
    // Three XLarge Quebec stores, two happy to be named, one not. Naming the
    // two publishes the third by subtraction against the total.
    const view = resolveCut({
      members: [member("a"), member("b"), member("c", "aggregate_only")],
      viewerDisclosure: "full",
      minCutSize: 3,
    });

    expect(view.named).toEqual([]);
    expect(view.suppressedReason).toBe("residual_identifiable");
    // The figures still count. Withdrawal governs attribution, not arithmetic.
    expect(view.contributing).toHaveLength(3);
  });

  it("names everyone when nobody opted out", () => {
    const view = resolveCut({
      members: [member("a"), member("b"), member("c"), member("d")],
      viewerDisclosure: "full",
    });
    expect(view.named.map((m) => m.organizationId)).toEqual(["a", "b", "c", "d"]);
  });

  it("names the disclosing stores once TWO are hidden behind the aggregate", () => {
    const view = resolveCut({
      members: [
        member("a"),
        member("b"),
        member("c", "aggregate_only"),
        member("d", "aggregate_only"),
      ],
      viewerDisclosure: "full",
    });
    expect(view.named.map((m) => m.organizationId)).toEqual(["a", "b"]);
    expect(view.suppressedReason).toBeUndefined();
  });

  it("withholds a cut too small to hide anyone in, even with no opt-outs", () => {
    // Protects the disclosing stores too: "the median of the two of you" is a
    // disclosure wearing an aggregate's clothes.
    const view = resolveCut({
      members: [member("a"), member("b")],
      viewerDisclosure: "full",
    });
    expect(view.showAggregate).toBe(false);
    expect(view.suppressedReason).toBe("below_min_cut_size");
    expect(view.named).toEqual([]);
  });

  it("publishes at exactly the minimum, not one above it", () => {
    const members = Array.from({ length: MIN_CUT_SIZE }, (_, i) => member(String(i)));
    const view = resolveCut({ members, viewerDisclosure: "full" });
    expect(view.showAggregate).toBe(true);
  });
});

describe("reciprocity", () => {
  it("shows an opted-out viewer the aggregate but no named peers", () => {
    const view = resolveCut({
      members: [member("a"), member("b"), member("c"), member("d")],
      viewerDisclosure: "aggregate_only",
    });

    expect(view.showAggregate).toBe(true);
    expect(view.named).toEqual([]);
    expect(view.withheldForReciprocity).toBe(4);
  });

  it("still counts an opted-out viewer's own figures toward the aggregate", () => {
    const members = [member("a"), member("b"), member("c"), member("me", "aggregate_only")];
    const view = resolveCut({ members, viewerDisclosure: "aggregate_only" });
    expect(view.contributing).toHaveLength(4);
  });
});

describe("explaining the gap", () => {
  it("says why a thin cut is withheld rather than showing nothing", () => {
    const view = resolveCut({ members: [member("a")], viewerDisclosure: "full" });
    expect(explainSuppression(view)).toMatch(/at least 4/);
  });

  it("explains the subtraction case without naming the store it protects", () => {
    const view = resolveCut({
      members: [member("a"), member("b"), member("c"), member("d", "aggregate_only")],
      viewerDisclosure: "full",
    });
    const text = explainSuppression(view)!;
    expect(text).toMatch(/subtraction/);
    expect(text).not.toMatch(/Store d/);
  });

  it("says nothing when there is nothing to explain", () => {
    const view = resolveCut({
      members: [member("a"), member("b"), member("c"), member("d")],
      viewerDisclosure: "full",
    });
    expect(explainSuppression(view)).toBeNull();
  });
});
