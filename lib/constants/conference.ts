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
  "terms_and_conditions",
  "refund_policy",
  "privacy_notice",
] as const;

export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

export const LEGAL_DOCUMENT_LABELS: Record<LegalDocumentType, string> = {
  code_of_conduct: "Code of Conduct",
  terms_and_conditions: "Terms & Conditions",
  refund_policy: "Refund Policy",
  privacy_notice: "Privacy Notice",
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
