import { PERMISSION_LEVELS, type PermissionState, type UserOrganization, type GlobalRole } from "./types";

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
 * Derive the effective permission state from global role and org memberships.
 *
 * Permission hierarchy:
 * - super_admin: Global super admin
 * - admin: Global admin
 * - org_admin: Org admin of a MEMBER organization (has member-level access + editing)
 * - member: Regular member of a Member organization
 * - partner: Anyone associated with a Vendor Partner organization (including org_admins)
 * - public: Not logged in or no org association
 */
export function derivePermissionState(
  globalRole: GlobalRole,
  organizations: UserOrganization[]
): PermissionState {
  if (globalRole === "super_admin") return "super_admin";
  if (globalRole === "admin") return "admin";

  const activeOrgs = organizations.filter((uo) => uo.status === "active");
  const orgTypes = activeOrgs.map((uo) => uo.organization?.type).filter(Boolean);

  // Check if user is org_admin of a MEMBER organization
  const isMemberOrgAdmin = activeOrgs.some(
    (uo) => uo.role === "org_admin" && uo.organization?.type === "Member"
  );
  if (isMemberOrgAdmin) return "org_admin";

  // Member organization users (non-admin) get member permission
  if (orgTypes.includes("Member")) return "member";

  // Partner organization users (including org_admins) get partner permission
  if (orgTypes.includes("Vendor Partner")) return "partner";

  return "public";
}
