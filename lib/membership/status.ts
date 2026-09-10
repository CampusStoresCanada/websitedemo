import type { OrgMembershipStatus } from "./types";

// Pure status predicates — zero imports beyond ./types, safe to import from
// client components. Anything that touches the database (transitions, the
// RPC call) stays in state-machine.ts, which re-exports these names so
// existing server-side importers don't need to change.

/**
 * Orgs that appear to the world — the public directory, the map, the stats.
 *
 * ⛔ GRACE IS LISTED. A grace org is mid-renewal, not lapsed: renewals run
 * Aug–Oct and grace is precisely where an org sits while its invoice is in
 * flight. Withholding it publishes a directory that shrinks every autumn and
 * tells a visitor a real partner does not exist.
 *
 * ⚠️ It was excluded until 2026-09-10, and the effect was invisible because
 * nothing errored: searching "Calculators" on /partners ranked Randmar FIRST in
 * the API and then rendered a page without them, because the page only loads
 * publicly-listable orgs and Randmar is in grace. 29 of 75 partners and 20 of 52
 * member stores were absent from the public directory for the same reason.
 *
 * ⛔ Still NOT the same question as ORG_ACCESS_ACTIVE_STATUSES below, even though
 * the two now agree on grace. One asks "does this org appear to the world", the
 * other "is this org entitled". They were conflated once already in the partner
 * exports; keep them separate constants and change them separately, or the next
 * divergence will be a silent one.
 */
export const PUBLIC_LISTABLE_ORG_STATUSES: OrgMembershipStatus[] = [
  "active",
  "reactivated",
  "grace",
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

/**
 * Orgs whose membership currently ENTITLES them to things — the paid-up set.
 * Grace belongs here: a grace org is a member whose renewal is in flight, not
 * a lapsed one, and it keeps every entitlement until the gate moves it to
 * locked.
 *
 * ⛔ Not the same question as PUBLIC_LISTABLE_ORG_STATUSES above. That one asks
 * "does this org appear to the world"; this one asks "is this org a current
 * member". They were conflated in the partner exports, which quietly billed
 * partners for a member list that omitted every store mid-renewal.
 */
export const ORG_ACCESS_ACTIVE_STATUSES: OrgMembershipStatus[] = [
  "active",
  "grace",
  "reactivated",
];

/** Can this org access member/partner features? */
export function isOrgAccessActive(status: OrgMembershipStatus | null): boolean {
  return status !== null && ORG_ACCESS_ACTIVE_STATUSES.includes(status);
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
