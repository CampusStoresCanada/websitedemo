/**
 * What may be said out loud.
 *
 * The rule, from the product owner: never "that person did a thing" — always
 * "you appeared in X searches, shown to N stores, delivered here". Aggregation
 * is the deliverable, and this module is the only sanctioned way to produce it.
 *
 * ⚠️ Aggregation alone is not anonymity in a community this size. There are 79
 * member stores and 122 partners. "Shown to 1 store" plus "they searched
 * Activewear" plus a directory filtered to Activewear buyers in Ontario is a
 * name. Small counts are therefore banded rather than reported, and the identity
 * of the orgs behind a count is never returned by anything here — not as a list,
 * not as a sample, not as a "top" anything.
 *
 * Nothing in this file takes a contact id. If a caller has one, it is in the
 * wrong layer.
 *
 * ── ⛔ This is a DISCLOSURE rule, not a knowledge rule ──────────────────────
 *
 * Do not read the cohort floor as a limit on what the system may know. It is a
 * formatter, applied at the moment of telling someone, and nowhere earlier.
 * Internally we retain everything at full fidelity — every event, every person,
 * undecayed and unbanded — because that is what eventually becomes a conference
 * match number, and a delegate↔exhibitor score computed off banded counts would
 * be a worse score for no privacy gain.
 *
 * The engine reads signal_events and the rollups directly. It never comes
 * through here. Only the sentence a human reads does.
 */

/**
 * Counts below this are banded instead of stated.
 *
 * Five is the conventional floor and it fits here: with 79 members, a count of
 * four is a small enough set to guess at from context, and a count of one is a
 * name. If reporting feels too coarse, the fix is more signal, not a lower floor.
 */
export const MIN_DISCLOSURE_COHORT = 5;

export interface BandedCount {
  /** The number, when it is safe to state. Null when banded. */
  exact: number | null;
  /** Always safe to render. */
  label: string;
  /** True when the real number was withheld. */
  banded: boolean;
}

/**
 * A count of distinct organizations or people, safe to show outward.
 *
 * Zero is stated plainly — "nobody" identifies no one, and hiding it would make
 * an empty result look like a suppressed one, which is worse than useless to
 * someone deciding whether their listing is working.
 */
export function bandCount(n: number, noun = "stores"): BandedCount {
  if (n <= 0) return { exact: 0, label: `no ${noun}`, banded: false };
  if (n < MIN_DISCLOSURE_COHORT) {
    return { exact: null, label: `fewer than ${MIN_DISCLOSURE_COHORT} ${noun}`, banded: true };
  }
  return { exact: n, label: `${n} ${noun}`, banded: false };
}

/** One org's impressions over a window, aggregated for that org to read. */
export interface ImpressionSummary {
  /** How many times this org was shown in a ranked list. Never banded — it is a total, not a cohort. */
  appearances: number;
  /** How many distinct orgs saw it. Banded. */
  distinctViewerOrgs: BandedCount;
  /** How many distinct people saw it. Banded. */
  distinctViewerPeople: BandedCount;
  /** Where it was shown, and how often. Surfaces are ours, not anyone's identity. */
  bySurface: { surface: string; appearances: number }[];
  /** Best rank achieved, and the median — "you appear, but at position 40" is the useful part. */
  bestRank: number | null;
  medianRank: number | null;
  /** Which terms it kept turning up for. The actionable half. */
  topContextTerms: { term: string; appearances: number }[];
}

/** The rows this module needs. Deliberately no contact ids — see the note above. */
export interface ImpressionRowForSummary {
  surface: string;
  subjectOrgId: string | null;
  viewerContactId: string | null;
  rank: number | null;
  contextTerms: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * "You appeared in 12 recommended searches this month, shown to 8 stores,
 * mostly for Activewear, usually around position 6."
 *
 * ⚠️ `viewerContactId` is consumed here and never emitted — it exists in the
 * argument only so distinct people can be counted. The return type has no field
 * that could carry it.
 */
export function summarizeImpressions(
  rows: readonly ImpressionRowForSummary[],
  options: { viewerNoun?: string; peopleNoun?: string; topTerms?: number } = {}
): ImpressionSummary {
  const viewerOrgs = new Set<string>();
  const viewerPeople = new Set<string>();
  const surfaceCounts = new Map<string, number>();
  const termCounts = new Map<string, number>();
  const ranks: number[] = [];

  for (const row of rows) {
    if (row.subjectOrgId) viewerOrgs.add(row.subjectOrgId);
    if (row.viewerContactId) viewerPeople.add(row.viewerContactId);
    surfaceCounts.set(row.surface, (surfaceCounts.get(row.surface) ?? 0) + 1);
    for (const term of row.contextTerms) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }
    if (typeof row.rank === "number") ranks.push(row.rank);
  }

  return {
    appearances: rows.length,
    distinctViewerOrgs: bandCount(viewerOrgs.size, options.viewerNoun ?? "stores"),
    distinctViewerPeople: bandCount(viewerPeople.size, options.peopleNoun ?? "people"),
    bySurface: [...surfaceCounts.entries()]
      .map(([surface, appearances]) => ({ surface, appearances }))
      .sort((a, b) => b.appearances - a.appearances),
    bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
    medianRank: median(ranks),
    topContextTerms: [...termCounts.entries()]
      .map(([term, appearances]) => ({ term, appearances }))
      .sort((a, b) => b.appearances - a.appearances)
      .slice(0, options.topTerms ?? 5),
  };
}

/**
 * A sentence for the org being reported on.
 *
 * Written for the listing's owner, which is why it leads with appearances and
 * follows with rank: "you showed up a lot at position 40" and "you showed up
 * twice at position 1" are opposite problems, and a bare count hides which.
 */
export function describeImpressions(summary: ImpressionSummary): string {
  if (summary.appearances === 0) {
    return "You have not appeared in any recommendations in this period.";
  }

  const parts = [
    `Appeared in ${summary.appearances} recommendation${summary.appearances === 1 ? "" : "s"}`,
    `shown to ${summary.distinctViewerOrgs.label}`,
  ];

  if (summary.medianRank !== null) {
    parts.push(`usually around position ${Math.round(summary.medianRank)}`);
  }
  if (summary.topContextTerms.length > 0) {
    parts.push(`most often for ${summary.topContextTerms.map((t) => t.term).join(", ")}`);
  }

  return `${parts.join(", ")}.`;
}
