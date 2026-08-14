import { PERMISSION_LEVELS, type PermissionState, type UserOrganization, type GlobalRole } from "./types";
import { isOrgAccessActive } from "@/lib/membership/status";
import { resolveOrgLevel, resolveMembershipStatus } from "./org-level";
import type { MembershipProgramDef } from "@/lib/policy/types";

/**
 * Check if a permission level meets or exceeds the required level.
 *
 * Note: survey_participant is a special case - it requires org_admin level
 * AND verification that the user's org has benchmarking data. For now, we
 * treat it as equivalent to org_admin; full verification will be added later.
 */
export function hasPermission(
  current: PermissionState,
  required: PermissionState
): boolean {
  // survey_participant requires at least org_admin level
  const effectiveRequired = required === "survey_participant" ? "org_admin" : required;
  return PERMISSION_LEVELS[current] >= PERMISSION_LEVELS[effectiveRequired];
}

/**
 * Check if a user can edit a specific organization.
 * True for: org admins of that org, global admins, super admins.
 */
export function canEditOrganization(
  globalRole: GlobalRole,
  organizations: UserOrganization[],
  orgId: string
): boolean {
  if (globalRole === "super_admin" || globalRole === "admin") return true;

  return organizations.some(
    (uo) =>
      uo.organization_id === orgId &&
      uo.role === "org_admin" &&
      uo.status === "active"
  );
}

/**
 * Check if a user can approve/reject applications for a specific organization.
 * True for: org admins of that org, global admins, super admins.
 */
export function canApproveUsers(
  globalRole: GlobalRole,
  organizations: UserOrganization[],
  orgId: string
): boolean {
  return canEditOrganization(globalRole, organizations, orgId);
}

/**
 * Check if a user can manage admin roles (promote/demote admins).
 * True for: super admins only.
 */
export function canManageAdmins(globalRole: GlobalRole): boolean {
  return globalRole === "super_admin";
}

/**
 * Check if a user can create new organizations.
 * True for: admins and super admins.
 */
export function canCreateOrganizations(globalRole: GlobalRole): boolean {
  return globalRole === "super_admin" || globalRole === "admin";
}

/**
 * Check if a user can flag content as outdated/incorrect.
 * True for: any authenticated user.
 */
export function canFlagContent(isAuthenticated: boolean): boolean {
  return isAuthenticated;
}

/**
 * Derive the effective permission state from global role, org memberships,
 * and the configured membership programs (lib/policy/types.ts —
 * MembershipProgramDef, resolved via getProgramsConfig()). Each program
 * maps an organizations.type value to a permission level and whether its
 * org_admins get elevated access — this is CSC-configured today to
 * reproduce the historical "Member"/"Vendor Partner" hardcoding exactly,
 * including the existing quirk that Vendor Partner org_admins do NOT get
 * elevated org_admin permission (page-level elevation for them instead
 * comes from PageOwnerProvider on their own org pages).
 *
 * Permission hierarchy:
 * - super_admin: Global super admin
 * - admin: Global admin
 * - org_admin: Org admin of a program whose orgAdminElevates is true
 * - member: Active member of a "member"-permissionLevel program
 * - partner: Active member of a "partner"-permissionLevel program
 * - public: Not logged in, or no org association resolving to a program
 */
export function derivePermissionState(
  globalRole: GlobalRole,
  organizations: UserOrganization[],
  programs: MembershipProgramDef[]
): PermissionState {
  if (globalRole === "super_admin") return "super_admin";
  if (globalRole === "admin") return "admin";

  // A lapsed org (locked/canceled) shouldn't confer member/partner/org_admin
  // tier just because the user's own link to it is still "active" — the
  // ORG's own access has to be active too, or this only ever narrows
  // (never expands) what the user already had.
  const activeOrgs = organizations.filter(
    (uo) => uo.status === "active" && isOrgAccessActive(resolveMembershipStatus(uo.organization, programs))
  );

  const level = resolveOrgLevel(
    activeOrgs.map((uo) => ({ orgType: uo.organization?.type, isOrgAdmin: uo.role === "org_admin" })),
    programs
  );

  return level ?? "public";
}
