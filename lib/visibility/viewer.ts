import { getOptionalAuthContext, type AuthContext } from "@/lib/auth/guards";
import type { ViewerLevel } from "./defaults";

/**
 * Context about who is viewing a page, used for visibility decisions.
 */
export interface ViewerContext {
  viewerLevel: ViewerLevel;
  userId: string | null;
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

  return "public";
}

/** Anonymous viewer — no auth required */
const ANONYMOUS_VIEWER: ViewerContext = {
  viewerLevel: "public",
  userId: null,
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

  if (viewerLevel === "public" && ctx.activeOrgIds.length > 0) {
    const { data: orgTypes } = await ctx.supabase
      .from("organizations")
      .select("id, type")
      .in("id", ctx.activeOrgIds);

    const typeByOrgId = new Map(
      (orgTypes ?? []).map((row) => [row.id, row.type])
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
    viewerOrgIds: ctx.activeOrgIds,
    viewerOrgAdminIds: ctx.orgAdminOrgIds,
  };
}
