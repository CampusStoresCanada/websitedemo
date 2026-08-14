import type { MembershipProgramDef } from "@/lib/policy/types";
import type { OrgMembershipStatus } from "@/lib/membership/types";

/**
 * The facts `resolveOrgLevel` needs about one active org membership —
 * callers pre-filter to active-only memberships themselves (their
 * "active" definitions differ slightly in shape upstream, though not in
 * meaning) and pass in just what's needed to resolve a program-driven
 * level, so this stays a pure function with no DB/auth-context coupling.
 */
export interface OrgMembershipFacts {
  orgType: string | null | undefined;
  isOrgAdmin: boolean;
}

export type OrgLevel = "org_admin" | "member" | "partner";

/**
 * Single source of truth for turning a set of active org memberships into
 * a program-driven level — replaces what used to be three independent
 * copies of literal `"Member"`/`"Vendor Partner"` string checks
 * (lib/auth/permissions.ts's derivePermissionState, lib/visibility/viewer.ts's
 * getViewerContext, and the isSurveyParticipant checks in AuthProvider.tsx/
 * app/layout.tsx). Returns null when no membership resolves to any level —
 * callers map that to their own baseline ("public" for PermissionState,
 * "authenticated" for ViewerLevel — these aren't the same enum).
 *
 * Precedence matches the pre-generalization behavior exactly: an
 * elevating org_admin membership wins outright, then "member"-level
 * programs beat "partner"-level ones when a viewer somehow has both.
 */
export function resolveOrgLevel(
  memberships: OrgMembershipFacts[],
  programs: MembershipProgramDef[]
): OrgLevel | null {
  const programByType = new Map(programs.map((p) => [p.orgTypeValue, p]));

  const hasElevatingAdmin = memberships.some(
    (m) => m.isOrgAdmin && programByType.get(m.orgType ?? "")?.orgAdminElevates
  );
  if (hasElevatingAdmin) return "org_admin";

  const hasLevel = (level: "member" | "partner") =>
    memberships.some((m) => programByType.get(m.orgType ?? "")?.permissionLevel === level);

  if (hasLevel("member")) return "member";
  if (hasLevel("partner")) return "partner";

  return null;
}

/**
 * Phase 4 Stage 1: resolve an org's current membership-lifecycle status
 * (active/grace/locked/...) from its `memberships` row(s) — the entity
 * now responsible for that fact — falling back to the org's own
 * `membership_status` column if no matching row exists (e.g. a query that
 * didn't embed `memberships`, or an org type with no configured program).
 * Single choke point for lib/auth/permissions.ts's derivePermissionState
 * and lib/visibility/viewer.ts's getViewerContext, which both previously
 * read `organization.membership_status` directly.
 */
export function resolveMembershipStatus(
  organization:
    | {
        type: string;
        membership_status: OrgMembershipStatus | null;
        memberships?: { status: OrgMembershipStatus; program_key: string }[];
      }
    | null
    | undefined,
  programs: MembershipProgramDef[]
): OrgMembershipStatus | null {
  if (!organization) return null;

  const programKey = programs.find((p) => p.orgTypeValue === organization.type)?.key;
  const matched = organization.memberships?.find((m) => m.program_key === programKey);

  return matched?.status ?? organization.membership_status ?? null;
}
