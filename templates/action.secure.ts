"use server";

import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";

export async function secureAction(organizationId: string) {
  const auth = await requireOrgAdminOrSuperAdmin(organizationId);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const { supabase } = auth.ctx;

  // Business logic here
  await supabase.from("organizations").select("id").eq("id", organizationId).maybeSingle();

  return { success: true };
}
