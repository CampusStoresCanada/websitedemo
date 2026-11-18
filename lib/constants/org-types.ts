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
  /**
   * A store or a vendor we would like to have, added by staff. Never joined,
   * never billed. Every reader that means "a member" or "a partner" matches
   * "Member" / "Vendor Partner" exactly, so a prospect stays out of billing,
   * renewals, benchmarking, listings and the match engine by construction.
   * Their pages are staff-only (app/org/[slug]): the people on them never
   * agreed to be listed anywhere.
   */
  prospectiveMember: "Prospective Member",
  prospectivePartner: "Prospective Partner",
} as const;

export type OrgType = (typeof ORG_TYPE)[keyof typeof ORG_TYPE];

export const PROSPECT_ORG_TYPES: readonly string[] = [ORG_TYPE.prospectiveMember, ORG_TYPE.prospectivePartner];

export function isProspectOrgType(type: string | null | undefined): boolean {
  return !!type && PROSPECT_ORG_TYPES.includes(type);
}
