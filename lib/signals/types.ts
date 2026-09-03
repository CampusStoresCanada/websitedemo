/**
 * Behavioural signal — types.
 *
 * A signal is one act: someone searched "hoodie", joined the Course Materials
 * space, opened a partner profile, clicked through to a catalogue. Every
 * producer writes this one shape, so adding a source is a resolver change
 * rather than a schema change.
 *
 * Behaviour does not replace what people declared. `chosen` (procurement_info),
 * `revealed` (this layer) and `guess` (machine-proposed) are three kinds of
 * evidence for the same field, and they add rather than compete: a store that
 * ticked Activewear AND keeps searching for it is a stronger match than either
 * fact alone. Revealed preference wins on *recency*, not on standing.
 *
 * ⚠️ `actorContactId` is captured and NEVER exposed. Rollups are org-grained and
 * carry no contact column at all — the boundary is structural. See the migration
 * `20260831200000_signal_spine.sql` for why it is built that way rather than
 * left to a code review.
 */

export type SignalSource = "website" | "circle" | "email" | "conference" | "print";

/**
 * Implicit acts are things people did while going about their business; explicit
 * acts are deliberate statements of preference.
 *
 * ⚠️ They must never be averaged into one number. A meeting that merely got
 * scheduled is implicit. A blackout declaration, or a swap with a typed reason,
 * is explicit and enormously stronger — blending them lets a hundred idle page
 * views drown out someone saying "never again".
 */
export type SignalStance = "implicit" | "explicit";

/** Whether the act argues toward the object or away from it. */
export type SignalPolarity = "positive" | "negative";

export type SignalVerb =
  // ── Explicit preference, mostly emitted by the conference module ──────────
  /** A declared refusal to meet. The highest-information negative signal there is. */
  | "refused"
  /** An explicit positive pick — a top-5 preference. */
  | "preferred"
  /** Chose this one when offered alternatives. */
  | "selected"
  /** Was shown this one and passed it over. */
  | "rejected"
  // ── Implicit behaviour ───────────────────────────────────────────────────
  | "searched"
  | "filtered"
  | "viewed"
  | "clicked"
  | "posted"
  | "commented"
  | "joined"
  | "rsvped"
  | "attended"
  | "opened"
  | "scanned";

export type SignalObjectType =
  | "query"
  | "org"
  | "space"
  | "post"
  | "event"
  | "category"
  | "certification"
  | "listing";

/**
 * How a taxonomy term was arrived at. Carried all the way through to the match
 * reason, so an inference never presents as a declaration.
 */
export type TermSource =
  /** The text WAS a taxonomy term. */
  | "exact"
  /** Mapped through the hand-written synonym list — "hoodie" → Apparel, Activewear. */
  | "synonym"
  /** Implied by a Circle space named for a category. */
  | "space"
  /** An explicit click on a category control. */
  | "category"
  /** Nearest term by embedding. Weakest; always a guess. */
  | "semantic";

export interface SignalEvent {
  occurredAt: Date;
  source: SignalSource;
  verb: SignalVerb;
  actorOrgId: string | null;
  /** ⚠️ Never read by a product surface. Present only so distinct-person counts work. */
  actorContactId: string | null;
  stance: SignalStance;
  polarity: SignalPolarity;
  objectType: SignalObjectType | null;
  /** Set when the object IS an org — this is what makes an affinity edge. */
  objectOrgId: string | null;
  objectRef: string | null;
  rawText: string | null;
  /**
   * Resolved NACS terms, canonical casing.
   *
   * ⚠️ Legitimately EMPTY much of the time. The taxonomy names ~13 departments
   * and ~60 classes; people search for things it has never heard of. An event
   * with no terms but with `rawText` is retained on purpose — it is the latent
   * half of the signal, and the half the taxonomy is worst at.
   */
  terms: string[];
  termSource: TermSource | null;
  /**
   * Which vocabulary produced `terms`.
   *
   * ⚠️ The world does not hold still: synonyms get added, the taxonomy gains a
   * class, a legacy value gets remapped. Without this you cannot distinguish an
   * event that truly means nothing from one that was read by a worse reader, and
   * re-resolution becomes archaeology instead of a nightly pass.
   */
  resolverVersion: string | null;
  weight: number;
  /** Makes backfill idempotent — re-syncing Circle must not double-count 870 posts. */
  dedupeKey: string | null;
}

/** One org's decayed pull toward one taxonomy term. */
export interface TermRollup {
  organizationId: string;
  /**
   * The person, when we know which one.
   *
   * ⛔ Part of the key. An earlier version rolled up to org only, which flattened
   * exactly the resolution this system exists to reach — Zach owns course
   * materials and Karin owns apparel, and "McMaster buys both" is the wrong
   * answer to "who should Zach meet". Circle events, badge scans and searches
   * are all acts by a PERSON; aggregating them before storing throws that away
   * at the one stage it cannot be recovered from.
   *
   * Null is normal and fine: anonymous acts, and acts by someone not linked to a
   * contact, still roll up at org level.
   */
  contactId: string | null;
  term: string;
  termSource: TermSource;
  /** ⚠️ Part of the key. Explicit and implicit never share a bucket. */
  stance: SignalStance;
  polarity: SignalPolarity;
  weight: number;
  eventCount: number;
  /** A count, never an identity. */
  actorCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

/** One org's decayed pull toward another org. */
export interface AffinityRollup {
  organizationId: string;
  /** The person who acted, when known. Part of the key — see TermRollup.contactId. */
  contactId: string | null;
  objectOrgId: string;
  /**
   * ⚠️ Part of the key. An org can browse a vendor often AND have refused them —
   * a stale grudge, or checking up on someone. That is two facts, not a
   * contradiction to be netted off into one number.
   */
  stance: SignalStance;
  polarity: SignalPolarity;
  weight: number;
  eventCount: number;
  actorCount: number;
  lastSeenAt: Date | null;
}

export interface RecommendationImpression {
  matchRunId: string | null;
  surface: string;
  direction: string | null;
  subjectOrgId: string | null;
  candidateOrgId: string;
  /** ⚠️ Never exposed. Enables "shown to 8 stores" without naming anyone. */
  viewerContactId: string | null;
  rank: number | null;
  score: number | null;
  /**
   * The terms in play when this was shown.
   *
   * Without them you learn "Login was picked once"; with them you learn "Login
   * is right for notebooks". This is the join key that lets feedback generalise,
   * and it is expensive to add later.
   */
  contextTerms: string[];
  shownAt: Date;
}
