import { hasNonMemberTag } from "@/lib/contacts/tags";

/**
 * Membership statuses that entitle an org's people to platform access —
 * a portal login and a Circle account.
 *
 * Lives here rather than in lib/circle/sync.ts (its original home) because
 * the same policy now gates two provisioning paths, and they must not be
 * allowed to drift: a contact who gets a Circle account should get a login,
 * and vice versa.
 */
export const ACCESS_ACTIVE_STATUSES = new Set(["active", "reactivated", "grace"]);

export type LoginSkipReason =
  | "no_email"
  | "non_member_tag"
  | "org_inactive";

export const LOGIN_SKIP_MESSAGES: Record<LoginSkipReason, string> = {
  no_email: "no email address on the contact",
  non_member_tag: "tagged as a non-member contact",
  org_inactive: "the organization's membership isn't active",
};

/**
 * Decide whether adding this contact should also provision them a login.
 *
 * Returns null when they qualify, or the reason they don't. Mirrors the gate
 * in enqueueNewContactCircleProvisioning exactly — see ACCESS_ACTIVE_STATUSES.
 */
export function loginSkipReason(params: {
  email?: string | null;
  contactType?: string[] | null;
  membershipStatus?: string | null;
}): LoginSkipReason | null {
  if (!params.email?.trim()) return "no_email";
  if (hasNonMemberTag(params.contactType)) return "non_member_tag";
  if (!ACCESS_ACTIVE_STATUSES.has(params.membershipStatus ?? "")) return "org_inactive";
  return null;
}
