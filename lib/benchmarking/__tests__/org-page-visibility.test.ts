import { describe, it, expect } from "vitest";
import { resolveOrgPageBenchmarking } from "../org-page-visibility";

/**
 * The costly failure is showing a store's net profit to someone who was never
 * entitled to it. Every rule below therefore fails CLOSED — the default when a
 * condition is unmet is aggregate, never detail.
 */

const base = {
  targetDisclosureLevel: "full" as string | null,
  viewerFiled: true,
  viewerDisclosureLevel: "full" as string | null,
  isOwnOrg: false,
  isStaff: false,
};

describe("reciprocity", () => {
  it("withholds detail from a member who has not filed", () => {
    const r = resolveOrgPageBenchmarking({ ...base, viewerFiled: false });
    expect(r.show).toBe("aggregate");
  });

  it("says how to fix it rather than just refusing", () => {
    const r = resolveOrgPageBenchmarking({ ...base, viewerFiled: false });
    expect(r.show === "aggregate" && r.reason).toMatch(/Complete this year's survey/);
  });

  it("shows detail to a member who filed", () => {
    expect(resolveOrgPageBenchmarking(base).show).toBe("detail");
  });
});

describe("the store's own choice", () => {
  it("withholds detail for a store that asked not to be named", () => {
    const r = resolveOrgPageBenchmarking({ ...base, targetDisclosureLevel: "aggregate_only" });
    expect(r.show).toBe("aggregate");
    // The point of the choice is that their figures still count.
    expect(r.show === "aggregate" && r.reason).toMatch(/still in the comparisons|in the comparisons/i);
  });

  it("still shows a store its OWN figures when it chose aggregate-only", () => {
    // The choice is about how others see them, never about hiding their own
    // numbers from themselves.
    const r = resolveOrgPageBenchmarking({
      ...base,
      targetDisclosureLevel: "aggregate_only",
      isOwnOrg: true,
    });
    expect(r.show).toBe("detail");
  });

  it("withholds others' detail from a store that withholds its own", () => {
    const r = resolveOrgPageBenchmarking({ ...base, viewerDisclosureLevel: "aggregate_only" });
    expect(r.show).toBe("aggregate");
    expect(r.show === "aggregate" && r.reason).toMatch(/both ways/);
  });
});

describe("staff", () => {
  it("see detail — they need the truth to do the job", () => {
    expect(
      resolveOrgPageBenchmarking({
        ...base,
        isStaff: true,
        viewerFiled: false,
        targetDisclosureLevel: "aggregate_only",
      }).show,
    ).toBe("detail");
  });
});

describe("failing closed", () => {
  it("treats an unknown disclosure value as named, not as a hole", () => {
    // Only the explicit opt-out withholds; a null means the store never chose,
    // which is the default of taking part fully.
    expect(resolveOrgPageBenchmarking({ ...base, targetDisclosureLevel: null }).show).toBe("detail");
  });

  it("withholds when the viewer has no org at all", () => {
    expect(
      resolveOrgPageBenchmarking({ ...base, viewerFiled: false, viewerDisclosureLevel: null }).show,
    ).toBe("aggregate");
  });
});
