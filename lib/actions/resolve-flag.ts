"use server";

import {
  canManageOrganization,
  isSuperAdmin,
  requireAuthenticated,
} from "@/lib/auth/guards";

interface ResolveFlagParams {
  flagId: string;
  resolution: "resolved" | "dismissed";
  notes?: string;
}

interface ResolveFlagResult {
  success: boolean;
  error?: string;
}

/**
 * Resolve or dismiss a flag.
 * Used by the global Toolkit Edit feature after fixing flagged content.
 *
 * Security:
 * - Only admins (super_admin or org_admin for the org) can resolve flags
 */
export async function resolveFlag({
  flagId,
  resolution,
  notes,
}: ResolveFlagParams): Promise<ResolveFlagResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: "You must be logged in to resolve flags" };
    }
    const { supabase, userEmail, userId } = auth.ctx;

    // 3. Get the flag to check ownership
    const { data: flag } = await supabase
      .from("flags")
      .select("id, organization_id, status")
      .eq("id", flagId)
      .single();

    if (!flag) {
      return { success: false, error: "Flag not found" };
    }

    // Check if already resolved
    if (flag.status !== "open" && flag.status !== "in_progress") {
      return { success: false, error: "This flag has already been resolved" };
    }

    // Check permission
    const canResolve =
      isSuperAdmin(auth.ctx.globalRole) ||
      (!!flag.organization_id &&
        canManageOrganization(auth.ctx, flag.organization_id));

    if (!canResolve) {
      return { success: false, error: "You don't have permission to resolve this flag" };
    }

    // 4. Update the flag
    const { error: updateError } = await supabase
      .from("flags")
      .update({
        status: resolution,
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
        resolution_notes: notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", flagId);

    if (updateError) {
      console.error("Error resolving flag:", updateError);
      return { success: false, error: "Failed to resolve flag" };
    }

    console.log("=== FLAG RESOLVED ===");
    console.log("Flag ID:", flagId);
    console.log("Resolution:", resolution);
    console.log("Notes:", notes || "(none)");
    console.log("Resolved by:", userEmail);
    console.log("=====================");

    return { success: true };
  } catch (err) {
    console.error("Error resolving flag:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
