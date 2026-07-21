"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function updateAutomationRule(
  id: string,
  patch: { templateKey: string; automationMode: "auto_send" | "draft_only"; enabled: boolean }
): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db
    .from("automation_rules")
    .update({
      template_key: patch.templateKey,
      automation_mode: patch.automationMode,
      enabled: patch.enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/comms");
  return { success: true, data: null };
}
