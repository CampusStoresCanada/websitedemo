/**
 * Unified match engine — core types.
 *
 * One affinity model for member↔partner, member↔member and partner↔partner.
 * See planning/unified-match-engine.md for the design and the measured baseline.
 *
 * Two ideas carry most of the weight here:
 *
 *  1. A feature that has NO DATA returns `null`, never 0. Only 13 of 81 members
 *     have filled in procurement_info. If absence scored zero, the ranking would
 *     mostly measure how complete a profile is rather than how well two orgs fit,
 *     and every incomplete member would sink regardless of merit. Weights are
 *     renormalised over the axes that actually spoke — see `scorePair`.
 *
 *  2. Because of (1), one number is not enough. `score` says how good the fit is
 *     over what we know; `confidence` says how much of the direction's weight had
 *     anything to say. A perfect single-axis match is 100/0.2, not 100 — and the
 *     UI must be able to tell those apart.
 */

import type { ProcurementVisibility } from "@/lib/types/procurement";
import type { ScaleRange } from "@/lib/explore/types";
import type { TermSource } from "@/lib/signals/types";

/**
 * Directions are NOT symmetric — they ask different questions of the same pair.
 * "Who can supply me" weights the buyer's stated requirements; "who could buy
 * from me" weights when that buyer is next in market.
 */
export type MatchDirection =
  | "member_to_partner"
  | "partner_to_member"
  | "member_to_member"
  | "partner_to_partner";

export type MatchAxis =
  | "category"
  | "certification"
  | "province"
  | "timing"
  | "requirements"
  | "services"
  | "cohort"
  | "semantic"
  | "behavioural";

export const MATCH_AXES: readonly MatchAxis[] = [
  "category",
  "certification",
  "province",
  "timing",
  "requirements",
  "services",
  "cohort",
  "semantic",
  "behavioural",
] as const;

/**
 * How strong a claim a reason is making. `lib/explore` established the rule and
 * it holds here: a name is a fact, a category is what someone chose, a synonym
 * landing on that category is our inference on top of theirs. Two guesses shown
 * as an answer is how a directory loses trust.
 */
/**
 * Which categories one person is personally responsible for buying.
 *
 * ⛔ This is the resolution `buildMatchProfile` used to destroy. It read
 * `contact_subcategories` — a map of contact id → the classes that person owns —
 * and `Object.values()`'d the ids away, leaving "this org buys Books and
 * Apparel". That is the wrong answer to "who should Zach meet", and no later
 * stage can recover it.
 *
 * Live shape it comes from: one person can own several departments, and several
 * people can share one. Algonquin has a single person across Accessories and
 * Apparel, and three sharing Books.
 */
export interface CategoryOwnership {
  contactId: string;
  /** Departments this person is named on. */
  departments: string[];
  /** Classes, where they were specified. Usually more precise than the org's union. */
  classes: string[];
}

/**
 * What an org has revealed an interest in by what it did, as opposed to what it
 * ticked in a form.
 *
 * ⚠️ `weight` is normalised 0..1 against that org's OWN strongest term. Absolute
 * weights are not comparable between orgs — a fifteen-person store out-browses a
 * two-person shop at everything, and ranking on raw totals would rank by
 * headcount.
 */
export interface RevealedTerm {
  term: string;
  /** 0..1, relative to this org's strongest revealed term. */
  weight: number;
  /** How the term was arrived at — `category` (they clicked it) down to `semantic`. */
  source: TermSource;
  /** Distinct people behind it. A count, never an identity. */
  actorCount: number;
}

/** Observed pull between two orgs — profile views, catalogue clicks, badge scans. */
export interface RevealedAffinity {
  orgId: string;
  /** 0..1, normalised against this org's strongest affinity. */
  weight: number;
  stance: "implicit" | "explicit";
  polarity: "positive" | "negative";
  actorCount: number;
}

export type ReasonKind =
  /** Both sides picked the same value from a controlled vocabulary. Strongest. */
  | "chosen"
  /** One side wrote it in free text. */
  | "stated"
  /** Computed from records we hold — cohort, tenure, distance. */
  | "derived"
  /** Embedding proximity. */
  | "semantic"
  /** Observed from real events. */
  | "behavioural"
  /** Machine-proposed and unconfirmed by anyone. Weakest; must always look like a guess. */
  | "guess";

export interface MatchReason {
  kind: ReasonKind;
  axis: MatchAxis;
  /** Human sentence, written from the subject's point of view. */
  text: string;
  /** The specific values that fired, so a reason can be audited. */
  evidence: string[];
  /**
   * Does this reason argue FOR the match?
   *
   * A gap is worth explaining — "holds none of the certifications you look for"
   * belongs on a profile — but it must never sort above the reasons that
   * actually earned the rank. Ordering by claim strength alone put every
   * negative first, because a stated absence is just as `chosen` as a match.
   */
  supports: boolean;

  /**
   * Whose data this reason discloses, and how that org has it set.
   *
   * ⛔ This engine has NO OPINION on who may see what. It takes signal and
   * produces a score; the rules about audiences live elsewhere, in places it
   * cannot know about — an ops dashboard, the print directory, a conference
   * organiser, a report. An earlier version stored a `citable` boolean, which
   * baked in one audience model (that the subject of the edge is the reader)
   * into permanent data and was simply wrong for every other reader.
   *
   * So: record the FACTS a consumer needs, and let it decide.
   *   `sourceOrgId`      — whose information this sentence reveals
   *   `sourceVisibility` — what that org set for the section it came from
   *
   * `reasonsVisibleTo()` in edge-view.ts is offered as a convenience for the
   * common case. It is a helper, never a gate.
   */
  sourceOrgId: string | null;
  sourceVisibility: ReasonVisibility;
}

/**
 * How the owning org has the relevant `show_*` section set.
 *
 * `unset` is kept distinct from `shown` on purpose — "never answered" and
 * "deliberately made visible" are different facts, and a consumer may reasonably
 * treat them differently.
 */
export type ReasonVisibility = "shown" | "hidden" | "unset";

export interface FeatureResult {
  axis: MatchAxis;
  /** 0..1, or null when neither side has data for this axis — absence is not a zero. */
  value: number | null;
  reasons: MatchReason[];
}

/** Normalised buying cycle — free-text seasons resolved to month numbers. */
export interface NormalizedBuyingCycle {
  /** 1–12, or null if unparsed. */
  fiscalYearStartMonth: number | null;
  /** Inclusive month range from `rfp_window`, wrapping over year end (e.g. Nov–Feb). */
  rfpWindow: { startMonth: number; endMonth: number } | null;
  /** Recurring or one-off dated milestones, ISO "YYYY-MM-DD". */
  keyDates: { title: string; date: string; recurring: boolean }[];
  /** Free-text notes — kept for the semantic and requirements axes. */
  notes: string;
}

/**
 * Everything the engine needs about one org, normalised away from the storage
 * shape. Built by `buildMatchProfile`; the feature functions never touch a raw
 * row, which is what keeps them pure and testable.
 */
export interface MatchProfile {
  id: string;
  type: "member" | "partner";
  name: string;

  // ── Taxonomy (NACS) ────────────────────────────────────────────────────────
  /** Parsed via parseOrgCategories — a class implies its department. */
  departments: string[];
  classes: string[];

  // ── Certifications ─────────────────────────────────────────────────────────
  /** What this org HOLDS — partner side (`organizations.certifications`). */
  certificationsHeld: string[];
  /** What this org WANTS — member side (`procurement_info.preferred_certifications`). */
  certificationsWanted: string[];
  isCancoll: boolean;

  // ── Geography ──────────────────────────────────────────────────────────────
  province: string | null;
  /** Member side — provinces they prefer or are required to source from. */
  sourcingProvinces: string[];

  // ── Timing ─────────────────────────────────────────────────────────────────
  buyingCycle: NormalizedBuyingCycle | null;

  // ── Free text ──────────────────────────────────────────────────────────────
  /** `procurement_info.requirements_notes` — buy-local rules, supplier codes, insurance minimums. */
  requirementsNotes: string | null;
  /** `company_description` or `website_summary`, whichever exists. */
  descriptionText: string | null;

  // ── Services ───────────────────────────────────────────────────────────────
  /** `procurement_info.store_services` — what the store runs in-house. */
  storeServices: string[];

  // ── Cohort ─────────────────────────────────────────────────────────────────
  fte: number | null;
  scaleRange: ScaleRange | null;
  institutionType: string | null;

  // ── Visibility ─────────────────────────────────────────────────────────────
  /** Governs reason citability, never scoring. Absent flags default to visible. */
  visibility: ProcurementVisibility;

  /**
   * Who buys what here, per person.
   *
   * ⚠️ The org's own `departments`/`classes` remain the union of these plus
   * anything declared at org level — the org question is unchanged. This is the
   * detail underneath it, kept because it cannot be reconstructed.
   */
  buyers: CategoryOwnership[];

  // ── Revealed behaviour ─────────────────────────────────────────────────────
  /**
   * What this org went looking for.
   *
   * ⚠️ ADDS to `departments`/`classes`, never replaces them. A store that ticked
   * Activewear AND keeps searching for it is a stronger match than either fact
   * alone; revealed preference wins on RECENCY, not on standing.
   *
   * Often more precise than what was chosen — members picked departments, but
   * they search for classes — which is exactly where this earns its place.
   */
  revealedTerms: RevealedTerm[];
  /** Observed pull toward specific orgs. Feeds the behavioural axis. */
  revealedAffinities: RevealedAffinity[];

  // ── Vector ─────────────────────────────────────────────────────────────────
  embedding: number[] | null;
  /**
   * ⚠️ Two vectors are only comparable when this matches. Voyage and local
   * models occupy different spaces; a cosine across them is noise that looks
   * like a number. `semanticFeature` refuses the pair rather than trusting it.
   */
  embeddingModel: string | null;
}

/** Per-axis weights for one direction. Stored as policy data, snapshotted per run. */
export type DirectionWeights = Record<MatchAxis, number>;

export interface MatchWeights {
  member_to_partner: DirectionWeights;
  partner_to_member: DirectionWeights;
  member_to_member: DirectionWeights;
  partner_to_partner: DirectionWeights;
  /**
   * How much a thin profile is discounted when ranking.
   * `ranking = score × (confidenceFloor + (1 − confidenceFloor) × confidence)`.
   * At 1.0 confidence is ignored; at 0 a single-axis match ranks near zero.
   */
  confidenceFloor: number;
}

export interface PairScore {
  direction: MatchDirection;
  subjectId: string;
  candidateId: string;
  /** 0..100 — quality of fit across the axes that had data. */
  score: number;
  /** 0..1 — share of the direction's weight that had anything to say. */
  confidence: number;
  /** The single number to sort by; blends score and confidence per `confidenceFloor`. */
  ranking: number;
  /** Per-axis 0..1 values; null where the axis was silent. */
  breakdown: Record<MatchAxis, number | null>;
  reasons: MatchReason[];
  /**
   * This is not a scorable pair — an org against itself, or types that do not
   * fit the direction.
   *
   * ⛔ NEVER an enforcement signal, and never a relationship judgement. A
   * refusal ("they failed to deliver fourteen years ago") is a human fact that
   * no algorithm can infer and that must not be delegated to one. Consumers
   * filter on the declared refusal itself, before and independently of any
   * score — see `org_meeting_refusals`. A score may never be the reason two
   * orgs meet, and never the reason they don't.
   */
  notScorable: boolean;
  notScorableReason?: "self" | "direction_type_mismatch";
}
