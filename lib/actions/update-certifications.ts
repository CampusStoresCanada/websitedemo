"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getServerAuthState } from "@/lib/auth/server";
import { canEditOrganization } from "@/lib/auth/permissions";
import { CERTIFICATION_NAMES, CANCOLL_CERT } from "@/lib/certifications";
import { mirrorFieldsToMembership } from "@/lib/membership/mirror";

interface UpdateCertificationsResult {
  success: boolean;
  error?: string;
}

/**
 * Update certifications for an organization.
 * Org admins can update their own org. Admins/super admins can update any.
 */
export async function updateCertifications(
  orgId: string,
  certifications: string[]
): Promise<UpdateCertificationsResult> {
  const auth = await getServerAuthState();

  if (!auth.user) {
    return { success: false, error: "Not authenticated" };
  }

  // Same question every other org write asks: does this person administrate
  // this org? `canEditOrganization` is that question — it reads the org LINK
  // role, exactly like updateField's canManageOrganization.
  //
  // ⛔ This used to additionally require hasPermission(permissionState,
  // "org_admin"), and that conjunct rejected every Vendor Partner org admin:
  // derivePermissionState resolves them to "partner" (level 1, below
  // org_admin's 3) because the partner program carries orgAdminElevates:
  // false. Partners are the entire audience for these badges, and the toggle
  // grid renders off the org link role, so the chips were live, the save was
  // refused, and the optimistic flip rolled back — reported as "editing
  // certifications just doesn't work" (GROSCHE, 2026-09-18). Every other
  // field on the same page saved fine, because no other action consults
  // permissionState. This was the only one that did.
  if (!canEditOrganization(auth.globalRole, auth.organizations, orgId)) {
    return { success: false, error: "Insufficient permissions" };
  }

  const supabase = createAdminClient();

  // CANCOLL shares this array but is NOT in CERTIFICATION_NAMES — it's
  // admin-managed (updateCancollStatus / setCANCOLLMembership), not
  // self-declared. It used to reach the validation below and fail it, rejecting
  // the ENTIRE save: the 9 partners whose array carries "CANCOLL" could not
  // toggle any badge at all. Strip it from the incoming list, validate the rest,
  // then restore whatever the row actually holds — so this path can neither
  // grant nor revoke CANCOLL, which is the property the validation was
  // protecting in the first place.
  const declared = certifications.filter((c) => c !== CANCOLL_CERT.name);

  const invalid = declared.filter((c) => !CERTIFICATION_NAMES.includes(c));
  if (invalid.length > 0) {
    return { success: false, error: `Unknown certifications: ${invalid.join(", ")}` };
  }

  const { data: existing, error: readError } = await supabase
    .from("organizations")
    .select("certifications")
    .eq("id", orgId)
    .single();

  if (readError) {
    console.error("[updateCertifications] read error:", readError);
    return { success: false, error: "Failed to update certifications" };
  }

  const hadCancoll =
    Array.isArray(existing?.certifications) &&
    (existing.certifications as string[]).includes(CANCOLL_CERT.name);

  const next = hadCancoll ? [CANCOLL_CERT.name, ...declared] : declared;

  const { error } = await supabase
    .from("organizations")
    .update({ certifications: next })
    .eq("id", orgId);

  if (error) {
    console.error("[updateCertifications] DB error:", error);
    return { success: false, error: "Failed to update certifications" };
  }

  return { success: true };
}

/**
 * Update CANCOLL status for an organization.
 * Admin/super_admin only.
 */
export async function updateCancollStatus(
  orgId: string,
  isCancollMember: boolean
): Promise<UpdateCertificationsResult> {
  const auth = await getServerAuthState();

  if (!auth.user) {
    return { success: false, error: "Not authenticated" };
  }

  const isAdmin = auth.globalRole === "admin" || auth.globalRole === "super_admin";
  if (!isAdmin) {
    return { success: false, error: "Admin access required" };
  }

  const supabase = createAdminClient();

  // Fetch current certifications so we can add/remove CANCOLL without touching others
  const { data: org } = await supabase
    .from("organizations")
    .select("certifications")
    .eq("id", orgId)
    .single();

  const current: string[] = Array.isArray(org?.certifications) ? (org.certifications as string[]) : [];
  const updated = isCancollMember
    ? current.includes("CANCOLL") ? current : [...current, "CANCOLL"]
    : current.filter((c) => c !== "CANCOLL");

  const { error } = await supabase
    .from("organizations")
    .update({ is_cancoll_member: isCancollMember, certifications: updated })
    .eq("id", orgId);

  if (error) {
    console.error("[updateCancollStatus] DB error:", error);
    return { success: false, error: "Failed to update CANCOLL status" };
  }

  // Phase 4 Stage 2a: mirror into `memberships` ahead of the Stage 2 billing
  // cutover. Deliberately mirrors `is_cancoll_member` only — unlike
  // setCANCOLLMembership (lib/actions/sponsorship.ts), this path does not
  // touch `cancoll_tier` on `organizations`, so the mirror must not either,
  // or the two tables would disagree in the opposite direction.
  await mirrorFieldsToMembership(
    orgId,
    { is_cancoll_member: isCancollMember },
    { source: "updateCancollStatus" }
  );

  return { success: true };
}
