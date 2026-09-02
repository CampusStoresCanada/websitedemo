/**
 * The ingestion contract.
 *
 * Scores are disposable — 210 orgs and ~42k edges recompute in milliseconds, so
 * every weight, half-life and formula in this system can be changed nightly and
 * re-derived from scratch. The event log is NOT disposable: you cannot go back
 * and re-observe an act. That asymmetry is why the shape of an event is the
 * thing worth arguing about, and the shape of a score is not.
 *
 * ── The rule that prevents most damage ──────────────────────────────────────
 *
 * STORE THE ACT, NEVER THE INTERPRETATION.
 *
 * "Algonquin: Apparel affinity 0.7" is a conclusion, and you can never unbake
 * it. "Someone at Algonquin searched 'hoodie' at 14:32" is an observation, and
 * it can be re-resolved forever — when the synonym list grows, when the taxonomy
 * shifts, when searches are decided to decay faster. `rawText` exists for
 * exactly this and producers must always populate it.
 *
 * ── ⛔ Never ingest an act the engine caused ────────────────────────────────
 *
 * A meeting the solver created is not evidence of affinity — it is evidence of
 * the solver. Feed it back and the score rises because the score was high, and
 * within a couple of cycles the engine is measuring its own echo with no way to
 * distinguish it from signal. The numbers look excellent the entire time.
 *
 * The line, which is what the two tables are for:
 *
 *   recommendation_impressions  what WE did — ranked it, scheduled it, showed it
 *   signal_events               what a PERSON did — kept it, swapped it, typed a reason
 *
 * A scheduled meeting is not a signal. A meeting someone declined to swap out
 * of is. `validateSignalEvent` rejects the first kind.
 *
 * ── Adding a source ─────────────────────────────────────────────────────────
 *
 * A new producer answers the eight questions below and writes ONE row shape. It
 * does not get its own table, its own scale, or its own free-text verb — that is
 * how seven incompatible scorers happened the first time.
 */

import { VERB_PROFILES } from "./decay";
import type { SignalEvent, SignalVerb } from "./types";

/** The four verbs that are deliberate statements of preference. */
export const EXPLICIT_VERBS: readonly SignalVerb[] = [
  "refused",
  "preferred",
  "selected",
  "rejected",
] as const;

export function isExplicitVerb(verb: SignalVerb): boolean {
  return EXPLICIT_VERBS.includes(verb);
}

/**
 * Sources whose events can be produced more than once for the same act —
 * a backfill re-run, a webhook redelivery, a cron overlap.
 *
 * ⚠️ These MUST carry a `dedupeKey`. Re-syncing Circle's 870 posts without one
 * doubles every term weight in the system and nothing anywhere reports an error.
 */
const REPLAYABLE_SOURCES = new Set(["circle", "conference", "email", "print"]);

/** Clock skew tolerance. Beyond this, a future timestamp is a bug, not a prediction. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

/**
 * The eight questions every producer must answer, enforced.
 *
 * Called at the boundary, before an event is written. A malformed event is
 * refused rather than stored, because a log full of shapes nobody can interpret
 * is worse than a smaller log — it looks like data and behaves like noise.
 */
export function validateSignalEvent(event: SignalEvent, now: Date = new Date()): ValidationResult {
  const problems: string[] = [];

  // 1. WHO ACTED — optional, deliberately.
  //
  // ⛔ An earlier version REQUIRED actorOrgId and dropped everything else. That
  // was wrong: it decided a search was worthless because we could not name who
  // typed it. There is no useless information from a human interacting with
  // these surfaces — from a page load to a like, every one of them means a human
  // tried, and unattributed volume is still demand.
  //
  // An unattributed event simply does not reach the org rollups (they skip rows
  // with no actor), so it costs the scoring nothing while still feeding
  // `unresolvedDemand()` and every question of the form "how many people wanted
  // this". It is also the LEAST sensitive row in the table: an act with no
  // person attached to it.

  // 2. WHAT THEY DID. Closed list, each with a weight and half-life.
  if (!VERB_PROFILES[event.verb]) {
    problems.push(`unknown verb "${event.verb}" — add it to VERB_PROFILES with a weight, a half-life and a reason`);
  }

  // 3. TOWARD WHAT.
  //
  // ⛔ Raw text ALONE is enough. An earlier version required resolved terms or an
  //    org and dropped everything else — which threw away nine of twelve real
  //    campus-store queries, "crewneck" and "inclusive access" among them, for
  //    the sole crime of not appearing in a 60-word synonym list.
  //
  //    That is the opposite of storing the act: it admits only signal we can
  //    already name, and the signal worth most is the signal we cannot. An
  //    unresolved query is not a failure — it is demand with no category yet,
  //    it feeds the latent representation immediately, and it can be re-resolved
  //    the day someone adds the word. See `unresolvedDemand()`.
  const hasTerms = event.terms.length > 0;
  const hasObjectOrg = !!event.objectOrgId;
  const hasRawText = !!event.rawText?.trim();
  if (!hasTerms && !hasObjectOrg && !hasRawText) {
    problems.push(
      "an event must carry terms, an objectOrgId, or raw text — with none of the three there is " +
        "nothing to score now and nothing to re-resolve later, which makes it telemetry"
    );
  }
  if (hasTerms && !event.termSource) {
    problems.push("terms without a termSource — how they were resolved must survive to the match reason");
  }
  if (!hasTerms && event.termSource) {
    problems.push("termSource without terms");
  }
  if (hasObjectOrg && event.objectOrgId === event.actorOrgId) {
    problems.push("objectOrgId equals actorOrgId — an org visiting itself is not an affinity");
  }

  // 4. WAS IT DELIBERATE. The invariant that keeps explicit and implicit apart
  //    at the source, so the rollups' keys are never asked to fix bad input.
  const explicitVerb = isExplicitVerb(event.verb);
  if (explicitVerb && event.stance !== "explicit") {
    problems.push(`verb "${event.verb}" is a deliberate statement and must carry stance "explicit"`);
  }
  if (!explicitVerb && event.stance === "explicit") {
    problems.push(
      `verb "${event.verb}" is something someone did, not something they declared — stance must be "implicit". ` +
        "If this really is a declaration, it needs its own verb."
    );
  }

  // 5. TOWARD OR AWAY. There is no implicit negative: a person not clicking
  //    something is absence, and absence is not evidence of dislike.
  if (event.polarity === "negative" && !explicitVerb) {
    problems.push(
      "negative polarity requires an explicit verb — inferring dislike from what someone did NOT do is " +
        "reading absence as a statement"
    );
  }

  // 6. THE RAW FORM. The resolver will improve; old rows must be re-resolvable.
  if (hasTerms && !event.rawText && event.termSource !== "space" && event.termSource !== "category") {
    problems.push(
      "terms resolved from text but rawText was not kept — the interpretation is now unrepeatable and " +
        "a better resolver can never be applied to this row"
    );
  }

  // 7. WHEN. The act's own time, never ingestion time — a backfill of 870 posts
  //    stamped "today" would make fourteen months of history look like one day.
  if (event.occurredAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
    problems.push("occurredAt is in the future — use the act's own timestamp, not ingestion time");
  }

  // 8. HOW NOT TO DOUBLE-COUNT.
  if (REPLAYABLE_SOURCES.has(event.source) && !event.dedupeKey) {
    problems.push(
      `source "${event.source}" can be replayed and needs a dedupeKey — a second backfill would otherwise ` +
        "double every weight it contributes, silently"
    );
  }

  if (event.weight < 0) problems.push("weight must be >= 0; direction is carried by polarity, not by sign");

  return { ok: problems.length === 0, problems };
}

/**
 * ⛔ Refuse an act that the engine itself caused.
 *
 * The caller knows whether a meeting existed because a human asked for it or
 * because the solver produced it. Only the first is signal. The second belongs
 * in `recommendation_impressions`, which is what that table is for.
 *
 * This is separate from `validateSignalEvent` because the fact is not visible in
 * the event — it is context only the producer holds.
 */
export function assertNotEngineCaused(causedByEngine: boolean, what: string): void {
  if (causedByEngine) {
    throw new Error(
      `Refusing to ingest "${what}": the engine caused it. A meeting the solver created is evidence of the ` +
        "solver, not of affinity — ingesting it makes the engine reinforce its own recommendations. Record it " +
        "in recommendation_impressions instead; ingest only the human act that followed (a swap, a kept slot, " +
        "a typed reason)."
    );
  }
}

/** Throwing form, for producers that would rather fail a backfill than write a bad row. */
export function requireValidSignalEvent(event: SignalEvent, now?: Date): SignalEvent {
  const result = validateSignalEvent(event, now);
  if (!result.ok) {
    throw new Error(`Invalid signal event (${event.source}/${event.verb}):\n  - ${result.problems.join("\n  - ")}`);
  }
  return event;
}
