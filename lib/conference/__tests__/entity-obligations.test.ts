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
    // session and networking both map to education_access and nothing else.
    // `event` used to be the third kind here; it now also carries meal_access
    // (a social function feeds people), so it no longer belongs in a test
    // about deduping down to a single grant type.
    expect(grantTypesForKinds(["session", "networking"])).toEqual(["education_access"]);
  });

  it("an event carries education AND meal access, deduped against a session", () => {
    expect(grantTypesForKinds(["session", "event"]).sort()).toEqual(["education_access", "meal_access"]);
  });

  it("kinds with no attendee obligations contribute nothing", () => {
    expect(grantTypesForKinds(["venue", "floorplan", "policy", "ticket"])).toEqual([]);
  });

  it("holding a registration produces real data obligations via the existing definitions", () => {
    const obligations = collectDataObligations(grantTypesForKinds(["registration"]));
    expect(obligations.length).toBeGreaterThan(0);
  });
});
