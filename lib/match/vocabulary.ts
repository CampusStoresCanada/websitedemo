/**
 * A partner's own vocabulary, distilled for search.
 *
 * The problem this solves: `/partners` search matches DECLARED text — NACS
 * taxonomy, category, description, an AI website summary. A partner whose site
 * says "decorated apparel solutions" does not match "hoodies", even when hoodies
 * are demonstrably what they talk about and sell.
 *
 * ⛔ SINGLE TOKENS, NEVER PHRASES. The output reaches the PUBLIC /partners search
 * and the input is Circle — members-only content. Verbatim text would let anyone
 * logged out confirm a private post exists by searching an exact phrase from it.
 * "hoodie" against a partner is not a disclosure; "the Dalhousie deal fell
 * through" would be. There is deliberately no n-gram option here.
 *
 * ⛔ ORG-ATTRIBUTED, NEVER PERSON-ATTRIBUTED. Callers pass a partner's own acts
 * with the author already dropped. A match can say "this partner talks about
 * hoodies"; it can never say who said it, and no person is addressable through it.
 *
 * ⚠️ MIN_DOCS is the guard that matters. A term appearing in only ONE document is
 * discarded, which is what protects a one-person partner — whose org vocabulary
 * would otherwise be a single human's voice — and makes a one-off phrase from a
 * single post unpublishable. Genuine product vocabulary survives easily: a partner
 * who sells hoodies mentions them more than once.
 */

/** A term must appear in at least this many separate documents for the org. */
export const MIN_DOCS = 2;
/** Shorter tokens are noise ("the", "and", sizes, initials). */
export const MIN_TOKEN_LENGTH = 4;
/** Cap per org. Enough to shift a ranking, small enough to stay a fingerprint. */
export const MAX_KEYWORDS = 30;

/**
 * ⚠️ Deliberately small and hand-kept, not a linguistics package.
 *
 * These are the words that would otherwise dominate every partner equally and so
 * distinguish nobody — plus the community's own furniture ("thanks", "meeting")
 * and CSC's vocabulary ("conference", "member"), which describe how people talk in
 * a forum rather than what any partner sells.
 */
const STOPWORDS = new Set([
  "about", "above", "after", "again", "against", "also", "although", "always",
  "another", "anyone", "anything", "around", "because", "been", "before", "being",
  "below", "between", "both", "came", "could", "does", "doing", "done", "down",
  "during", "each", "else", "even", "ever", "every", "from", "further", "gets",
  "getting", "give", "going", "gone", "good", "great", "have", "having", "here",
  "hers", "herself", "himself", "into", "itself", "just", "keep", "kind", "know",
  "known", "last", "less", "like", "look", "looking", "made", "make", "making",
  "many", "might", "more", "most", "much", "must", "need", "needs", "never",
  "next", "none", "nothing", "only", "other", "others", "ours", "ourselves",
  "over", "own", "part", "past", "people", "perhaps", "please", "quite", "rather",
  "really", "right", "said", "same", "seem", "seen", "sent", "several", "shall",
  "should", "since", "some", "someone", "something", "still", "such", "sure",
  "take", "taken", "taking", "than", "that", "their", "theirs", "them",
  "themselves", "then", "there", "these", "they", "thing", "things", "think",
  "this", "those", "though", "through", "time", "together", "took", "toward",
  "under", "until", "upon", "used", "using", "very", "want", "wanted", "well",
  "went", "were", "what", "when", "where", "which", "while", "will", "with",
  "within", "without", "would", "your", "yours", "yourself",
  // Forum furniture — says how people talk, not what anybody sells.
  "thanks", "thank", "hello", "welcome", "everyone", "morning", "afternoon",
  "question", "questions", "answer", "answers", "reply", "post", "posted",
  "comment", "comments", "email", "emails", "call", "calls", "meeting",
  "meetings", "attached", "sharing", "shared", "update", "updates",
  // CSC's own vocabulary. Every partner sits inside it, so it separates nobody.
  "campus", "stores", "store", "canada", "canadian", "conference", "member",
  "members", "membership", "association", "partner", "partners", "vendor",
  "vendors", "bookstore", "bookstores", "university", "college", "school",
]);

/** One document belonging to the org, author already dropped by the caller. */
export interface VocabDoc {
  text: string;
}

/**
 * Tokens worth counting: lowercase words only.
 *
 * ⚠️ Digits are dropped entirely. They carry order numbers, dollar figures, dates
 * and phone fragments — the parts of a sentence most likely to identify a specific
 * transaction or person, and the least likely to help anyone find a supplier.
 */
export function tokenize(text: string, exclude?: ReadonlySet<string>): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(
      (t) =>
        t.length >= MIN_TOKEN_LENGTH &&
        !STOPWORDS.has(t) &&
        !(exclude !== undefined && exclude.has(t))
    );
}

/**
 * The vocabulary fingerprint for ONE org.
 *
 * `documentFrequency` is how many orgs across the whole corpus use each term, and
 * `totalOrgs` the corpus size — together they down-weight words everybody uses.
 * A term every partner says describes the industry, not this partner.
 *
 * Scored `tf × log(totalOrgs / df)`: plain TF-IDF, which needs no model, no API
 * call and no vendor. That matters here — the corpus is members-only content and
 * must not leave the machine, so anything requiring a hosted model is disqualified
 * before its quality is even discussed.
 */
export function orgVocabulary(
  docs: readonly VocabDoc[],
  documentFrequency: ReadonlyMap<string, number>,
  totalOrgs: number,
  /**
   * ⛔ Tokens that must never publish — every known person's name, passed in by the
   * caller. Applied at TOKENIZE time, before any counting, so an excluded token
   * cannot survive by being frequent. See the triangulation guard in
   * scripts/match-space.mts for why this is not optional in practice.
   */
  exclude?: ReadonlySet<string>
): string[] {
  const termFreq = new Map<string, number>();
  const termDocs = new Map<string, number>();

  for (const doc of docs) {
    const seenInThisDoc = new Set<string>();
    for (const token of tokenize(doc.text, exclude)) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      seenInThisDoc.add(token);
    }
    for (const token of seenInThisDoc) {
      termDocs.set(token, (termDocs.get(token) ?? 0) + 1);
    }
  }

  const scored: { term: string; score: number }[] = [];
  for (const [term, tf] of termFreq) {
    // ⛔ The privacy guard, applied before scoring so nothing can outrank it.
    if ((termDocs.get(term) ?? 0) < MIN_DOCS) continue;
    const df = documentFrequency.get(term) ?? 1;
    scored.push({ term, score: tf * Math.log(Math.max(totalOrgs, 2) / df) });
  }

  return scored
    // Ties broken alphabetically so a re-run produces an identical array and does
    // not look like a change to anything diffing these rows.
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, MAX_KEYWORDS)
    .map((s) => s.term);
}

/**
 * How many ORGS use each term, across every org's docs.
 *
 * ⚠️ Counted per org, not per document. Document frequency would let one partner
 * who posts constantly define the baseline for everybody: a word they use in 200
 * of their own posts would look common across the industry and be discounted for
 * every other partner, including one for whom it is genuinely distinctive.
 */
export function corpusDocumentFrequency(
  byOrg: ReadonlyMap<string, readonly VocabDoc[]>,
  /** ⚠️ Must be the SAME set passed to orgVocabulary, or the baseline is computed
   * over a vocabulary the scorer never sees and every score shifts. */
  exclude?: ReadonlySet<string>
): Map<string, number> {
  const df = new Map<string, number>();
  for (const docs of byOrg.values()) {
    const seenForOrg = new Set<string>();
    for (const doc of docs) for (const token of tokenize(doc.text, exclude)) seenForOrg.add(token);
    for (const token of seenForOrg) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return df;
}
