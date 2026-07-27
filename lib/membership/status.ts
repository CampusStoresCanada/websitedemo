import type { OrgMembershipStatus } from "./types";

// Pure status predicates — zero imports beyond ./types, safe to import from
// client components. Anything that touches the database (transitions, the
// RPC call) stays in state-machine.ts, which re-exports these names so
// existing server-side importers don't need to change.

export const PUBLIC_LISTABLE_ORG_STATUSES: OrgMembershipStatus[] = [
  "active",
  "reactivated",
];

/** Statuses for which the org's own profile page resolves at all.
 *  Excludes pre-onboarding (applied/approved/null) — those genuinely have
 *  nothing to show yet. Lapsed statuses (grace/locked/canceled) still
 *  resolve — they degrade to public-tier content instead of 404ing. */
export const ORG_PROFILE_RESOLVABLE_STATUSES: OrgMembershipStatus[] = [
  "active",
  "grace",
  "locked",
  "reactivated",
  "canceled",
];

/** Can this org access member/partner features? */
export function isOrgAccessActive(status: OrgMembershipStatus | null): boolean {
  return status !== null && ["active", "grace", "reactivated"].includes(status);
}

/** Should this org appear in public directories / map? */
export function isOrgPubliclyListable(status: OrgMembershipStatus | null): boolean {
  return status !== null && PUBLIC_LISTABLE_ORG_STATUSES.includes(status);
}

/** Is this org currently in a grace period? */
export function isOrgInGrace(status: OrgMembershipStatus | null): boolean {
  return status === "grace";
}

/** Can this org be reactivated (locked + within window)? */
export function canReactivate(
  status: OrgMembershipStatus | null,
  lockedAt: Date | null,
  reactivationDays: number
): boolean {
  if (status !== "locked" || !lockedAt) return false;
  const daysSinceLock =
    (Date.now() - lockedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceLock <= reactivationDays;
}

/**
 * Compute days remaining in grace period.
 * Returns null if not in grace or missing data.
 */
export function graceDaysRemaining(
  status: OrgMembershipStatus | null,
  gracePeriodStartedAt: Date | null,
  graceDays: number
): number | null {
  if (status !== "grace" || !gracePeriodStartedAt) return null;
  const elapsed =
    (Date.now() - gracePeriodStartedAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(graceDays - elapsed));
}
