/**
 * Capability names — client-safe.
 *
 * Deliberately separate from lib/auth/capabilities.ts, which is server-only:
 * the names are needed in client components (the committee console, the grant
 * form), while the checks that read the database are not.
 *
 * Naming is dotted and specific — `benchmarking.content_review`, never
 * `benchmarking.admin`. If a capability needs a comment to explain what it
 * covers, it is too broad; split it.
 */
export const CAPABILITIES = {
  /** Appoints and coordinates the benchmarking committee. May delegate. */
  /**
   * The Nominating Committee's working view of an election — the slate, the
   * representation lens, and chasing incomplete nominations.
   *
   * Held ex officio by the President, Past President and Executive Director,
   * and by anyone the board appoints as `nominating_committee_member` on the
   * Nominating Committee body. Both routes resolve through
   * governance_role_assignments — NOT capability_grants, which has no read path
   * and silently does nothing.
   */
  ELECTIONS_NOMINATING_REVIEW: "elections.nominating_review",

  BENCHMARKING_COMMITTEE_LEAD: "benchmarking.committee_lead",
  /** Store directors reviewing question wording and authoring worked examples. */
  BENCHMARKING_CONTENT_REVIEW: "benchmarking.content_review",
  /** Board committee resolving delta flags and verifying submissions. */
  BENCHMARKING_QA_VERIFY: "benchmarking.qa_verify",
  /** Regional reps confirming the right respondent per member store. */
  BENCHMARKING_RECIPIENT_CONFIRM: "benchmarking.recipient_confirm",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/**
 * The human name for each capability — one map, so a rename lands everywhere
 * at once.
 *
 * These are the bare nouns. A surface that lists capabilities across domains
 * (the grants board) composes its own "Benchmarking — " prefix; a surface
 * already inside one domain (the committee console) does not need it. Two
 * renderings of one vocabulary, rather than two vocabularies.
 */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  [CAPABILITIES.ELECTIONS_NOMINATING_REVIEW]: "Nominating committee",
  [CAPABILITIES.BENCHMARKING_COMMITTEE_LEAD]: "Committee lead",
  [CAPABILITIES.BENCHMARKING_CONTENT_REVIEW]: "Question review",
  [CAPABILITIES.BENCHMARKING_QA_VERIFY]: "Interpretation",
  [CAPABILITIES.BENCHMARKING_RECIPIENT_CONFIRM]: "Recipient confirmation",
};

/**
 * May this person enter /benchmarking/admin at all?
 *
 * A benchmarking invitation is a TASK, not committee membership: one
 * capability opens one door. Only Interpretation and the committee lead have
 * pages inside the back office, so only they get in (global admins bypass this
 * and are checked separately by each caller).
 *
 * Content review is deliberately absent. It used to be included, on the
 * reasoning that both jobs are "review" — the effect was that someone invited
 * to check twelve question wordings could also open every member store's
 * submission and rule on flagged figures. Question review's door is
 * /benchmarking/review, which is not in that shell.
 *
 * One function because the same rule is asked by the layout, by the two pages
 * that gate themselves, by the server auth context and by the browser-side
 * AuthProvider. When two of those disagreed, a content reviewer had real
 * access with no link to it and the flag queue had no lock of its own.
 */
export function opensBenchmarkingAdmin(capabilities: readonly string[]): boolean {
  return (
    capabilities.includes(CAPABILITIES.BENCHMARKING_QA_VERIFY) ||
    capabilities.includes(CAPABILITIES.BENCHMARKING_COMMITTEE_LEAD)
  );
}
