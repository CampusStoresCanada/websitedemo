"use server";

import { requireAdmin } from "@/lib/auth/guards";
import type { SiteContent } from "@/lib/database.types";
import { revalidatePath } from "next/cache";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface CreateSiteContentInput {
  section: string;
  content_type?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  image_url?: string;
  display_order?: number;
}

export interface UpdateSiteContentInput {
  title?: string;
  subtitle?: string;
  body?: string;
  image_url?: string;
  display_order?: number;
  is_active?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// CRUD Actions
// ─────────────────────────────────────────────────────────────────

/** Create a new site content entry. Admin only. */
export async function createSiteContent(
  input: CreateSiteContentInput
): Promise<{ success: boolean; data?: SiteContent; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const { supabase, userId } = auth.ctx;

  const { data, error } = await supabase
    .from("site_content")
    .insert({
      section: input.section,
      content_type: input.content_type || "person",
      title: input.title || null,
      subtitle: input.subtitle || null,
      body: input.body || null,
      image_url: input.image_url || null,
      display_order: input.display_order ?? 0,
      updated_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating site content:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/about");
  return { success: true, data: data as SiteContent };
}

/** Update an existing site content entry. Admin only. */
export async function updateSiteContent(
  id: string,
  updates: UpdateSiteContentInput
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const { supabase, userId } = auth.ctx;

  const { error } = await supabase
    .from("site_content")
    .update({
      ...updates,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("Error updating site content:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/about");
  return { success: true };
}

/** Soft-delete a site content entry (sets is_active = false). Admin only. */
export async function deleteSiteContent(
  id: string
): Promise<{ success: boolean; error?: string }> {
  return updateSiteContent(id, { is_active: false });
}

/** Reorder site content entries. Admin only. */
export async function reorderSiteContent(
  items: { id: string; display_order: number }[]
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const { supabase } = auth.ctx;

  // Update each item's display_order
  const updates = items.map((item) =>
    supabase
      .from("site_content")
      .update({ display_order: item.display_order })
      .eq("id", item.id)
  );

  const results = await Promise.all(updates);
  const firstError = results.find((r) => r.error);

  if (firstError?.error) {
    console.error("Error reordering site content:", firstError.error);
    return { success: false, error: firstError.error.message };
  }

  revalidatePath("/about");
  return { success: true };
}

/** Fetch all site content for a section (including inactive). Admin only. */
export async function getAdminSiteContent(
  section: string
): Promise<{ success: boolean; data?: SiteContent[]; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const { supabase } = auth.ctx;

  const { data, error } = await supabase
    .from("site_content")
    .select("*")
    .eq("section", section)
    .order("display_order");

  if (error) {
    console.error("Error fetching admin site content:", error);
    return { success: false, error: error.message };
  }

  return { success: true, data: (data || []) as SiteContent[] };
}
