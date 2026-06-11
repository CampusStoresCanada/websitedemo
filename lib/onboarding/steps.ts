/**
 * Onboarding step definitions for all four personas.
 * No "use server" — safe to import from both server actions and client components.
 *
 * Personas:
 *   org_admin_member  — org admin of a Member (campus store) organization
 *   org_admin_partner — org admin of a Vendor Partner organization
 *   member_member     — regular user of a Member organization
 *   member_partner    — regular user of a Vendor Partner organization
 */

export const PERSONAS = [
  "org_admin_member",
  "org_admin_partner",
  "member_member",
  "member_partner",
] as const;

export type Persona = (typeof PERSONAS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Org Admin — Member store
// ─────────────────────────────────────────────────────────────────────────────

export const ORG_ADMIN_MEMBER_STEPS = [
  "session_1_welcome",
  "public_contact_email",
  "toolkit_tour",
  "profile_description",
  "profile_logo",
  "profile_hero",
  "profile_background",
  "profile_featured_product",
  "profile_links_docs",
  "contacts_sorted",
  "visibility_intro",
  "network_members",
  "network_partners",
  "events_discovery",
  "benchmarking_survey",
  "procurement",
  "opening_rfp",
] as const;

export type OrgAdminMemberStepKey = (typeof ORG_ADMIN_MEMBER_STEPS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Org Admin — Vendor Partner
// ─────────────────────────────────────────────────────────────────────────────

export const ORG_ADMIN_PARTNER_STEPS = [
  "session_1_welcome",
  "public_contact_email",
  "toolkit_tour",
  "profile_description",
  "profile_logo",
  "profile_hero",
  "profile_background",
  "profile_featured_product",
  "profile_links_docs",
  "profile_categories",
  "contacts_sorted",
  "visibility_intro",
  "network_members",
  "network_partners",
  "events_discovery",
] as const;

export type OrgAdminPartnerStepKey = (typeof ORG_ADMIN_PARTNER_STEPS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Member — Member organization (campus store employee)
// ─────────────────────────────────────────────────────────────────────────────

export const MEMBER_MEMBER_STEPS = [
  "session_1_welcome",
  "view_org_page",
  "toolkit_tour",
  "visibility_intro",
  "procurement",
  "network_members",
  "network_partners",
  "events_discovery",
  "my_suppliers",
] as const;

export type MemberMemberStepKey = (typeof MEMBER_MEMBER_STEPS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Member — Vendor Partner organization (vendor employee)
// ─────────────────────────────────────────────────────────────────────────────

export const MEMBER_PARTNER_STEPS = [
  "session_1_welcome",
  "view_org_page",
  "toolkit_tour",
  "visibility_intro",
  "network_members",
  "network_partners",
  "events_discovery",
  "my_market",
] as const;

export type MemberPartnerStepKey = (typeof MEMBER_PARTNER_STEPS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Union type covering all step keys across all personas
// ─────────────────────────────────────────────────────────────────────────────

export type AnyStepKey =
  | OrgAdminMemberStepKey
  | OrgAdminPartnerStepKey
  | MemberMemberStepKey
  | MemberPartnerStepKey;

// ─────────────────────────────────────────────────────────────────────────────
// Steps per persona — used by init and query functions
// ─────────────────────────────────────────────────────────────────────────────

export const STEPS_BY_PERSONA: Record<Persona, readonly string[]> = {
  org_admin_member: ORG_ADMIN_MEMBER_STEPS,
  org_admin_partner: ORG_ADMIN_PARTNER_STEPS,
  member_member: MEMBER_MEMBER_STEPS,
  member_partner: MEMBER_PARTNER_STEPS,
};

// ─────────────────────────────────────────────────────────────────────────────
// Steps that count toward "onboarding complete" per persona
// (excludes optional/conditional steps)
// ─────────────────────────────────────────────────────────────────────────────

export const CORE_STEPS_BY_PERSONA: Record<Persona, readonly string[]> = {
  org_admin_member: [
    "session_1_welcome",
    "public_contact_email",
    "toolkit_tour",
    "profile_logo",
    "contacts_sorted",
    "visibility_intro",
    "network_members",
    "network_partners",
    "events_discovery",
  ],
  org_admin_partner: [
    "session_1_welcome",
    "public_contact_email",
    "toolkit_tour",
    "profile_logo",
    "profile_links_docs",
    "profile_categories",
    "contacts_sorted",
    "visibility_intro",
    "network_members",
    "events_discovery",
  ],
  member_member: [
    "session_1_welcome",
    "toolkit_tour",
    "visibility_intro",
    "network_partners",
    "events_discovery",
  ],
  member_partner: [
    "session_1_welcome",
    "toolkit_tour",
    "visibility_intro",
    "network_members",
    "events_discovery",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Backward compat — some imports still use OrgAdminStepKey
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use OrgAdminMemberStepKey or OrgAdminPartnerStepKey */
export type OrgAdminStepKey = AnyStepKey;

/** @deprecated Use STEPS_BY_PERSONA */
export const ORG_ADMIN_STEPS = ORG_ADMIN_MEMBER_STEPS;
