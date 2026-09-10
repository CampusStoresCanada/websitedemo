/**
 * Events → rollups. Pure; the runner supplies the events and persists the result.
 *
 * ⚠️ This is the point where person-level detail stops. `actorContactId` is read
 * here only to count distinct people, and the returned rows carry a NUMBER and
 * no identity. Everything downstream — the match engine, every product surface,
 * every report — reads these rows, so there is nowhere for a name to travel to.
 */

import { NEGLIGIBLE_WEIGHT, decayedWeight } from "./decay";
import type {
  AffinityRollup,
  SignalEvent,
  SignalPolarity,
  SignalStance,
  TermRollup,
  TermSource,
} from "./types";

/** Strongest first — the source recorded for a rolled-up term is its best evidence. */
const SOURCE_RANK: Record<TermSource, number> = {
  category: 0,
  exact: 1,
  space: 2,
  synonym: 3,
  semantic: 4,
};

/**
 * Separator for composite map keys.
 *
 * ⚠️ Not a space. Taxonomy terms contain spaces — "Course Materials", "Caps &
 * Gowns" — so a space-joined key is ambiguous, and the ambiguity would show up
 * as two orgs' signal quietly merging rather than as an error. A unit separator
 * cannot appear in an id or a taxonomy label.
 */
const KEY_SEP = "\u001f";

/** Composite key for (org, term). Exported so callers never hand-build one. */
export function termKey(organizationId: string, term: string): string {
  return `${organizationId}${KEY_SEP}${term}`;
}

/** Same, at person resolution. A null contact is the org-level bucket. */
export function personTermKey(
  organizationId: string,
  contactId: string | null,
  term: string
): string {
  return `${organizationId}${KEY_SEP}${contactId ?? ""}${KEY_SEP}${term}`;
}

interface Bucket {
  weight: number;
  eventCount: number;
  actors: Set<string>;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

function emptyBucket(): Bucket {
  return { weight: 0, eventCount: 0, actors: new Set(), firstSeenAt: null, lastSeenAt: null };
}

function absorb(bucket: Bucket, event: SignalEvent, weight: number): void {
  bucket.weight += weight;
  bucket.eventCount += 1;
  if (event.actorContactId) bucket.actors.add(event.actorContactId);
  if (!bucket.firstSeenAt || event.occurredAt < bucket.firstSeenAt) {
    bucket.firstSeenAt = event.occurredAt;
  }
  if (!bucket.lastSeenAt || event.occurredAt > bucket.lastSeenAt) {
    bucket.lastSeenAt = event.occurredAt;
  }
}

/**
 * What each org has revealed an interest in, decayed to `now`.
 *
 * Keyed by (org, term, source) rather than (org, term) so that "they clicked
 * Apparel out of our own list" stays distinguishable from "we translated the
 * word hoodie for them". Collapsing those would let an inference inherit the
 * confidence of a declaration, which is the failure the whole reason model
 * exists to prevent.
 */
export function rollupTerms(events: readonly SignalEvent[], now: Date): TermRollup[] {
  const buckets = new Map<
    string,
    { key: [string, string | null, string, TermSource, SignalStance, SignalPolarity]; bucket: Bucket }
  >();

  for (const event of events) {
    if (!event.actorOrgId || !event.termSource || event.terms.length === 0) continue;
    const weight = decayedWeight(event.verb, event.occurredAt, now, event.weight);
    if (weight <= 0) continue;

    for (const term of event.terms) {
      const id = [
        personTermKey(event.actorOrgId, event.actorContactId, term),
        event.termSource,
        event.stance,
        event.polarity,
      ].join(KEY_SEP);
      let entry = buckets.get(id);
      if (!entry) {
        entry = {
          key: [
            event.actorOrgId,
            event.actorContactId,
            term,
            event.termSource,
            event.stance,
            event.polarity,
          ],
          bucket: emptyBucket(),
        };
        buckets.set(id, entry);
      }
      absorb(entry.bucket, event, weight);
    }
  }

  return [...buckets.values()]
    .filter(({ bucket }) => bucket.weight >= NEGLIGIBLE_WEIGHT)
    .map(({ key: [organizationId, contactId, term, termSource, stance, polarity], bucket }) => ({
      organizationId,
      contactId,
      term,
      termSource,
      stance,
      polarity,
      weight: bucket.weight,
      eventCount: bucket.eventCount,
      actorCount: bucket.actors.size,
      firstSeenAt: bucket.firstSeenAt,
      lastSeenAt: bucket.lastSeenAt,
    }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Org-to-org pull — profile views, catalogue clicks, sitting in a vendor's Circle
 * space, RSVPing to their event.
 *
 * This is the axis a taxonomy can never give you: it says "these two keep ending
 * up in the same room" without either of them having categorised anything.
 */
export function rollupAffinity(events: readonly SignalEvent[], now: Date): AffinityRollup[] {
  const buckets = new Map<
    string,
    { key: [string, string | null, string, SignalStance, SignalPolarity]; bucket: Bucket }
  >();

  for (const event of events) {
    if (!event.actorOrgId || !event.objectOrgId) continue;
    // A self-visit is someone editing their own profile, not an affinity.
    if (event.actorOrgId === event.objectOrgId) continue;

    const weight = decayedWeight(event.verb, event.occurredAt, now, event.weight);
    if (weight <= 0) continue;

    const id = [
      personTermKey(event.actorOrgId, event.actorContactId, event.objectOrgId),
      event.stance,
      event.polarity,
    ].join(KEY_SEP);
    let entry = buckets.get(id);
    if (!entry) {
      entry = {
        key: [event.actorOrgId, event.actorContactId, event.objectOrgId, event.stance, event.polarity],
        bucket: emptyBucket(),
      };
      buckets.set(id, entry);
    }
    absorb(entry.bucket, event, weight);
  }

  return [...buckets.values()]
    .filter(({ bucket }) => bucket.weight >= NEGLIGIBLE_WEIGHT)
    .map(({ key: [organizationId, contactId, objectOrgId, stance, polarity], bucket }) => ({
      organizationId,
      contactId,
      objectOrgId,
      stance,
      polarity,
      weight: bucket.weight,
      eventCount: bucket.eventCount,
      actorCount: bucket.actors.size,
      lastSeenAt: bucket.lastSeenAt,
    }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Collapse person-grained rows to org level.
 *
 * The rollup keys on the person because that resolution cannot be recovered once
 * lost. Anything asking an org-level question — "what does McMaster buy" — folds
 * them here instead of the store being denied the detail up front.
 *
 * ⚠️ `actorCount` becomes the count of DISTINCT people folded in, not a sum of
 * counts, since one person appears in one bucket per term.
 */
export function collapseToOrg(rollups: readonly TermRollup[]): TermRollup[] {
  const byOrgTerm = new Map<string, { row: TermRollup; people: Set<string> }>();

  for (const r of rollups) {
    const id = [termKey(r.organizationId, r.term), r.termSource, r.stance, r.polarity].join(KEY_SEP);
    const found = byOrgTerm.get(id);
    if (!found) {
      byOrgTerm.set(id, {
        row: { ...r, contactId: null },
        people: new Set(r.contactId ? [r.contactId] : []),
      });
      continue;
    }
    found.row.weight += r.weight;
    found.row.eventCount += r.eventCount;
    if (r.contactId) found.people.add(r.contactId);
    if (r.lastSeenAt && (!found.row.lastSeenAt || r.lastSeenAt > found.row.lastSeenAt)) {
      found.row.lastSeenAt = r.lastSeenAt;
    }
    if (r.firstSeenAt && (!found.row.firstSeenAt || r.firstSeenAt < found.row.firstSeenAt)) {
      found.row.firstSeenAt = r.firstSeenAt;
    }
  }

  return [...byOrgTerm.values()]
    .map(({ row, people }) => ({ ...row, actorCount: Math.max(people.size, row.actorCount) }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Collapse (org, term, source) rows into the best evidence per (org, term).
 *
 * The rollup keeps sources apart so a click and a translation stay
 * distinguishable; the match profile wants one term with its strongest backing.
 * Weight sums across sources — three routes to Activewear is more signal than
 * one — but the reported source is the best of them, never the loudest.
 */
export function bestPerTerm(rollups: readonly TermRollup[]): TermRollup[] {
  const byTerm = new Map<string, TermRollup>();

  for (const row of rollups) {
    // ⚠️ Stance and polarity stay in the key. Collapsing an explicit refusal into
    // an implicit browsing average is the exact blending this model exists to
    // prevent — only term SOURCES merge here.
    const id = [termKey(row.organizationId, row.term), row.stance, row.polarity].join(KEY_SEP);
    const existing = byTerm.get(id);
    if (!existing) {
      byTerm.set(id, { ...row });
      continue;
    }
    existing.weight += row.weight;
    existing.eventCount += row.eventCount;
    // ⚠️ Actor counts cannot be summed — the same person may have searched AND
    // clicked. Taking the max under-counts rather than inventing people.
    existing.actorCount = Math.max(existing.actorCount, row.actorCount);
    if (SOURCE_RANK[row.termSource] < SOURCE_RANK[existing.termSource]) {
      existing.termSource = row.termSource;
    }
    if (row.lastSeenAt && (!existing.lastSeenAt || row.lastSeenAt > existing.lastSeenAt)) {
      existing.lastSeenAt = row.lastSeenAt;
    }
    if (row.firstSeenAt && (!existing.firstSeenAt || row.firstSeenAt < existing.firstSeenAt)) {
      existing.firstSeenAt = row.firstSeenAt;
    }
  }

  return [...byTerm.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * Normalise an org's term weights to 0..1 against its own strongest term.
 *
 * Absolute weights are not comparable between orgs — a large store with fifteen
 * staff browsing generates more of everything than a two-person shop, and
 * ranking on raw totals would just rank by headcount. What matters is what this
 * org cares about *relative to itself*.
 */
export function normalizeTermWeights(rollups: readonly TermRollup[]): Map<string, number> {
  // ⚠️ Positive rows only. A refusal carries the heaviest weight in the system,
  // so letting one set the per-org ceiling would push every genuine interest
  // toward zero — the org would look uninterested in everything it likes.
  const positive = rollups.filter((row) => row.polarity === "positive");

  const maxByOrg = new Map<string, number>();
  for (const row of positive) {
    const current = maxByOrg.get(row.organizationId) ?? 0;
    if (row.weight > current) maxByOrg.set(row.organizationId, row.weight);
  }

  const normalized = new Map<string, number>();
  for (const row of positive) {
    const max = maxByOrg.get(row.organizationId) ?? 0;
    const key = termKey(row.organizationId, row.term);
    normalized.set(key, max > 0 ? Math.max(normalized.get(key) ?? 0, row.weight / max) : 0);
  }
  return normalized;
}


// ── The world keeps moving ───────────────────────────────────────────────────

/** Demand nobody has a word for yet. */
export interface UnresolvedDemand {
  /** Normalised form, used for grouping. */
  text: string;
  occurrences: number;
  /** How many distinct orgs asked for it — breadth matters more than volume. */
  orgCount: number;
  lastSeenAt: Date | null;
}

function normalizeText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * What people asked for that the vocabulary could not name.
 *
 * ⛔ This is a PRODUCT, not an error log. Nine of twelve realistic campus-store
 * queries resolve to nothing today — "crewneck", "inclusive access", "OER
 * integration", "menstrual products". Ranked by how many distinct orgs asked,
 * this is simultaneously:
 *
 *   - the synonym list's to-do, in priority order
 *   - evidence of demand the taxonomy has no category for
 *   - the cheapest possible read on what members actually want
 *
 * Sorted by org breadth rather than raw count, because one store searching
 * fifteen times is one store, and three stores searching once each is a trend.
 */
export function unresolvedDemand(
  events: readonly SignalEvent[],
  options: { minOrgs?: number } = {}
): UnresolvedDemand[] {
  const buckets = new Map<string, { orgs: Set<string>; occurrences: number; lastSeenAt: Date | null }>();

  for (const event of events) {
    if (event.terms.length > 0) continue;          // it resolved; not our problem
    const raw = event.rawText?.trim();
    if (!raw) continue;                             // an org affinity with no text
    const key = normalizeText(raw);
    if (!key) continue;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { orgs: new Set(), occurrences: 0, lastSeenAt: null };
      buckets.set(key, bucket);
    }
    bucket.occurrences += 1;
    if (event.actorOrgId) bucket.orgs.add(event.actorOrgId);
    if (!bucket.lastSeenAt || event.occurredAt > bucket.lastSeenAt) {
      bucket.lastSeenAt = event.occurredAt;
    }
  }

  const minOrgs = options.minOrgs ?? 1;
  return [...buckets.entries()]
    .map(([text, b]) => ({
      text,
      occurrences: b.occurrences,
      orgCount: b.orgs.size,
      lastSeenAt: b.lastSeenAt,
    }))
    .filter((row) => row.orgCount >= minOrgs)
    .sort((a, b) => b.orgCount - a.orgCount || b.occurrences - a.occurrences);
}

/**
 * Events whose terms were produced by an older vocabulary.
 *
 * The nightly job re-resolves these from `rawText` before rolling anything up,
 * so adding one synonym retroactively improves every event that word ever
 * appeared in. Nothing is "built once" — the vocabulary moves and history is
 * re-read against it.
 */
export function staleResolutions(
  events: readonly SignalEvent[],
  currentVersion: string
): SignalEvent[] {
  return events.filter(
    (event) => !!event.rawText?.trim() && event.resolverVersion !== currentVersion
  );
}
