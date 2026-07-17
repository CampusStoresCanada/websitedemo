import { getOptionalAuthContext, getIdentitySnapshot, type AuthContext } from "@/lib/auth/guards";
import type { ViewerLevel } from "./defaults";

/**
 * Context about who is viewing a page, used for visibility decisions.
 */
export interface ViewerContext {
  viewerLevel: ViewerLevel;
  userId: string | null;
  userEmail: string | null;
  /** Organization IDs the viewer is an active member of */
  viewerOrgIds: string[];
  /** Organization IDs the viewer is an org_admin of */
  viewerOrgAdminIds: string[];
}

/**
 * Derive ViewerLevel from an AuthContext's globalRole + org memberships.
 */
function deriveViewerLevel(ctx: AuthContext): ViewerLevel {
  const { globalRole } = ctx;

  if (globalRole === "super_admin") return "super_admin";
  if (globalRole === "admin") return "admin";

  return "authenticated";
}

/** Anonymous viewer — no auth required */
const ANONYMOUS_VIEWER: ViewerContext = {
  viewerLevel: "public",
  userId: null,
  userEmail: null,
  viewerOrgIds: [],
  viewerOrgAdminIds: [],
};

/**
 * Get the viewer context for the current request. Uses the auth guard
 * framework (getOptionalAuthContext) to determine who is viewing.
 *
 * Returns public-level context for anonymous users.
 */
export async function getViewerContext(): Promise<ViewerContext> {
  const ctx = await getOptionalAuthContext();

  if (!ctx) {
    return ANONYMOUS_VIEWER;
  }

  let viewerLevel = deriveViewerLevel(ctx);

  if (viewerLevel === "authenticated" && ctx.activeOrgIds.length > 0) {
    // Same-request memoized snapshot (already fetched by getOptionalAuthContext
    // above) — reads org type off it instead of a third, separate query.
    const snapshot = await getIdentitySnapshot();
    const orgRows =
      snapshot.status === "resolved" && !snapshot.orgsError
        ? (snapshot.organizations ?? [])
        : [];

    const typeByOrgId = new Map(
      orgRows.map((uo) => [uo.organization_id, uo.organization?.type])
    );

    const hasMemberOrg = ctx.activeOrgIds.some(
      (orgId) => typeByOrgId.get(orgId) === "Member"
    );
    const hasPartnerOrg = ctx.activeOrgIds.some(
      (orgId) => typeByOrgId.get(orgId) === "Vendor Partner"
    );
    const isMemberOrgAdmin = ctx.orgAdminOrgIds.some(
      (orgId) => typeByOrgId.get(orgId) === "Member"
    );

    if (isMemberOrgAdmin) {
      viewerLevel = "org_admin";
    } else if (hasMemberOrg) {
      viewerLevel = "member";
    } else if (hasPartnerOrg) {
      viewerLevel = "partner";
    }
  }

  return {
    viewerLevel,
    userId: ctx.userId,
    userEmail: ctx.userEmail ?? null,
    viewerOrgIds: ctx.activeOrgIds,
    viewerOrgAdminIds: ctx.orgAdminOrgIds,
  };
}
