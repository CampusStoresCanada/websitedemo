/**
 * Interpreting a stored edge for display.
 *
 * Pure, and deliberately NOT in `read.ts`: that module is `server-only` because
 * it touches the database, which is a protection worth keeping — but it also
 * makes anything inside it untestable. These are the parts worth testing, so
 * they live where a test can reach them.
 */

import type { StoredEdge, StoredReason } from "./read-types";

/**
 * The three-bucket confidence the existing panels render.
 *
 * ⚠️ Derived from `total`, which already discounts by coverage — so a pair that
 * matched on one axis and was silent on every other cannot present as "high"
 * merely because that one axis was perfect. The old 0–3 scale could.
 */
export function confidenceBucket(total: number): "high" | "medium" | "low" {
  if (total >= 45) return "high";
  if (total >= 25) return "medium";
  return "low";
}

/**
 * The category the match was made on, recovered from its reason.
 *
 * The old matchers returned `matchingCategory` / `matchingSubcategories` because
 * they had them to hand mid-loop. The engine carries the same facts as evidence
 * on the category reason, so the panels keep their contract without the scoring
 * being duplicated to produce it.
 */
export function categoryEvidence(reasons: readonly StoredReason[]): {
  category: string;
  subcategories: string[];
} {
  const category = reasons.find((r) => r.axis === "category" && r.supports);
  if (!category) return { category: "", subcategories: [] };
  return { category: category.evidence[0] ?? "", subcategories: [...category.evidence] };
}

/** Did the certification axis actually fire for this pair? */
export function hasCertificationMatch(edge: StoredEdge): boolean {
  const value = edge.breakdown.certification;
  return typeof value === "number" && value > 0;
}


/**
 * The common filter, offered as a convenience.
 *
 * ⛔ NOT a gate, and not the engine's opinion. `match_edges` stores every reason
 * with its provenance precisely so each surface can answer "who is reading
 * this?" for itself — an ops dashboard shows everything, a member sees their own
 * hidden answers, a partner-facing panel does not, and the print directory has
 * its own rule again. None of that is knowable from inside a scorer.
 *
 * This helper implements only the most common of those: show a reason unless it
 * reveals another org's deliberately hidden section. Surfaces with a different
 * answer should read `sourceOrgId` / `sourceVisibility` directly rather than
 * bending this.
 */
export function reasonsVisibleTo(
  reasons: readonly StoredReason[],
  readerOrgId: string | null
): StoredReason[] {
  return reasons.filter((r) => {
    if (r.sourceVisibility !== "hidden") return true;
    // Your own hidden answers are still yours to see. Hiding is directional: it
    // conceals from others, never from the person who set it.
    return !!r.sourceOrgId && r.sourceOrgId === readerOrgId;
  });
}


/** One surface-level adjustment, and why it was applied. */
export interface AppliedBoost {
  /** Rendered to the reader — "New Partner", "Exhibiting", whatever the rule is. */
  label: string;
  /** Multiplier on `total`. 1.15 is a nudge; 2.0 is a thumb on the scale. */
  multiplier: number;
}

export interface BoostedEdge {
  edge: StoredEdge;
  /** ⛔ The engine's fit score, untouched. Always available for comparison. */
  total: number;
  /** After surface boosts. Sort on this when promoting; never store it as fit. */
  promoted: number;
  boosts: AppliedBoost[];
}

/**
 * Apply promotional weighting on top of a match, without corrupting it.
 *
 * ⛔ Boosts belong HERE, not in the score. The 90-day new-partner spotlight is a
 * business decision — CSC wants new partners to get early visibility — and it is
 * not evidence that they fit anyone. Folded into `total` it becomes impossible to
 * ever ask "did they rank because they match, or because we promoted them", which
 * is the question you need when judging whether the engine works at all.
 *
 * It is also time-bounded, and a run is a snapshot: baked in, day 89 and day 91
 * produce different stored scores for reasons that have nothing to do with fit.
 * And the spotlight carries an **exclusion list** (lib/membership/new-partner-
 * spotlight.ts), which is policy the scorer should not have to know — that file
 * applies it in one place so an opt-out cannot leak through one surface and not
 * another. Ask it, here, rather than teaching the engine a second copy.
 *
 * Both numbers come back so a surface can rank by `promoted` and still say why:
 * "Merangue — New Partner", rather than silently reordering.
 *
 *   const map = await getSpotlightMap();
 *   const ranked = applyBoosts(edges, (e) =>
 *     map.has(e.candidateOrgId) ? [{ label: "New Partner", multiplier: 1.25 }] : []
 *   );
 */
export function applyBoosts(
  edges: readonly StoredEdge[],
  boostsFor: (edge: StoredEdge) => AppliedBoost[]
): BoostedEdge[] {
  return edges
    .map((edge) => {
      const boosts = boostsFor(edge);
      const multiplier = boosts.reduce((acc, b) => acc * b.multiplier, 1);
      return { edge, total: edge.total, promoted: edge.total * multiplier, boosts };
    })
    .sort((a, b) => b.promoted - a.promoted);
}
