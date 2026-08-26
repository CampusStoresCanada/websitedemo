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
