"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

interface AddBrandColorParams {
  organizationId: string;
  hex: string;
  name?: string;
  sortOrder?: number;
}

interface AddBrandColorResult {
  success: boolean;
  colorId?: string;
  error?: string;
}

export async function addBrandColor({
  organizationId,
  hex,
  name,
  sortOrder,
}: AddBrandColorParams): Promise<AddBrandColorResult> {
  const auth = await requireOrgAdminOrSuperAdmin(organizationId);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }
  // Service-role client, not auth.ctx.supabase: `authenticated` only holds
  // SELECT on brand_colors, so a user-scoped insert fails with "permission
  // denied for table brand_colors" for org admins. Authorization is the
  // guard above, same as update-field.ts.
  const supabase = createAdminClient();

  // Normalize hex value (ensure it has #)
  const normalizedHex = hex.startsWith("#") ? hex : `#${hex}`;

  // If no sort order provided, get the max sort order and add 1
  let finalSortOrder = sortOrder;
  if (finalSortOrder === undefined) {
    const { data: existingColors } = await supabase
      .from("brand_colors")
      .select("sort_order")
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: false })
      .limit(1);

    finalSortOrder = (existingColors?.[0]?.sort_order || 0) + 1;
  }

  // Insert the new brand color
  const { data: newColor, error: insertError } = await supabase
    .from("brand_colors")
    .insert({
      organization_id: organizationId,
      hex: normalizedHex,
      name: name || null,
      sort_order: finalSortOrder,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Error adding brand color:", insertError);
    return { success: false, error: insertError.message };
  }

  // Bust the route cache so the new swatch appears without a manual refresh.
  revalidatePath("/", "layout");
  // revalidatePath doesn't reach the unstable_cache-tagged org profile data cache
  revalidateTag("org-profile", "max");

  return { success: true, colorId: newColor.id };
}
