import type { EventAudienceMode } from "./types";

type GlobalRole = "super_admin" | "admin" | "org_admin" | "member" | "partner" | "public";

/**
 * Returns true if a user with the given global_role can see an event
 * with the given audience_mode.
 *
 * Pass null/undefined for unauthenticated visitors.
 */
export function canSeeEvent(
  audienceMode: EventAudienceMode,
  globalRole: GlobalRole | null | undefined
): boolean {
  switch (audienceMode) {
    case "public":
      return true;

    case "members_and_partners":
      return !!globalRole && globalRole !== "public";

    case "members":
      // members, org_admins, and CSC admins — not partners
      return !!globalRole && ["member", "org_admin", "admin", "super_admin"].includes(globalRole);

    case "partners":
      // partners, org_admins, and CSC admins
      return !!globalRole && ["partner", "org_admin", "admin", "super_admin"].includes(globalRole);

    case "org_admin":
      return !!globalRole && ["org_admin", "admin", "super_admin"].includes(globalRole);

    case "board":
      return !!globalRole && ["admin", "super_admin"].includes(globalRole);

    default:
      return false;
  }
}
