/**
 * The shape of a stored edge, split out so both the server-only reader and the
 * pure view helpers can import it without either depending on the other.
 */

export interface StoredReason {
  kind: string;
  axis: string;
  text: string;
  evidence: string[];
  supports: boolean;
  /** Whose data this reason reveals. Null when it reveals nobody's in particular. */
  sourceOrgId: string | null;
  /** How that org has the governing section set. Consumers decide what to do with it. */
  sourceVisibility: "shown" | "hidden" | "unset";
}

export interface StoredEdge {
  candidateOrgId: string;
  /** Null when this is the org-level prior rather than a specific pairing. */
  subjectContactId: string | null;
  candidateContactId: string | null;
  /** `ranking` — fit discounted by coverage. Sort on this. */
  total: number;
  score: number;
  /** 0..1 — how much of the direction's weight had anything to say. */
  confidence: number;
  rank: number;
  /**
   * Per-axis values, 0..1 — category, certification, province, timing,
   * requirements, services, cohort, semantic, behavioural.
   *
   * ⛔ **null is not 0.** Null means the axis had nothing to say about this pair;
   * 0 means it looked and found no fit. A consumer that renders "why" must show
   * a null axis as *unknown*, never as a failing score — and a consumer that
   * re-weights must divide by the covered weight only, which is what
   * `confidence` already reports.
   *
   * ⚠️ Two axes are silent in every direction today: `semantic` (0 of 79 members
   * carry an `embedding`, so it cannot fire against a partner) and `behavioural`
   * (nothing writes it, and its weight is 0 everywhere). Absence there is a data
   * gap, not a verdict about the pair.
   */
  breakdown: Record<string, number | null>;
  reasons: StoredReason[];
}
