/**
 * Turning an act into taxonomy terms.
 *
 * This is the whole trick of the signal layer: a search box, a Circle space, a
 * filter click and a partner profile view all resolve into the SAME vocabulary
 * the match engine already scores on. Nothing needs a new axis — behaviour
 * enriches the axes that exist.
 *
 * ⛔ The word→taxonomy map is `resolveIntent` in lib/explore/intent-search.ts and
 * is imported, not restated. It is the file whose worked example is literally
 * "hoodie", it already does whole-word matching so "pen" does not fire on
 * "pending", and it already reports whether it had to infer. Writing a second
 * synonym list here is how the booth-matching predicate got written three times.
 */

import { resolveIntent, SYNONYMS } from "@/lib/explore/intent-search";
import { NACS_DEPARTMENTS, NACS_CLASSES_BY_DEPARTMENT } from "@/lib/publication/categories";
import type { TermSource } from "./types";

/**
 * lowercased term → canonical taxonomy label.
 *
 * `resolveIntent` returns lowercase because search comparisons are case-blind.
 * The rollup stores terms as a primary-key component and the match engine reads
 * canonical labels, so they are mapped back here rather than left to drift into
 * two spellings of "Apparel".
 */
const CANONICAL_BY_LOWER: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const dept of NACS_DEPARTMENTS) {
    map[dept.toLowerCase()] = dept;
    for (const cls of NACS_CLASSES_BY_DEPARTMENT[dept] ?? []) {
      map[cls.toLowerCase()] = cls;
    }
  }
  return map;
})();

/** Canonical taxonomy labels only — anything unrecognised is dropped, not guessed. */
export function canonicalizeTerms(terms: readonly string[]): string[] {
  const out = new Set<string>();
  for (const term of terms) {
    const canonical = CANONICAL_BY_LOWER[term.trim().toLowerCase()];
    if (canonical) out.add(canonical);
  }
  return [...out];
}

/**
 * ── The vocabulary changes, so resolution has a version ─────────────────────
 *
 * Synonyms get added. The taxonomy gains a class. An off-taxonomy legacy value
 * finally gets remapped by a human. Every one of those changes means events
 * resolved under the old vocabulary are now resolvable *better* — "crewneck"
 * resolves to nothing today and to Apparel the day someone adds the word.
 *
 * Stamping the resolver version onto every event is what makes that a routine
 * operation rather than an archaeology project: find the stale rows, re-resolve
 * from `rawText`, rebuild the rollups. Without it you cannot tell an event that
 * genuinely means nothing from one that was read by a worse reader.
 *
 * The taxonomy half is a fingerprint and updates itself. ⚠️ The synonym half is
 * manual — bump `SYNONYM_REVISION` whenever the map in
 * `lib/explore/intent-search.ts` changes, or history silently stops being
 * re-resolved.
 */
const SYNONYM_REVISION = 1;

const TAXONOMY_FINGERPRINT: string = (() => {
  const all = [
    ...NACS_DEPARTMENTS,
    ...NACS_DEPARTMENTS.flatMap((d) => [...(NACS_CLASSES_BY_DEPARTMENT[d] ?? [])]),
  ].join("|");
  // Small, stable, dependency-free — this only needs to change when the list does.
  let hash = 0;
  for (let i = 0; i < all.length; i++) hash = (Math.imul(31, hash) + all.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
})();

export const RESOLVER_VERSION = `${TAXONOMY_FINGERPRINT}.${SYNONYM_REVISION}`;

/** True when this event's terms were produced by an older vocabulary than today's. */
export function needsReresolution(
  eventResolverVersion: string | null | undefined,
  current: string = RESOLVER_VERSION
): boolean {
  return eventResolverVersion !== current;
}

export interface ResolvedTerms {
  terms: string[];
  source: TermSource | null;
}

/**
 * Free text — a search query, a post title, a comment — to taxonomy terms.
 *
 * `inferred` from the resolver distinguishes a reader who typed a real taxonomy
 * word from one we translated for, which becomes `exact` vs `synonym` and
 * survives all the way to the match reason.
 */
export function resolveText(raw: string | null | undefined): ResolvedTerms {
  if (!raw || !raw.trim()) return { terms: [], source: null };
  const { terms, inferred } = resolveIntent(raw);
  const canonical = canonicalizeTerms(terms);
  if (canonical.length === 0) return { terms: [], source: null };
  return { terms: canonical, source: inferred ? "synonym" : "exact" };
}

/**
 * A longer document — a Circle post body, a requirements note.
 *
 * ⛔ NOT `resolveIntent` word by word. That was the first design and it is
 * catastrophically loose on prose, because `resolveIntent` matches a taxonomy
 * term by SUBSTRING — correct for a search box, where typing "book" should find
 * "Textbooks", and ruinous applied to every word of a paragraph.
 *
 * Measured on 783 real Circle posts it "resolved" 98% of them, with 570 posts
 * apparently about E-commerce Platforms. One ordinary sentence —
 *
 *   "Our youth marketing platform has custom branded software for the store"
 *
 * — produced ELEVEN terms including Course Materials and Store Fixtures &
 * Equipment, neither of which appears in it. The word "store" alone pulled in
 * three departments.
 *
 * So a document credits a term only when it is genuinely present:
 *   - the whole taxonomy phrase appears ("course materials"), or
 *   - a hand-written SYNONYM appears as a whole word ("hoodie")
 *
 * The synonym list is curated and intentional; the substring match is not, and
 * is refused here.
 */
/**
 * Single-WORD taxonomy terms, which are the only ones a single word may resolve.
 *
 * ⛔ A lone token of a MULTI-WORD phrase is not evidence for that phrase, and
 * three rounds of trying to make it one all failed the same way:
 *
 *   "sales"   -> Locker Sales / Lottery Ticket Sales / Transit & Parking Pass Sales
 *                → 44 posts "about lottery tickets" that all just said "sales"
 *   "office"  -> four different terms
 *   "back"    -> unique to "Storage & Back Office", and an ordinary English word,
 *                so 51 posts got tagged with it
 *   "school"  -> unique to "School Office & Lab Supplies". Same story.
 *
 * Ambiguity filtering does not fix this, because the failures are UNAMBIGUOUS —
 * "back" identifies exactly one term and still means nothing. Each fix revealed
 * the next generic word, which is the signature of the wrong instrument.
 *
 * So a multi-word term requires the whole phrase; a single-word term may match
 * its word; and anything else has to come through the curated synonym list,
 * which is where translations like "hoodie" and "gowns" belong.
 */
const SINGLE_WORD_TERMS: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [lower, canonical] of Object.entries(CANONICAL_BY_LOWER)) {
    if (/[^a-z0-9]/.test(lower)) continue; // multi-word or punctuated
    if (lower.length < 5) continue;
    map.set(lower, canonical);
  }
  return map;
})();

/**
 * Single-word terms that are still too common to mean the category.
 * ⚠️ Short by design — the structural rule above does the real work now.
 */
const DOCUMENT_STOPWORDS = new Set(["other", "general", "digital", "online"]);

export function resolveDocument(raw: string | null | undefined): ResolvedTerms {
  if (!raw || !raw.trim()) return { terms: [], source: null };

  const haystack = ` ${raw.toLowerCase().replace(/\s+/g, " ")} `;
  const found = new Set<string>();
  let sawExact = false;

  // 1. Whole taxonomy phrases, present verbatim.
  for (const [lower, canonical] of Object.entries(CANONICAL_BY_LOWER)) {
    // Short single words like "books" would over-fire the same way; a phrase or
    // a distinctive word only.
    if (lower.length < 6) continue;
    if (haystack.includes(` ${lower} `) || haystack.includes(` ${lower},`) || haystack.includes(` ${lower}.`)) {
      found.add(canonical);
      sawExact = true;
    }
  }

  // 2. Single words, minus the ones that are just English.
  //
  // ⚠️ Filtering on `inferred` was the obvious move and it is wrong: resolveIntent
  // short-circuits on its substring match BEFORE consulting the synonym list, so
  // "gowns" comes back as a direct hit on "Caps & Gowns" and gets discarded along
  // with the noise. The mechanism does not separate good from bad —
  // DISTINCTIVENESS does. "gowns", "drinkware" and "lanyards" mean the taxonomy
  // term; "store", "custom" and "youth" are just words people write.
  //
  // Same instrument `lib/comms/partner-asks.ts` reached for when description
  // matching inflated every score equally.
  for (const word of new Set(raw.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 3))) {
    if (DOCUMENT_STOPWORDS.has(word)) continue;

    // A word that IS a single-word term — "drinkware", "stationery", "textbooks".
    const single = SINGLE_WORD_TERMS.get(word);
    if (single) {
      found.add(single);
      continue;
    }

    // Otherwise the curated synonym list, read DIRECTLY.
    //
    // ⚠️ Not via resolveIntent: it tries its substring match first, so "gowns"
    // returns a direct hit on "Caps & Gowns" and reports inferred=false, and a
    // filter on that flag silently discards a legitimate curated translation.
    // The map is the thing we actually want here.
    for (const term of canonicalizeTerms(SYNONYMS[word] ?? [])) found.add(term);
  }

  if (found.size === 0) return { terms: [], source: null };
  return { terms: [...found], source: sawExact ? "exact" : "synonym" };
}

/**
 * A Circle space name.
 *
 * Several spaces are named for what people buy — "Course Materials" (45 posts),
 * "General Merchandise" (149), "Operations" (26). Being in one of those is a
 * declaration of interest that nobody had to fill in a form to make, so it
 * resolves as `space` rather than as a guess.
 *
 * ⚠️ "General Merchandise" is NOT in the taxonomy — it is one of the legacy
 * off-vocabulary values, and it is genuinely ambiguous. It resolves to nothing
 * rather than being auto-mapped, which is the same rule the category parser
 * follows. Guessing at it is what produced the legacy mess in the first place.
 */
/**
 * Space names that collide with a taxonomy term but do not mean it.
 *
 * ⚠️ "Announcements" is a class under Graduation & Regalia — and also the name of
 * the community's general announcements room, which tagged 66 posts as
 * graduation stationery. The collision is exact, so no amount of matching care
 * catches it; only knowing the room does.
 */
const NOT_CATEGORY_SPACES = new Set(["announcements", "getting started", "say hello"]);

export function resolveSpaceName(name: string | null | undefined): ResolvedTerms {
  if (!name || !name.trim()) return { terms: [], source: null };
  if (NOT_CATEGORY_SPACES.has(name.trim().toLowerCase())) return { terms: [], source: null };
  const canonical = canonicalizeTerms([name.trim()]);
  if (canonical.length === 0) return { terms: [], source: null };
  return { terms: canonical, source: "space" };
}

/**
 * An explicit click on a category control. The strongest term signal there is —
 * no translation happened, the reader picked the word out of our own list.
 */
export function resolveCategoryClick(label: string | null | undefined): ResolvedTerms {
  const canonical = canonicalizeTerms([label ?? ""]);
  return canonical.length > 0 ? { terms: canonical, source: "category" } : { terms: [], source: null };
}
