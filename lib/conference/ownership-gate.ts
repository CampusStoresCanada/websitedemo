/**
 * Pure predicate for the "must already own a specific thing" purchase gate —
 * mirrors the convention in lib/conference/membership-gate.ts of keeping
 * eligibility logic testable and shared between addOfferToCart and
 * createConferenceCheckout (both need the same answer, independently).
 *
 * Ownership is checked by identity, not by kind: Bronze ($6,000) and plain
 * Exhibitor ($4,000) booths are both `kind: "booth"`, but they're different
 * products with different bundled add-ons — a kind check can't tell them
 * apart, so this checks whether the org holds the SPECIFIC referenced
 * entity, or an instance_of it (e.g. Booth 100 satisfies a requirement
 * pointed at its type, Booth 600). An offer can carry multiple
 * `requires_ownership_of` refs (e.g. either Day Pass entity, or the Full
 * Conference Registration) — owning any ONE of them satisfies the gate.
 */

export const OWNERSHIP_ROLE = "requires_ownership_of";

export type OwnershipGateRef = {
  role: string;
  toEntityId: string;
};

/** The specific entity ids this offer requires ownership of (any one satisfies it). */
export function offerRequiresOwnershipOfEntityIds(offerRefs: OwnershipGateRef[]): string[] {
  return [...new Set(offerRefs.filter((r) => r.role === OWNERSHIP_ROLE).map((r) => r.toEntityId))];
}

/**
 * Does the org's held identity set (its own entity ids, plus each one's
 * instance_of parent) satisfy any of the required entity ids?
 */
export function ownershipRequirementSatisfied(
  requiredEntityIds: string[],
  heldIdentityIds: ReadonlySet<string>
): boolean {
  return requiredEntityIds.length === 0 || requiredEntityIds.some((id) => heldIdentityIds.has(id));
}

/** Expands a set of held entity ids to include each one's instance_of parent. */
export function expandWithInstanceOfParents(
  heldEntityIds: readonly string[],
  instanceOfParentByChild: ReadonlyMap<string, string>
): Set<string> {
  const expanded = new Set<string>(heldEntityIds);
  for (const id of heldEntityIds) {
    const parent = instanceOfParentByChild.get(id);
    if (parent) expanded.add(parent);
  }
  return expanded;
}
