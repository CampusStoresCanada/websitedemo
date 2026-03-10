import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { getIntegrationConfig } from "@/lib/policy/engine";
import type { GlobalRole } from "./types";

type AppSupabase = SupabaseClient<Database>;

export interface AuthContext {
  supabase: AppSupabase;
  userId: string;
  userEmail: string | null;
  globalRole: GlobalRole;
  isBenchmarkingReviewer: boolean;
  orgAdminOrgIds: string[];
  activeOrgIds: string[];
}

export interface GuardFailure {
  ok: false;
  status: 401 | 403;
  error: string;
}

export interface GuardSuccess {
  ok: true;
  ctx: AuthContext;
}

export type GuardResult = GuardSuccess | GuardFailure;

const AUTHZ_QUERY_RETRIES = 3;
const AUTHZ_RETRY_BASE_MS = 200;
const AUTH_TRACE = process.env.NODE_ENV === "development";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadAuthContext(supabase?: AppSupabase): Promise<AuthContext | null> {
  const client = supabase ?? (await createClient());

  // Use getClaims() for local JWT validation — instant, never hangs.
  // NEVER use getUser() on server side — it makes a network request that can hang.
  // eslint-disable-next-line no-restricted-syntax
  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  const userEmail = (claimsData?.claims?.email as string | undefined) ?? null;

  if (claimsError || !userId) {
    return null;
  }
  let profileResult: { data: { global_role: string | null; is_benchmarking_reviewer: boolean | null } | null; error: unknown } | null = null;
  let orgsResult: { data: { organization_id: string; role: string }[] | null; error: unknown } | null = null;

  for (let attempt = 1; attempt <= AUTHZ_QUERY_RETRIES; attempt += 1) {
    const [profileRes, orgsRes] = await Promise.all([
      client
        .from("profiles")
        .select("global_role, is_benchmarking_reviewer")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("user_organizations")
        .select("organization_id, role")
        .eq("user_id", userId)
        .eq("status", "active"),
    ]);

    profileResult = profileRes;
    orgsResult = orgsRes;

    if (!profileRes.error && !orgsRes.error) {
      break;
    }

    if (attempt < AUTHZ_QUERY_RETRIES) {
      const delayMs = AUTHZ_RETRY_BASE_MS * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }

  if (!profileResult || !orgsResult || profileResult.error || orgsResult.error) {
    console.error("[auth/guards] authorization context query failed", {
      userId,
      profileError: profileResult?.error ?? null,
      orgsError: orgsResult?.error ?? null,
    });
    throw new Error("Authorization context unavailable");
  }

  const globalRole = (profileResult.data?.global_role as GlobalRole | null) ?? "user";
  const isBenchmarkingReviewer =
    profileResult.data?.is_benchmarking_reviewer === true;
  const activeOrgIds = (orgsResult.data ?? []).map((uo) => uo.organization_id);
  const orgAdminOrgIds = (orgsResult.data ?? [])
    .filter((uo) => uo.role === "org_admin")
    .map((uo) => uo.organization_id);

  return {
    supabase: client,
    userId,
    userEmail,
    globalRole,
    isBenchmarkingReviewer,
    orgAdminOrgIds,
    activeOrgIds,
  };
}

export async function getOptionalAuthContext(): Promise<AuthContext | null> {
  return loadAuthContext();
}

export function isGlobalAdmin(role: GlobalRole): boolean {
  return role === "admin" || role === "super_admin";
}

export function isSuperAdmin(role: GlobalRole): boolean {
  return role === "super_admin";
}

export function canManageOrganization(ctx: AuthContext, organizationId: string): boolean {
  return isSuperAdmin(ctx.globalRole) || ctx.orgAdminOrgIds.includes(organizationId);
}

export async function requireAuthenticated(): Promise<GuardResult> {
  try {
    const ctx = await loadAuthContext();
    if (!ctx) {
      if (AUTH_TRACE) {
        console.warn("[auth/guards] unauthenticated: no user session");
      }
      return { ok: false, status: 401, error: "Not authenticated" };
    }
    if (AUTH_TRACE) {
      console.info("[auth/guards] authenticated", {
        userId: ctx.userId,
        role: ctx.globalRole,
        activeOrgCount: ctx.activeOrgIds.length,
        orgAdminCount: ctx.orgAdminOrgIds.length,
      });
    }
    return { ok: true, ctx };
  } catch (error) {
    console.error("[auth/guards] requireAuthenticated failed", error);
    await logAuditEventSafe({
      action: "auth_guard_error",
      entityType: "auth_guard",
      actorType: "system",
      details: {
        guard: "requireAuthenticated",
        status: 401,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      ok: false,
      status: 401,
      error: "Authorization check failed. Please sign in again.",
    };
  }
}

export async function requireAdmin(): Promise<GuardResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return auth;
  if (!isGlobalAdmin(auth.ctx.globalRole)) {
    if (AUTH_TRACE) {
      console.warn("[auth/guards] requireAdmin denied", {
        userId: auth.ctx.userId,
        role: auth.ctx.globalRole,
      });
    }
    await logAuditEventSafe({
      action: "auth_guard_denied",
      entityType: "auth_guard",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        guard: "requireAdmin",
        reason: "missing_admin_role",
        status: 403,
        role: auth.ctx.globalRole,
      },
    });
    return { ok: false, status: 403, error: "Admin access required" };
  }
  if (AUTH_TRACE) {
    console.info("[auth/guards] requireAdmin granted", {
      userId: auth.ctx.userId,
      role: auth.ctx.globalRole,
    });
  }
  return auth;
}

export async function requireSuperAdmin(): Promise<GuardResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return auth;
  if (!isSuperAdmin(auth.ctx.globalRole)) {
    await logAuditEventSafe({
      action: "auth_guard_denied",
      entityType: "auth_guard",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        guard: "requireSuperAdmin",
        reason: "missing_super_admin_role",
        status: 403,
        role: auth.ctx.globalRole,
      },
    });
    return { ok: false, status: 403, error: "Super admin access required" };
  }
  return auth;
}

export async function requireConferenceOpsAccess(): Promise<GuardResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return auth;

  if (isGlobalAdmin(auth.ctx.globalRole)) {
    return auth;
  }

  try {
    const integration = await getIntegrationConfig();
    const allowlist = integration.conference_ops_masthead_org_ids ?? [];
    const hasAllowedOpsOrg = auth.ctx.orgAdminOrgIds.some((orgId) =>
      allowlist.includes(orgId)
    );
    if (!hasAllowedOpsOrg) {
      await logAuditEventSafe({
        action: "auth_guard_denied",
        entityType: "auth_guard",
        actorId: auth.ctx.userId,
        actorType: "user",
        details: {
          guard: "requireConferenceOpsAccess",
          reason: "missing_masthead_ops_allowlist_membership",
          status: 403,
          role: auth.ctx.globalRole,
          orgAdminOrgIds: auth.ctx.orgAdminOrgIds,
        },
      });
      return {
        ok: false,
        status: 403,
        error: "Conference ops access required",
      };
    }
    return auth;
  } catch (error) {
    console.error("[auth/guards] requireConferenceOpsAccess failed", error);
    await logAuditEventSafe({
      action: "auth_guard_error",
      entityType: "auth_guard",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        guard: "requireConferenceOpsAccess",
        status: 403,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      ok: false,
      status: 403,
      error: "Conference ops access required",
    };
  }
}

export async function requireReviewerOrAdmin(): Promise<GuardResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return auth;
  if (!isGlobalAdmin(auth.ctx.globalRole) && !auth.ctx.isBenchmarkingReviewer) {
    return { ok: false, status: 403, error: "Reviewer access required" };
  }
  return auth;
}

export async function requireOrgAdminOrSuperAdmin(
  organizationId: string
): Promise<GuardResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return auth;
  if (!canManageOrganization(auth.ctx, organizationId)) {
    return {
      ok: false,
      status: 403,
      error: "Not authorized for this organization",
    };
  }
  return auth;
}
