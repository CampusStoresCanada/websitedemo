import { getOptionalAuthContext, getIdentitySnapshot, type AuthContext } from "@/lib/auth/guards";
import type { ViewerLevel } from "./defaults";
import { isOrgAccessActive } from "@/lib/membership/status";
import { resolveOrgLevel, resolveMembershipStatus } from "@/lib/auth/org-level";
import { getProgramsConfig } from "@/lib/policy/engine";

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
    const [snapshot, programs] = await Promise.all([getIdentitySnapshot(), getProgramsConfig()]);
    const orgRows =
      snapshot.status === "resolved" && !snapshot.orgsError
        ? (snapshot.organizations ?? [])
        : [];

    const typeByOrgId = new Map(
      orgRows.map((uo) => [uo.organization_id, uo.organization?.type])
    );
    const statusByOrgId = new Map(
      orgRows.map((uo) => [uo.organization_id, resolveMembershipStatus(uo.organization, programs)])
    );

    // A lapsed org (locked/canceled) shouldn't elevate the viewer's masking
    // level on OTHER orgs' pages either — only an org whose own access is
    // active counts here.
    const activeMemberships = ctx.activeOrgIds
      .filter((orgId) => isOrgAccessActive(statusByOrgId.get(orgId) ?? null))
      .map((orgId) => ({
        orgType: typeByOrgId.get(orgId),
        isOrgAdmin: ctx.orgAdminOrgIds.includes(orgId),
      }));

    const resolved = resolveOrgLevel(activeMemberships, programs);
    if (resolved) viewerLevel = resolved;
  }

  return {
    viewerLevel,
    userId: ctx.userId,
    userEmail: ctx.userEmail ?? null,
    viewerOrgIds: ctx.activeOrgIds,
    viewerOrgAdminIds: ctx.orgAdminOrgIds,
  };
}

/**
 * Viewer context for an ORG PAGE — the plain viewer context plus the
 * "I'm looking at my own org" elevation.
 *
 * Only ever raises the floor to "org_admin", never lowers it: a CSC global
 * admin who also belongs to this org keeps their higher level. A lapsed org
 * gets no elevation at all — its own people see exactly the public view until
 * it reactivates (getOrganizationForViewer enforces that independently too).
 *
 * Lives here rather than in the page because the org page is no longer the
 * only reader: the toolkit's Contacts CSV export has to resolve the viewer
 * identically or the file disagrees with the screen it was exported from.
 */
export async function getOrgPageViewerContext(slug: string): Promise<{
  /** The viewer as they are everywhere else — NOT elevated. */
  viewer: ViewerContext;
  /** The viewer as this org's page should treat them. */
  effectiveViewer: ViewerContext;
  org: { id: string; membership_status: string | null; public_code: string | null } | null;
  orgAccessActive: boolean;
}> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const viewer = await getViewerContext();

  const { data: org } = await createAdminClient()
    .from("organizations")
    .select("id, membership_status, public_code")
    .eq("slug", slug)
    .maybeSingle();

  const isAlreadyCscAdmin =
    viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";
  const orgAccessActive = isOrgAccessActive(
    (org?.membership_status as Parameters<typeof isOrgAccessActive>[0]) ?? null
  );

  const effectiveViewer =
    org && viewer.viewerOrgIds.includes(org.id) && !isAlreadyCscAdmin && orgAccessActive
      ? { ...viewer, viewerLevel: "org_admin" as const }
      : viewer;

  return { viewer, effectiveViewer, org: org ?? null, orgAccessActive };
}
