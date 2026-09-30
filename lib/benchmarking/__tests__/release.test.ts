import { describe, it, expect } from "vitest";
import { isReleased } from "@/lib/benchmarking/release";

/**
 * Filing is not publishing.
 *
 * Before this gate existed, a figure went live on a store's own page and into
 * everyone else's peer set the moment a row existed — and nothing filtered on
 * status, so that included a row a store had merely OPENED. Clicking into the
 * survey replaced a full year of verified figures with an empty one.
 */
describe("which years may be shown to other stores", () => {
  const released = [2025, 2024];

  it("shows a year the committee has released", () => {
    expect(isReleased(2025, released)).toBe(true);
  });

  it("withholds the year currently being filed", () => {
    expect(isReleased(2026, released)).toBe(false);
  });

  it("withholds a year with no filing at all", () => {
    expect(isReleased(null, released)).toBe(false);
    expect(isReleased(undefined, released)).toBe(false);
  });

  it("withholds everything when nothing has been released", () => {
    expect(isReleased(2025, [])).toBe(false);
  });
});
