import { describe, it, expect } from "vitest";
import { buildCut, median, effectiveFte, type BenchmarkingRow } from "../comparison";

/**
 * These exist because the disclosure promise is only as good as the thing that
 * renders it. A store told "we will never name you" is entitled to that being
 * true on the page, not just in a helper nobody calls.
 */

function row(id: string, over: Partial<BenchmarkingRow> = {}): BenchmarkingRow {
  return {
    organization_id: id,
    disclosure_level: "full",
    total_gross_sales_instore: 1_000_000,
    total_online_sales: 0,
    enrollment_fte: 10_000,
    total_square_footage: 5_000,
    fulltime_employees: 10,
    ...over,
  };
}

const names = (ids: string[]) => new Map(ids.map((i) => [i, `Store ${i}`]));

describe("median", () => {
  it("takes the middle of an odd set", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the middle pair of an even set", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("is null with nothing to average", () => {
    expect(median([])).toBeNull();
  });
});

describe("a cut that is too thin to publish", () => {
  it("withholds Quebec's two stores and says why", () => {
    // The real 2025 shape: Quebec has 2 participating stores.
    const rows = [row("me"), row("b")];
    const cut = buildCut({
      key: "region",
      label: "Region",
      bucket: "Quebec",
      rows,
      nameById: names(["me", "b"]),
      viewerOrgId: "me",
    });

    expect(cut.showAggregate).toBe(false);
    expect(cut.named).toEqual([]);
    expect(cut.suppressionReason).toMatch(/at least 4/);
    // Even the median is withheld — two stores' median IS the two stores.
    expect(cut.metrics.every((m) => m.median === null)).toBe(true);
  });

  it("still shows the reader their OWN figures — those are theirs", () => {
    const cut = buildCut({
      key: "region",
      label: "Region",
      bucket: "Quebec",
      rows: [row("me"), row("b")],
      nameById: names(["me", "b"]),
      viewerOrgId: "me",
    });
    expect(cut.metrics.find((m) => m.key === "revenue")!.yours).toBe(1_000_000);
  });
});

describe("the residual rule, on a cut big enough to publish", () => {
  it("names nobody when exactly one store opted out", () => {
    // Five stores, one hidden: naming the other four publishes the fifth by
    // subtraction against a median built from all five.
    const rows = [
      row("me"),
      row("b"),
      row("c"),
      row("d"),
      row("hidden", { disclosure_level: "aggregate_only" }),
    ];
    const cut = buildCut({
      key: "type",
      label: "Institution type",
      bucket: "University",
      rows,
      nameById: names(["me", "b", "c", "d", "hidden"]),
      viewerOrgId: "me",
    });

    expect(cut.showAggregate).toBe(true);
    expect(cut.named).toEqual([]);
    expect(cut.suppressionReason).toMatch(/subtraction/);
  });

  it("names the disclosing peers once two are hidden", () => {
    const rows = [
      row("me"),
      row("b"),
      row("c"),
      row("h1", { disclosure_level: "aggregate_only" }),
      row("h2", { disclosure_level: "aggregate_only" }),
    ];
    const cut = buildCut({
      key: "type",
      label: "Institution type",
      bucket: "University",
      rows,
      nameById: names(["me", "b", "c", "h1", "h2"]),
      viewerOrgId: "me",
    });

    expect(cut.named.map((n) => n.organizationId).sort()).toEqual(["b", "c"]);
    // And never the ones who opted out.
    expect(cut.named.map((n) => n.organizationId)).not.toContain("h1");
  });
});

describe("what the aggregate counts", () => {
  it("includes an opted-out store in the median", () => {
    // Two disclosing at $1M, two opted out at $5M. Sorted that is
    // [1, 1, 5, 5] and the median is $3M. Drop the opted-out pair and the
    // median of what is left is $1M — so if withdrawal removed a store from the
    // arithmetic as well as the label, this number would be three times wrong.
    const rows = [
      row("me"),
      row("b"),
      row("h1", {
        disclosure_level: "aggregate_only",
        total_gross_sales_instore: 5_000_000,
      }),
      row("h2", {
        disclosure_level: "aggregate_only",
        total_gross_sales_instore: 5_000_000,
      }),
    ];
    const cut = buildCut({
      key: "type",
      label: "Institution type",
      bucket: "University",
      rows,
      nameById: names(["me", "b", "h1", "h2"]),
      viewerOrgId: "me",
    });

    const rev = cut.metrics.find((m) => m.key === "revenue")!;
    expect(rev.n).toBe(4);
    // Withdrawal governs attribution, never arithmetic.
    expect(rev.median).toBe(3_000_000);
    // And the two who opted out are still not named.
    expect(cut.named.map((n) => n.organizationId)).toEqual(["b"]);
  });
});

describe("reciprocity", () => {
  it("shows an opted-out reader the aggregate but no named peers", () => {
    const rows = [
      row("me", { disclosure_level: "aggregate_only" }),
      row("b"),
      row("c"),
      row("d"),
      row("e"),
    ];
    const cut = buildCut({
      key: "type",
      label: "Institution type",
      bucket: "University",
      rows,
      nameById: names(["me", "b", "c", "d", "e"]),
      viewerOrgId: "me",
    });

    expect(cut.showAggregate).toBe(true);
    expect(cut.named).toEqual([]);
    expect(cut.withheldForReciprocity).toBe(4);
  });
});

describe("the reader themselves", () => {
  it("never appears in their own peer list", () => {
    const rows = [row("me"), row("b"), row("c"), row("d")];
    const cut = buildCut({
      key: "type",
      label: "Institution type",
      bucket: "University",
      rows,
      nameById: names(["me", "b", "c", "d"]),
      viewerOrgId: "me",
    });
    expect(cut.named.map((n) => n.organizationId)).not.toContain("me");
    // But still counts toward the cut and the median.
    expect(cut.cutSize).toBe(4);
  });

  it("gets a standing against the median, not a rank", () => {
    const rows = [
      row("me", { total_gross_sales_instore: 3_000_000 }),
      row("b"),
      row("c"),
      row("d"),
    ];
    const cut = buildCut({
      key: "type",
      label: "Institution type",
      bucket: "University",
      rows,
      nameById: names(["me", "b", "c", "d"]),
      viewerOrgId: "me",
    });
    expect(cut.metrics.find((m) => m.key === "revenue")!.standing).toBe("above");
  });
});

describe("missing inputs", () => {
  it("excludes a store from a metric rather than counting it as zero", () => {
    const rows = [
      row("me"),
      row("b"),
      row("c"),
      row("d", { total_square_footage: null }),
    ];
    const cut = buildCut({
      key: "type",
      label: "Institution type",
      bucket: "University",
      rows,
      nameById: names(["me", "b", "c", "d"]),
      viewerOrgId: "me",
    });

    const perSqft = cut.metrics.find((m) => m.key === "revenue_per_sqft")!;
    // Three of four had the inputs. Counting the fourth as zero would drag the
    // median down and invent a store with infinite productivity.
    expect(perSqft.n).toBe(3);
    expect(cut.metrics.find((m) => m.key === "revenue")!.n).toBe(4);
  });
});


/**
 * One number everywhere.
 *
 * The FTE a store reports through benchmarking sets its dues for the year
 * ahead, so organizations.fte is that same answer plus any deliberate
 * correction — not a rival figure. Dividing by the raw answer while banding
 * and billing on the corrected one publishes a ratio that contradicts the
 * store's own invoice.
 */
describe("the FTE everything divides by", () => {
  it("prefers the org figure, which is the priced one", () => {
    expect(effectiveFte(12_000, 2_792)).toBe(12_000);
  });

  it("falls back to the survey answer when the org has none", () => {
    expect(effectiveFte(null, 2_792)).toBe(2_792);
    expect(effectiveFte(undefined, 2_792)).toBe(2_792);
  });

  it("is null when neither exists, so the ratio is withheld not guessed", () => {
    expect(effectiveFte(null, null)).toBeNull();
  });

  it("keeps a real zero rather than treating it as missing", () => {
    // A store can genuinely report 0. Coalescing it away would silently swap
    // in a different store's number.
    expect(effectiveFte(0, 2_792)).toBe(0);
  });

  it("undoes the Kwantlen outlier", () => {
    // Filed 2,792 FTE against a corrected 12,000 on $3,230,294 of revenue.
    // On the raw answer that is $1,157 per student against a $315 median --
    // an outlier invented entirely by the denominator.
    const revenue = 3_230_294;
    expect(Math.round(revenue / effectiveFte(null, 2_792)!)).toBe(1_157);
    expect(Math.round(revenue / effectiveFte(12_000, 2_792)!)).toBe(269);
  });
});
