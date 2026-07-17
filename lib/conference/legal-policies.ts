/**
 * Catalog-native legal targeting.
 *
 * A legal document is a `policy` entity in the conference catalog. WHICH
 * documents a given registrant must accept is derived from the entity graph,
 * never from a column on the legal table:
 *
 *   - universal: policy.attributes.applies_to_all === true  → everyone
 *   - audience:  policy --who--> an audience the person belongs to
 *   - offer:     an entity the person holds --requires--> policy
 *
 * A policy with none of these applies to no one (parked) — e.g. the Speaker
 * Agreement until a speaker touchpoint exists. This module is pure so it can be
 * unit-tested; the DB loading lives in lib/actions/conference-legal.ts.
 */

/** Who accepts a policy: the buyer at purchase, the assignee at activation, or both. */
export type AcceptBy = "buyer" | "assignee" | "both";

export type PolicyTargeting = {
  policyEntityId: string;
  /** policy.attributes.applies_to_all */
  appliesToAll: boolean;
  /** audience source_roles this policy is `who`-targeted at (e.g. ["member"]) */
  whoSourceRoles: string[];
  /** catalog entity ids that `requires` this policy (e.g. a registration type) */
  requiredByEntityIds: string[];
  /** who must accept it (policy.attributes.accept_by); null = applies to both roles */
  acceptBy: AcceptBy | null;
};

export type Registrant = {
  /** audience tiers the person belongs to (e.g. ["member"] or ["partner"]) */
  audienceSourceRoles: string[];
  /** catalog entity ids the person holds (registration / booth seats) */
  heldEntityIds: string[];
  /**
   * Which acceptance moment we're resolving for. Omit (self-serve registration)
   * to get every required doc regardless of role; set to "buyer" at checkout or
   * "assignee" at seat activation to get only that role's docs.
   */
  role?: "buyer" | "assignee";
};

/** Does this registrant have to accept this policy? */
export function isPolicyRequired(policy: PolicyTargeting, who: Registrant): boolean {
  // Role gate: when resolving for a specific acceptance moment, the policy must
  // be accepted by that role (or by both). Unset accept_by applies to either.
  if (who.role && policy.acceptBy && policy.acceptBy !== "both" && policy.acceptBy !== who.role) {
    return false;
  }

  if (policy.appliesToAll) return true;

  const audiences = new Set(who.audienceSourceRoles);
  if (policy.whoSourceRoles.some((role) => audiences.has(role))) return true;

  const held = new Set(who.heldEntityIds);
  if (policy.requiredByEntityIds.some((id) => held.has(id))) return true;

  return false;
}

/** The set of policy-entity ids a registrant must accept. */
export function requiredPolicyEntityIds(
  policies: PolicyTargeting[],
  who: Registrant
): Set<string> {
  return new Set(
    policies.filter((policy) => isPolicyRequired(policy, who)).map((p) => p.policyEntityId)
  );
}
