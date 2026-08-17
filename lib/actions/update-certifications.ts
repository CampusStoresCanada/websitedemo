"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getServerAuthState } from "@/lib/auth/server";
import { hasPermission } from "@/lib/auth/permissions";
import { CERTIFICATION_NAMES } from "@/lib/certifications";
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

  const isAdmin = auth.globalRole === "admin" || auth.globalRole === "super_admin";
  const isOrgAdmin =
    hasPermission(auth.permissionState, "org_admin") &&
    auth.organizations.some(
      (uo) => uo.organization_id === orgId && uo.role === "org_admin" && uo.status === "active"
    );

  if (!isAdmin && !isOrgAdmin) {
    return { success: false, error: "Insufficient permissions" };
  }

  // Validate — only allow known certification names
  const invalid = certifications.filter((c) => !CERTIFICATION_NAMES.includes(c));
  if (invalid.length > 0) {
    return { success: false, error: `Unknown certifications: ${invalid.join(", ")}` };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("organizations")
    .update({ certifications })
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
