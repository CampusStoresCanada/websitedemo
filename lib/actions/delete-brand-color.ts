"use server";

import { createClient } from "@/lib/supabase/server";
import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";

interface DeleteBrandColorParams {
  colorId: string;
}

interface DeleteBrandColorResult {
  success: boolean;
  error?: string;
}

export async function deleteBrandColor({
  colorId,
}: DeleteBrandColorParams): Promise<DeleteBrandColorResult> {
  const supabase = await createClient();

  // Get the brand color to find its organization
  const { data: brandColor, error: fetchError } = await supabase
    .from("brand_colors")
    .select("organization_id")
    .eq("id", colorId)
    .single();

  if (fetchError || !brandColor) {
    return { success: false, error: "Brand color not found" };
  }

  const auth = await requireOrgAdminOrSuperAdmin(brandColor.organization_id);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  // Delete the brand color
  const { error: deleteError } = await auth.ctx.supabase
    .from("brand_colors")
    .delete()
    .eq("id", colorId);

  if (deleteError) {
    console.error("Error deleting brand color:", deleteError);
    return { success: false, error: deleteError.message };
  }

  return { success: true };
}
