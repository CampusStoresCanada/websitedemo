"use server";

import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";
import type { ProcurementInfo } from "@/lib/types/procurement";
import type { Json } from "@/lib/database.types";

export async function updateProcurementInfo(
  organizationId: string,
  procurementInfo: ProcurementInfo
): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await requireOrgAdminOrSuperAdmin(organizationId);
    if (!auth.ok) return { success: false, error: auth.error };
    const supabase = auth.ctx.supabase;

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

    return { success: true };
  } catch (err) {
    console.error("Unexpected error updating procurement info:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
