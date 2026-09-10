import { describe, expect, it } from "vitest";
import { confidenceBucket, categoryEvidence, hasCertificationMatch, applyBoosts } from "../edge-view";
import type { StoredEdge, StoredReason } from "../read-types";

const reason = (over: Partial<StoredReason> = {}): StoredReason => ({
  kind: "chosen", axis: "category", text: "", evidence: [], supports: true,
  sourceOrgId: null, sourceVisibility: "unset", ...over,
});

const edge = (over: Partial<StoredEdge> = {}): StoredEdge => ({
  candidateOrgId: "p", subjectContactId: null, candidateContactId: null, total: 50, score: 60, confidence: 0.8, rank: 1,
  breakdown: {}, reasons: [], ...over,
});

describe("confidence buckets", () => {
  it("reads from total, so coverage is already priced in", () => {
    // The old 0–3 scale let a single perfect axis present as "high". `total`
    // discounts by how much we actually know, so it cannot.
    expect(confidenceBucket(80)).toBe("high");
    expect(confidenceBucket(60)).toBe("medium");
    expect(confidenceBucket(10)).toBe("low");
  });

  it("⛔ cuts at percentiles, because total IS a percentile", () => {
    // calibrate() maps each pair to its rank position in the run, so a threshold
    // only means something if it is itself a percentile. The old 45/25 cut was
    // fitted to one run's shape — exactly what calibrate() exists to avoid — and
    // on live run 98a59853 it called 70.9% of every member's list "high".
    expect(confidenceBucket(75)).toBe("high"); // top quarter of the run
    expect(confidenceBucket(74.9)).toBe("medium");
    expect(confidenceBucket(50)).toBe("medium"); // above the run's median
    expect(confidenceBucket(49.9)).toBe("low");
  });

  it("⚠️ a mid-40s pair is NOT strong — the regression this replaces", () => {
    // 45 was the old "high" cut. It is below the run's median, so it described
    // the denser side of the corpus rather than a good match.
    expect(confidenceBucket(45)).toBe("low");
  });

  it("holds at the ends", () => {
    expect(confidenceBucket(100)).toBe("high");
    expect(confidenceBucket(0)).toBe("low");
  });
});

describe("category evidence", () => {
  it("recovers the matched category from the reason the engine already wrote", () => {
    const { category, subcategories } = categoryEvidence([
      reason({ evidence: ["Activewear", "Headwear"] }),
    ]);
    expect(category).toBe("Activewear");
    expect(subcategories).toEqual(["Activewear", "Headwear"]);
  });

  it("ignores a reason that explains a gap rather than supporting the match", () => {
    // "Holds none of the certifications you look for" is a category-axis-adjacent
    // reason with supports:false; treating it as evidence would label the match
    // with the thing it failed on.
    expect(categoryEvidence([reason({ supports: false, evidence: ["Apparel"] })]).category).toBe("");
  });

  it("returns empty rather than throwing when the match had no category reason", () => {
    expect(categoryEvidence([])).toEqual({ category: "", subcategories: [] });
    expect(categoryEvidence([reason({ axis: "province", evidence: ["Ontario"] })]).category).toBe("");
  });
});

describe("certification match", () => {
  it("is true only when the axis actually fired", () => {
    expect(hasCertificationMatch(edge({ breakdown: { certification: 0.5 } }))).toBe(true);
    // Scored zero: they asked, nobody qualified. Not a match.
    expect(hasCertificationMatch(edge({ breakdown: { certification: 0 } }))).toBe(false);
    // Silent: nobody asked. Also not a match, and must not read as one.
    expect(hasCertificationMatch(edge({ breakdown: { certification: null } }))).toBe(false);
    expect(hasCertificationMatch(edge({ breakdown: {} }))).toBe(false);
  });
});

describe("promotional boosts sit on top, never inside", () => {
  const edges = [
    edge({ candidateOrgId: "established", total: 50 }),
    edge({ candidateOrgId: "newcomer", total: 40 }),
  ];

  it("keeps the fit score intact while reordering", () => {
    const ranked = applyBoosts(edges, (e) =>
      e.candidateOrgId === "newcomer" ? [{ label: "New Partner", multiplier: 1.5 }] : []
    );

    expect(ranked[0].edge.candidateOrgId).toBe("newcomer");
    // ⛔ The engine's number is still there, unmodified — otherwise you could
    // never ask "did they rank because they match, or because we promoted them".
    expect(ranked[0].total).toBe(40);
    expect(ranked[0].promoted).toBe(60);
    expect(ranked[1].total).toBe(50);
  });

  it("says why, so a surface can show its work", () => {
    const ranked = applyBoosts(edges, (e) =>
      e.candidateOrgId === "newcomer" ? [{ label: "New Partner", multiplier: 1.5 }] : []
    );
    expect(ranked[0].boosts.map((b) => b.label)).toEqual(["New Partner"]);
    // An unboosted row carries no explanation, because none is owed.
    expect(ranked[1].boosts).toEqual([]);
  });

  it("changes nothing when no rule applies", () => {
    const ranked = applyBoosts(edges, () => []);
    expect(ranked.map((r) => r.edge.candidateOrgId)).toEqual(["established", "newcomer"]);
    expect(ranked.every((r) => r.promoted === r.total)).toBe(true);
  });
});
