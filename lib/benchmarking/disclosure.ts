/**
 * Who may be named in a peer comparison, and when a cut must be withheld.
 *
 * `disclosure_level` on its own is not protection. A store that opts out of
 * being named is still identifiable by arithmetic the moment a peer cut names
 * everyone else and publishes a total: three XLarge Quebec stores, two named,
 * and the third is a subtraction. The launch plan calls this out as the reason
 * a minimum-n suppression rule has to exist on every cut, or the opt-out
 * protects nobody.
 *
 * So there are two independent gates here, and a cut has to clear both:
 *
 *   1. MIN_CUT_SIZE — a cut too small to hide anyone is not published at all,
 *      regardless of what anyone chose. This protects the `full` stores too:
 *      "the median of the two of you" is not an aggregate, it is a disclosure.
 *
 *   2. The residual rule — if naming the disclosing stores would leave exactly
 *      one store unnamed, that store's figures are derivable from the total.
 *      Either nobody is hidden, or at least two are.
 *
 * ⚠️ The NUMBER is a governance decision, not an engineering one. Four is a
 * defensible floor and is what this ships with; the board may want higher for
 * financial cuts. Change MIN_CUT_SIZE, not the call sites.
 */

export type DisclosureLevel = "full" | "aggregate_only";

/**
 * Smallest cut that may be published at all.
 *
 * Four, not five: with 52 member stores split by size band and region, five
 * suppresses cuts that members will reasonably expect to see, and a report that
 * withholds everything teaches people the tool is broken rather than careful.
 * Revisit against the 2026 distribution once it exists.
 */
export const MIN_CUT_SIZE = 4;

/**
 * Fewest stores that may sit behind an aggregate unnamed.
 *
 * One is the dangerous number: a single unnamed store in an otherwise-named cut
 * is not anonymous, it is a subtraction.
 */
export const MIN_RESIDUAL = 2;

export interface CutMember {
  organizationId: string;
  organizationName: string;
  disclosureLevel: DisclosureLevel;
}

export type SuppressionReason =
  | "below_min_cut_size"
  | "residual_identifiable";

export interface CutView {
  /** May the aggregate (median, count, distribution) be shown at all? */
  showAggregate: boolean;
  suppressedReason?: SuppressionReason;
  /** Stores this viewer may see named. Never includes an aggregate_only store. */
  named: CutMember[];
  /**
   * Everyone whose figures feed the aggregate — including the opted-out.
   * Withdrawal governs attribution, never whether the numbers count (the consent seal).
   */
  contributing: CutMember[];
  /** Named rows withheld from THIS viewer because they do not reciprocate. */
  withheldForReciprocity: number;
}

/**
 * What one viewer may see of one peer cut.
 *
 * `viewerDisclosure` is the viewer's OWN level. A store that will not be named
 * does not receive named peers — that is the reciprocity the plan describes,
 * and it is the whole reason aggregate-only is a choice rather than a free
 * option everyone would take.
 */
export function resolveCut(input: {
  members: CutMember[];
  viewerDisclosure: DisclosureLevel;
  minCutSize?: number;
}): CutView {
  const { members, viewerDisclosure, minCutSize = MIN_CUT_SIZE } = input;

  // Everyone counts toward the aggregate, always.
  const contributing = members;
  const hidden = members.filter((m) => m.disclosureLevel === "aggregate_only");
  const disclosing = members.filter((m) => m.disclosureLevel === "full");

  // Gate 1: a cut too small to hide anyone in.
  if (members.length < minCutSize) {
    return {
      showAggregate: false,
      suppressedReason: "below_min_cut_size",
      named: [],
      contributing,
      withheldForReciprocity: 0,
    };
  }

  // Gate 2: exactly one store unnamed is not anonymous, it is arithmetic.
  // Naming nobody is safe; naming everyone is safe; leaving one out is not.
  if (hidden.length > 0 && hidden.length < MIN_RESIDUAL) {
    return {
      showAggregate: true,
      suppressedReason: "residual_identifiable",
      named: [],
      contributing,
      withheldForReciprocity: disclosing.length,
    };
  }

  // Reciprocity: no named peers for a store that will not be named itself.
  if (viewerDisclosure === "aggregate_only") {
    return {
      showAggregate: true,
      named: [],
      contributing,
      withheldForReciprocity: disclosing.length,
    };
  }

  return {
    showAggregate: true,
    named: disclosing,
    contributing,
    withheldForReciprocity: 0,
  };
}

/**
 * Plain-language explanation of why a cut is thin, for the reader looking at
 * the gap. Silence here reads as a bug; the reason reads as care.
 */
export function explainSuppression(view: CutView): string | null {
  switch (view.suppressedReason) {
    case "below_min_cut_size":
      return `Too few stores in this group to show without identifying them. Needs at least ${MIN_CUT_SIZE}.`;
    case "residual_identifiable":
      return "Naming the stores in this group would make the remaining one identifiable by subtraction, so none are named. The totals still include every store.";
    default:
      return null;
  }
}

/** Copy for the store choosing. Not a penalty tier — say so plainly. */
export const DISCLOSURE_COPY: Record<
  DisclosureLevel,
  { label: string; blurb: string }
> = {
  full: {
    label: "Show my store by name to other members",
    blurb:
      "Your figures appear as a named row in peer comparisons, and you see other stores the same way. This is what most stores choose and what makes the report useful.",
  },
  aggregate_only: {
    label: "Include my figures, but never name my store",
    blurb:
      "Your numbers count toward every median, count and distribution, but your store is never shown as a named row. In return you see the aggregates rather than named peers — granular detail works by reciprocity. You can change this at any time while the survey is open.",
  },
};
