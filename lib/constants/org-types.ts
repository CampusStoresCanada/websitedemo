/**
 * Canonical `organizations.type` values, exactly as stored in the database.
 *
 * These are capitalized display strings, not slugs — a lowercase or
 * snake_case comparison silently matches nothing.
 */
export const ORG_TYPE = {
  member: "Member",
  vendorPartner: "Vendor Partner",
  nonMember: "Non-Member",
  supplier: "Supplier",
  staff: "Staff",
} as const;

export type OrgType = (typeof ORG_TYPE)[keyof typeof ORG_TYPE];
