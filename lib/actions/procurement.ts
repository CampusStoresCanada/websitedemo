"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticated, requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProcurementInfo } from "@/lib/types/procurement";
import type { Json } from "@/lib/database.types";

export async function updateProcurementInfo(
  organizationId: string,
  procurementInfo: ProcurementInfo
): Promise<{ success: boolean; error?: string }> {
  try {
    // Org admins and super admins can update anything.
    // Regular members can also update procurement info for their own org
    // (e.g. setting their buying category assignments in the Procurement tab).
    const adminAuth = await requireOrgAdminOrSuperAdmin(organizationId);
    if (!adminAuth.ok) {
      // Fall back: check if the user is an active member of this org
      const memberAuth = await requireAuthenticated();
      if (!memberAuth.ok) return { success: false, error: memberAuth.error };
      const db = createAdminClient();
      const { data: membership } = await db
        .from("user_organizations")
        .select("id")
        .eq("user_id", memberAuth.ctx.userId)
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .maybeSingle();
      if (!membership) return { success: false, error: "Not a member of this organization" };
    }
    // Service-role client, not auth.ctx.supabase: 20260723210000 dropped the
    // open UPDATE policy on organizations and left `authenticated` with the
    // GRANT but no policy, so every session-client write here matched zero
    // rows under RLS and still reported success — the save silently did
    // nothing. Authorization is enforced above, same as add/delete-brand-color.
    const supabase = createAdminClient();

    // Update the organization's procurement_info field
    const { error } = await supabase
      .from("organizations")
      .update({
        procurement_info: procurementInfo as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", organizationId);

    if (error) {
      console.error("Error updating procurement info:", error);
      return { success: false, error: error.message };
    }

    // Bust the route cache so the saved category selections render without
    // a manual refresh.
    revalidatePath("/", "layout");

    return { success: true };
  } catch (err) {
    console.error("Unexpected error updating procurement info:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
