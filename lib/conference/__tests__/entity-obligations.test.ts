import { describe, expect, it } from "vitest";
import { grantTypesForKinds } from "../entity-obligations";
import { collectDataObligations } from "../grants";

describe("grantTypesForKinds — v3 holdings → obligation grant types", () => {
  it("a registration maps to badge_seat (delegate data obligations)", () => {
    expect(grantTypesForKinds(["registration"])).toContain("badge_seat");
  });

  it("a booth maps to booth_space", () => {
    expect(grantTypesForKinds(["booth"])).toContain("booth_space");
  });

  it("dedupes across kinds that share a grant type", () => {
    expect(grantTypesForKinds(["session", "event", "networking"])).toEqual(["education_access"]);
  });

  it("kinds with no attendee obligations contribute nothing", () => {
    expect(grantTypesForKinds(["venue", "floorplan", "policy", "ticket"])).toEqual([]);
  });

  it("holding a registration produces real data obligations via the existing definitions", () => {
    const obligations = collectDataObligations(grantTypesForKinds(["registration"]));
    expect(obligations.length).toBeGreaterThan(0);
  });
});
