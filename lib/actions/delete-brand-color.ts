"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

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

  // Delete the brand color.
  // The write goes through the service-role client, not auth.ctx.supabase:
  // `authenticated` only holds SELECT on brand_colors, so a user-scoped
  // delete fails with "permission denied for table brand_colors" for org
  // admins. Authorization is the guard above, same as update-field.ts.
  const adminClient = createAdminClient();
  const { error: deleteError } = await adminClient
    .from("brand_colors")
    .delete()
    .eq("id", colorId);

  if (deleteError) {
    console.error("Error deleting brand color:", deleteError);
    return { success: false, error: deleteError.message };
  }

  // Bust the route cache so the removed swatch disappears without a manual refresh.
  revalidatePath("/", "layout");
  // revalidatePath doesn't reach the unstable_cache-tagged org profile data cache
  revalidateTag("org-profile", "max");

  return { success: true };
}
