import { describe, expect, it } from "vitest";
import { canPauseCircleBadge } from "../badge-preference";

/**
 * The allow-list is the entire access boundary for this feature: the API route
 * 403s on it, the root layout hides the control on it, and both server-side
 * short-circuits read it before they'll skip a billed Circle call.
 */
describe("canPauseCircleBadge", () => {
  it("allows the allow-listed account", () => {
    expect(canPauseCircleBadge("google@campusstores.ca")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(canPauseCircleBadge("  Google@CampusStores.ca  ")).toBe(true);
  });

  it("rejects everyone else", () => {
    expect(canPauseCircleBadge("someone@campusstores.ca")).toBe(false);
    expect(canPauseCircleBadge("google@example.com")).toBe(false);
  });

  it("rejects a missing email rather than defaulting open", () => {
    expect(canPauseCircleBadge(null)).toBe(false);
    expect(canPauseCircleBadge(undefined)).toBe(false);
    expect(canPauseCircleBadge("")).toBe(false);
  });
});
