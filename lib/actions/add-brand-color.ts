"use server";

import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";

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
  const supabase = auth.ctx.supabase;

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

  return { success: true, colorId: newColor.id };
}
