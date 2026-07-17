/**
 * Pure predicates for the membership-renewal purchase gate. No DB access —
 * mirrors the convention in lib/conference/entity-pricing.ts of keeping the
 * eligibility logic testable and shared between addOfferToCart and
 * createConferenceCheckout (both need the same answer, independently).
 */

export const MEMBERSHIP_RENEWAL_KIND = "membership_renewal";

export type MembershipGateRef = {
  role: string;
  toEntityId: string;
  toKind: string;
};

/** Does this org's membership cover the conference's dates? */
export function membershipCoversConference(
  membershipExpiresAt: string | null,
  conferenceEndDate: string
): boolean {
  if (!membershipExpiresAt) return false;
  // Both are ISO date (or date-time) strings — lexicographic compare is
  // safe for YYYY-MM-DD-prefixed values.
  return membershipExpiresAt >= conferenceEndDate;
}

/**
 * Does this offer (e.g. a booth) `require` a membership-renewal entity?
 * Returns the target entity's id if so, else null.
 */
export function offerRequiresMembershipRenewal(
  offerRefs: MembershipGateRef[]
): string | null {
  const ref = offerRefs.find(
    (r) => r.role === "requires" && r.toKind === MEMBERSHIP_RENEWAL_KIND
  );
  return ref?.toEntityId ?? null;
}
