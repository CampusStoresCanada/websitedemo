import { describe, it, expect } from "vitest";
import { resolveOrgPageBenchmarking, projectPeerRows } from "../org-page-visibility";

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

describe("the projected peer row", () => {
  const rows = [
    {
      organization_id: "a",
      disclosure_level: "full",
      operations_mandate: "self-funded",
      net_profit: 100_000,
      marketing_spend: 9_999,
      sales_apparel: 12_345,
      organization: { id: "a", name: "Store A", slug: "store-a" },
    },
  ];

  it("carries every field the peer table actually renders", () => {
    // Derived from the component, not guessed: operations_mandate drives the
    // Mandate tab and its absence broke that tab silently.
    const [r] = projectPeerRows(rows, { nameThem: true, viewerOrgIds: [] });
    for (const f of [
      "organization_id",
      "enrollment_fte",
      "institution_type",
      "operations_mandate",
      "total_square_footage",
      "total_gross_sales_instore",
      "total_online_sales",
      "total_cogs",
      "net_profit",
      "expense_hr",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(r, f)).toBe(true);
    }
  });

  it("drops everything the table does not render", () => {
    const [r] = projectPeerRows(rows, { nameThem: true, viewerOrgIds: [] });
    expect(r.marketing_spend).toBeUndefined();
    expect(r.sales_apparel).toBeUndefined();
  });

  it("strips names when the viewer is not entitled to them", () => {
    const [r] = projectPeerRows(rows, { nameThem: false, viewerOrgIds: [] });
    expect(r.organization).toBeNull();
    // The row survives, because the store still counts toward every figure.
    expect(r.net_profit).toBe(100_000);
  });

  it("keeps a store's own name even when it opted out to everyone else", () => {
    const optedOut = [{ ...rows[0], disclosure_level: "aggregate_only" }];
    const [mine] = projectPeerRows(optedOut, { nameThem: true, viewerOrgIds: ["a"] });
    const [theirs] = projectPeerRows(optedOut, { nameThem: true, viewerOrgIds: ["z"] });
    expect(mine.organization).not.toBeNull();
    expect(theirs.organization).toBeNull();
  });
});
