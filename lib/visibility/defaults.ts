import type { VisibilityConfig } from "../policy/types";

/**
 * Viewer level for visibility checks.
 * Maps directly to PermissionState but without survey_participant.
 */
export type ViewerLevel =
  | "public"
  | "authenticated"
  | "partner"
  | "member"
  | "org_admin"
  | "admin"
  | "super_admin";

/**
 * Default visibility configuration used when policy keys are not yet seeded.
 * Matches the intended v1 behavior per chunk-08-visibility.md spec.
 */
export const DEFAULT_VISIBILITY_CONFIG: VisibilityConfig = {
  public_allowlist: [
    // Organization — public fields
    "organizations.name",
    "organizations.slug",
    "organizations.type",
    "organizations.logo_url",
    "organizations.logo_horizontal_url",
    "organizations.banner_url",
    "organizations.hero_image_url",
    "organizations.product_overlay_url",
    "organizations.city",
    "organizations.province",
    "organizations.country",
    "organizations.primary_category",
    "organizations.company_description",
    "organizations.website",
    "organizations.action_link_url",
    "organizations.action_link_text",
    "organizations.catalogue_url",
    "organizations.square_footage",
    "organizations.fte",
    "organizations.membership_status",
    "organizations.annual_revenue",
    "organizations.student_count",
    // Contacts
    "contacts.profile_picture_url",
    // Benchmarking — summary-level fields
    "benchmarking.institution_type",
    "benchmarking.enrollment_fte",
    "benchmarking.num_store_locations",
    "benchmarking.total_square_footage",
    "benchmarking.pos_system",
    "benchmarking.fulltime_employees",
  ],

  private_fields: [
    // Contacts — system fields (not PII, needed for UI logic)
    "contacts.circle_id",
    // Contacts — PII
    "contacts.name",
    "contacts.work_email",
    "contacts.email",
    "contacts.work_phone_number",
    "contacts.phone",
    "contacts.role_title",
    "contacts.notes",
    // Organization — sensitive
    "organizations.email",
    "organizations.phone",
    "organizations.purolator_account",
    "organizations.stripe_customer_id",
    "organizations.quickbooks_customer_id",
  ],

  masked_reveal_fields: [
    "contacts.name",
    "contacts.work_email",
    "contacts.email",
    "contacts.work_phone_number",
    "contacts.phone",
  ],

  masking_rules: {
    "contacts.name": { mode: "initials" },
    "contacts.work_email": { mode: "email_domain" },
    "contacts.email": { mode: "email_domain" },
    "contacts.work_phone_number": { mode: "phone_prefix", visible_digits: 6 },
    "contacts.phone": { mode: "phone_prefix", visible_digits: 6 },
  },
};

export interface CrossVisibilityRules {
  member_to_partner_fields: string[];
  partner_to_member_fields: string[];
}

export const DEFAULT_CROSS_VISIBILITY_RULES: CrossVisibilityRules = {
  // Member viewers can see selected partner-facing sales fields.
  member_to_partner_fields: [
    "organizations.company_description",
    "organizations.primary_category",
    "contacts.role_title",
  ],
  // Partner viewers can see selected member purchasing-facing fields.
  partner_to_member_fields: [
    "organizations.procurement_info",
    "benchmarking.institution_type",
    "benchmarking.enrollment_fte",
    "benchmarking.num_store_locations",
    "benchmarking.total_square_footage",
  ],
};
