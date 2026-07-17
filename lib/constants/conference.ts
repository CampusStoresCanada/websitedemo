/**
 * Conference registration constants — statuses, transitions, and option lists.
 *
 * All multi-select / radio options are defined here so forms and server
 * actions share a single source of truth.
 */

// ---------------------------------------------------------------------------
// Conference lifecycle
// ---------------------------------------------------------------------------

export const CONFERENCE_STATUSES = [
  "draft",
  "registration_open",
  "registration_closed",
  "scheduling",
  "active",
  "completed",
  "archived",
] as const;

export type ConferenceStatus = (typeof CONFERENCE_STATUSES)[number];

/** Allowed forward transitions — only admin/super_admin can execute. */
export const CONFERENCE_STATUS_TRANSITIONS: Record<ConferenceStatus, ConferenceStatus[]> = {
  draft: ["registration_open"],
  registration_open: ["registration_closed"],
  registration_closed: ["scheduling"],
  scheduling: ["active"],
  active: ["completed"],
  completed: ["archived"],
  archived: [],
};

/**
 * A conference is "on sale" once registration has opened. `draft` is the only
 * status that precedes sale, so before-sale edits (e.g. in-place legal document
 * edits) are only safe while the conference is still a draft.
 */
export function isConferenceOnSale(status: ConferenceStatus): boolean {
  return status !== "draft";
}

/** Human-readable labels for admin UI. */
export const CONFERENCE_STATUS_LABELS: Record<ConferenceStatus, string> = {
  draft: "Draft",
  registration_open: "Registration Open",
  registration_closed: "Registration Closed",
  scheduling: "Scheduling",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

// ---------------------------------------------------------------------------
// Registration types & statuses
// ---------------------------------------------------------------------------

export const REGISTRATION_TYPES = [
  "delegate",
  "exhibitor",
  "staff",
  "observer",
] as const;

export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

export const REGISTRATION_STATUSES = [
  "draft",
  "submitted",
  "confirmed",
  "canceled",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_STATUS_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  draft: ["submitted"],
  submitted: ["confirmed", "canceled"],
  confirmed: ["canceled"],
  canceled: [],
};

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  confirmed: "Confirmed",
  canceled: "Canceled",
};

// ---------------------------------------------------------------------------
// Partner / Exhibitor field options
// ---------------------------------------------------------------------------

export const MEETING_OUTCOME_OPTIONS = [
  "See new products",
  "Negotiate pricing",
  "Evaluate vendors",
  "Build relationships",
  "Explore partnerships",
  "Discuss logistics",
] as const;

export type MeetingOutcome = (typeof MEETING_OUTCOME_OPTIONS)[number];

export const MEETING_STRUCTURE_OPTIONS = [
  "10-min presentation",
  "Guided discussion",
  "Product demo",
  "Open Q&A",
  "Catalog walkthrough",
] as const;

export type MeetingStructure = (typeof MEETING_STRUCTURE_OPTIONS)[number];

export const BUYING_CYCLE_OPTIONS = [
  "Back-to-school",
  "Holiday",
  "Spring",
  "Summer",
  "Year-round",
] as const;

export type BuyingCycle = (typeof BUYING_CYCLE_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Delegate field options
// ---------------------------------------------------------------------------

export const FUNCTIONAL_ROLE_OPTIONS = [
  "GM Buyer",
  "Store Director",
  "Category Manager",
  "Procurement Officer",
  "Operations Manager",
  "Marketing Manager",
  "Finance Manager",
] as const;

export type FunctionalRole = (typeof FUNCTIONAL_ROLE_OPTIONS)[number];

export const PURCHASING_AUTHORITY_OPTIONS = [
  "Can sign",
  "Can commit",
  "Can recommend",
  "Research only",
] as const;

export type PurchasingAuthority = (typeof PURCHASING_AUTHORITY_OPTIONS)[number];

export const PRIORITY_OPTIONS = [
  "Margin improvement",
  "Sustainability",
  "New categories",
  "Digital transformation",
  "Cost reduction",
  "Student engagement",
] as const;

export type Priority = (typeof PRIORITY_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Travel / logistics options
// ---------------------------------------------------------------------------

export const SEAT_PREFERENCE_OPTIONS = [
  "Window",
  "Aisle",
  "No preference",
] as const;

export type SeatPreference = (typeof SEAT_PREFERENCE_OPTIONS)[number];

export const ACCOMMODATION_TYPE_OPTIONS = [
  "full",
  "meals_only",
  "none",
] as const;

export type AccommodationType = (typeof ACCOMMODATION_TYPE_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Legal document types
// ---------------------------------------------------------------------------

export const LEGAL_DOCUMENT_TYPES = [
  "code_of_conduct",
  "member_code_of_conduct",
  "terms_and_conditions",
  "refund_policy",
  "privacy_notice",
  "exhibitor_agreement",
  "speaker_agreement",
] as const;

export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

/**
 * Who accepts a policy, and when. Commercial/booth terms are accepted by the
 * BUYER at purchase (once, in total); personal conduct/release docs are accepted
 * by the ASSIGNEE when their seat is assigned and they activate. "both" means
 * each role accepts it at their respective moment (e.g. participation T&C).
 */
export const POLICY_ACCEPT_BY = ["buyer", "assignee", "both"] as const;
export type PolicyAcceptBy = (typeof POLICY_ACCEPT_BY)[number];
export const POLICY_ACCEPT_BY_LABELS: Record<PolicyAcceptBy, string> = {
  buyer: "Buyer (at purchase)",
  assignee: "Assignee (when their seat is assigned)",
  both: "Both",
};

const BUYER_DEFAULT_DOCS = new Set(["exhibitor_agreement", "refund_policy"]);
const BOTH_DEFAULT_DOCS = new Set(["terms_and_conditions"]);
/** Sensible default acceptance role for a new legal document type. */
export function defaultAcceptByForDocument(documentType: string): PolicyAcceptBy {
  if (BUYER_DEFAULT_DOCS.has(documentType)) return "buyer";
  if (BOTH_DEFAULT_DOCS.has(documentType)) return "both";
  return "assignee";
}

/**
 * Bridge a registration type to the audience tier(s) the registrant belongs to.
 * This is ONLY the registrant→audience link used to resolve which catalog
 * `policy` entities (via their `who` edges) a person must accept — the actual
 * targeting lives in the catalog graph (policy who/requires/applies_to_all),
 * not here. Matches the seeded audience entities' `source_role`.
 */
export function audienceRolesForRegistrationType(
  registrationType: RegistrationType
): string[] {
  return registrationType === "exhibitor" ? ["partner"] : ["member"];
}

export const LEGAL_DOCUMENT_LABELS: Record<LegalDocumentType, string> = {
  code_of_conduct: "Vendor Code of Conduct",
  member_code_of_conduct: "Member Code of Conduct",
  terms_and_conditions: "Terms & Conditions",
  refund_policy: "Refund Policy",
  privacy_notice: "Privacy Notice",
  exhibitor_agreement: "Exhibitor & Booth Agreement",
  speaker_agreement: "Speaker & Presenter Agreement",
};

// ---------------------------------------------------------------------------
// Visible conference statuses (public-facing)
// ---------------------------------------------------------------------------

export const PUBLIC_CONFERENCE_STATUSES: ConferenceStatus[] = [
  "registration_open",
  "registration_closed",
  "active",
  "completed",
];
