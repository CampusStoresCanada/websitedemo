/**
 * Capability keys as seeded in `governance_role_capabilities`.
 *
 * Authority in this system is role-derived: a person holds a role on a
 * governance body (`governance_role_assignments`), the role maps to
 * capabilities, and `has_capability()` / `current_capabilities()` resolve the
 * two. There is deliberately no per-person capability flag — a capability
 * follows the office and expires with the term rather than needing to be
 * revoked by hand when someone steps down.
 *
 * Mirrors lib/constants/org-types.ts. Keep these strings in step with the
 * seeded rows; a typo here resolves to "holds nothing" rather than erroring.
 */
export const CAPABILITY = {
  benchmarkingCommitteeLead: "benchmarking.committee_lead",
  benchmarkingContentReview: "benchmarking.content_review",
  benchmarkingQaVerify: "benchmarking.qa_verify",
  benchmarkingRecipientConfirm: "benchmarking.recipient_confirm",
  electionsNominatingReview: "elections.nominating_review",
} as const;

export type Capability = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/** Role keys on governance bodies, as seeded in governance_role_capabilities. */
export const GOVERNANCE_ROLE = {
  benchmarkingReviewer: "benchmarking_reviewer",
} as const;

/** Body keys in `governance_bodies`. */
export const GOVERNANCE_BODY = {
  benchmarkingCommittee: "benchmarking_committee",
} as const;
