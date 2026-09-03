/**
 * Circle → signal events.
 *
 * Pure: takes Circle objects and a member→contact map, returns SignalEvents.
 * The fetching and the writing live in `scripts/circle-signal-backfill.mts`, so
 * the resolution rules — the part that is easy to get subtly wrong — can be
 * tested without a network or a database.
 *
 * ⛔ `occurredAt` is the post's OWN `created_at`, never ingestion time. Stamping
 * a backfill of 870 posts with "today" would turn fourteen months of history
 * into a single day and make every decay calculation lie.
 */

import { resolveDocument, resolveSpaceName, RESOLVER_VERSION } from "./resolve";
import { VERB_PROFILES } from "./decay";
import type { SignalEvent, TermSource } from "./types";

/** What the backfill needs from a Circle post. */
export interface CirclePostLike {
  id: number;
  name: string;
  body: string | { body?: string } | null;
  space_id: number;
  user_id: number;
  created_at: string;
}

export interface CircleSpaceLike {
  id: number;
  name: string;
  /** Partner-named spaces resolve to an org, not to categories. */
  organizationId?: string | null;
}

/** One Circle member, already resolved to who they are here. */
export interface CircleActor {
  organizationId: string;
  contactId: string | null;
}

/** Circle's body is a string on v1 and a nested object on admin v2. */
export function postBodyText(body: CirclePostLike["body"]): string {
  const raw = typeof body === "string" ? body : (body?.body ?? "");
  // Strip tags before resolving — otherwise "class", "href" and every tiny tag
  // name become candidate words, and the taxonomy has a "Books" department that
  // a stray <b> would never hit but a <button class="books"> would.
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Partner names that are also ordinary English, and must not match in lower case.
 *
 * ⚠️ A curated list, and defensibly so — unlike a taxonomy stopword list, which
 * grows with the language, this is a finite roster of proper nouns that happen to
 * collide with common words. 80 partners, 23 single-word, and only these are
 * genuinely ambiguous. "we got back to our roots" is not a mention of Roots.
 */
const CASE_SENSITIVE_NAMES = new Set([
  "roots", "ahead", "pukka", "dmg", "fiel", "jcwg", "kotmo", "bookware",
]);

/**
 * Partners named in the text.
 *
 * ⛔ This is the signal that matters most in a post like "Momentec made this
 * fabulous banana" — a member publicly endorsing a partner, unprompted. It needs
 * no taxonomy, no embedding and no vocabulary: it is a proper noun, and we hold
 * the roster of 80 of them.
 *
 * Matching rules, in decreasing safety:
 *   multi-word name   whole phrase, case-insensitive — "MV Sport", "Login Canada"
 *   long single word  whole word, case-insensitive — "Merangue", "VitalSource"
 *   ambiguous name    whole word AND original casing — "Roots", "Ahead"
 */
export function resolvePartnerMentions(
  text: string,
  partnersByName: Map<string, string>
): { organizationId: string; name: string }[] {
  const hits: { organizationId: string; name: string }[] = [];
  const lower = text.toLowerCase();

  for (const [name, organizationId] of partnersByName) {
    const needle = name.toLowerCase();
    if (needle.length < 3) continue;

    const ambiguous = CASE_SENSITIVE_NAMES.has(needle);
    const haystack = ambiguous ? text : lower;
    const target = ambiguous ? name : needle;

    // Word boundaries both ends, so "Ahead" does not fire inside "Aheadstart"
    // and "Roots" does not fire inside "Rootstock".
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`).test(haystack)) {
      hits.push({ organizationId, name });
    }
  }
  return hits;
}

export interface BackfillOptions {
  /** circle user_id → who they are. Missing means unattributed, not skipped. */
  actorByCircleUserId: Map<number, CircleActor>;
  spacesById: Map<number, CircleSpaceLike>;
  /** Partner name → org id, for detecting mentions in the body. */
  partnersByName?: Map<string, string>;
  /**
   * What each org has already DECLARED it deals in.
   *
   * ⛔ Present so the backfill can refuse to guess. Randmar declares Technology
   * & Electronics with classes Hardware & Devices / Supplies & Accessories /
   * Peripherals. Their post "Apple Accessories Students Can Afford" resolved to
   * the **Accessories** department — bags, drinkware, stationery — which does not
   * merely miss, it contradicts a fact we hold in a column.
   *
   * Inferring a category for an org that has declared one is worse than doing
   * nothing: it is confidently wrong, invisible inside a score, and it makes a
   * tech distributor look like a drinkware vendor to a member who trusted the
   * recommendation.
   */
  declaredTermsByOrg?: Map<string, Set<string>>;
}

/** A term an org talks about but has never declared. An ASK, not a score. */
export interface ProfileGap {
  organizationId: string;
  term: string;
  /** What they said, so a human can judge whether the gap is real. */
  evidence: string;
}

/**
 * One post → one signal event.
 *
 * Resolution has two independent routes and a post can take both:
 *   - the SPACE, when it is named for a category ("Course Materials")
 *   - the post's own words, through the synonym resolver
 * and separately, the space's ORG when it is a partner's space (Merangue),
 * which makes an affinity edge rather than a term.
 *
 * Returns null only when there is genuinely nothing to record — no actor, no
 * terms, no org and no text. An unattributed or unresolved post is still kept:
 * every act by a human on these surfaces is signal.
 */
/**
 * Terms an org talked about that fall outside what it has declared.
 *
 * The useful half of reading a post from an org we already understand: not a
 * category to score, but a gap to ask about.
 */
export function profileGapsFor(
  post: CirclePostLike,
  options: BackfillOptions
): ProfileGap[] {
  const actor = options.actorByCircleUserId.get(post.user_id);
  const declared = actor?.organizationId
    ? options.declaredTermsByOrg?.get(actor.organizationId)
    : undefined;
  if (!actor?.organizationId || !declared) return [];

  const text = [post.name, postBodyText(post.body)].filter(Boolean).join(". ");
  return resolveDocument(text)
    .terms.filter((t) => !declared.has(t))
    .map((term) => ({
      organizationId: actor.organizationId,
      term,
      evidence: text.slice(0, 120),
    }));
}

export function postToSignalEvents(
  post: CirclePostLike,
  options: BackfillOptions
): SignalEvent[] {
  const base = postToSignalEvent(post, options);
  if (!base) return [];

  const partners = options.partnersByName;
  if (!partners || !base.rawText) return [base];

  // ⛔ A mention is its own act, not a property of the post.
  //
  // "Momentec made this fabulous banana" is a member publicly naming a partner,
  // unprompted — the strongest thing in that sentence, and it survives having no
  // category and no embedding. A post naming three partners is three affinity
  // facts, so it is three events with three keys, not one event that can only
  // point at one of them.
  const mentions = resolvePartnerMentions(base.rawText, partners)
    .filter((m) => m.organizationId !== base.actorOrgId);

  return [
    base,
    ...mentions.map((m) => ({
      ...base,
      objectType: "org" as const,
      objectOrgId: m.organizationId,
      // The mention carries the affinity; the terms belong to the post itself and
      // would double-count if repeated here.
      terms: [],
      termSource: null,
      dedupeKey: `circle:post:${post.id}:mention:${m.organizationId}`,
    })),
  ];
}

export function postToSignalEvent(
  post: CirclePostLike,
  options: BackfillOptions
): SignalEvent | null {
  const space = options.spacesById.get(post.space_id);
  const actor = options.actorByCircleUserId.get(post.user_id);

  const text = [post.name, postBodyText(post.body)].filter(Boolean).join(". ");
  const fromText = resolveDocument(text);
  const fromSpace = space ? resolveSpaceName(space.name) : { terms: [], source: null };

  const inferred = [...new Set([...fromSpace.terms, ...fromText.terms])];

  // ⛔ NEVER infer what the org has already told us.
  //
  // A term inside their declared set adds nothing — we knew. A term outside it
  // is not a discovery to be scored, it is a QUESTION for a human: "you keep
  // talking about this and have not declared it — should you have?" Answered,
  // that becomes a declaration, which is durable and correct. Guessed, it is a
  // silent wrong number nobody can ever find.
  const declared = actor?.organizationId
    ? options.declaredTermsByOrg?.get(actor.organizationId)
    : undefined;

  const terms = declared ? [] : inferred;
  const termSource: TermSource | null =
    terms.length === 0 ? null : fromSpace.terms.length > 0 ? "space" : fromText.source;

  const objectOrgId = space?.organizationId ?? null;
  if (!actor && terms.length === 0 && !objectOrgId && !text) return null;

  return {
    occurredAt: new Date(post.created_at),
    source: "circle",
    verb: "posted",
    actorOrgId: actor?.organizationId ?? null,
    actorContactId: actor?.contactId ?? null,
    stance: "implicit",
    polarity: "positive",
    objectType: "post",
    // An org's own space is not an affinity toward itself.
    objectOrgId: objectOrgId && objectOrgId !== actor?.organizationId ? objectOrgId : null,
    objectRef: String(post.id),
    // Kept verbatim so a better resolver can be run over it later. Titles are
    // short and carry most of the meaning; the body is truncated by the caller.
    rawText: text.slice(0, 500) || null,
    terms,
    termSource,
    resolverVersion: RESOLVER_VERSION,
    weight: VERB_PROFILES.posted.weight,
    // ⚠️ Per ACT, not per object. A post is written once; its likes and comments
    // accrue for months and each is its own act with its own key.
    dedupeKey: `circle:post:${post.id}`,
  };
}

export interface BackfillReport {
  posts: number;
  /** Produced an event at all. */
  kept: number;
  /** Had an org behind them. */
  attributed: number;
  /** Resolved to at least one taxonomy term. */
  resolved: number;
  /** Resolved via the space's name rather than the prose. */
  fromSpaceName: number;
  /** Pointed at a partner's own space. */
  orgAffinity: number;
  termCounts: { term: string; posts: number }[];
}

export function summarizeBackfill(events: readonly SignalEvent[], postCount: number): BackfillReport {
  const termCounts = new Map<string, number>();
  for (const e of events) {
    for (const t of e.terms) termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
  }
  return {
    posts: postCount,
    kept: events.length,
    attributed: events.filter((e) => e.actorOrgId).length,
    resolved: events.filter((e) => e.terms.length > 0).length,
    fromSpaceName: events.filter((e) => e.termSource === "space").length,
    orgAffinity: events.filter((e) => e.objectOrgId).length,
    termCounts: [...termCounts.entries()]
      .map(([term, posts]) => ({ term, posts }))
      .sort((a, b) => b.posts - a.posts),
  };
}
