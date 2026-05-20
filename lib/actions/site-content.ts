"use server";

import { requireAdmin, requireSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SiteContent, Contact } from "@/lib/database.types";
import { revalidatePath } from "next/cache";
import { EDITABLE_COLUMNS, editAnchorId, fieldDisplayLabel } from "@/lib/editable-fields";
import { queueTier2Change } from "@/lib/actions/pending-content-changes";

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

// Content fields that require four-eyes approval
const CONTENT_FIELDS = new Set(EDITABLE_COLUMNS.site_content);
// Structural fields that can write immediately (not user-visible content)
const STRUCTURAL_FIELDS = new Set(["display_order", "is_active"] as const);

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

/** Update an existing site content entry. Admin only.
 *  Content fields (title, subtitle, body, image_url) are queued for four-eyes approval.
 *  Structural fields (display_order, is_active) write immediately.
 */
export async function updateSiteContent(
  id: string,
  updates: UpdateSiteContentInput,
  meta?: { pageHref?: string; entityDisplayName?: string }
): Promise<{ success: boolean; error?: string; requiresApproval?: boolean; queuedCount?: number }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Split into structural (immediate) vs content (queued) fields
  const structuralUpdates: Partial<Record<string, unknown>> = {};
  const contentUpdates: Partial<Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (STRUCTURAL_FIELDS.has(key as never)) {
      structuralUpdates[key] = value;
    } else if (CONTENT_FIELDS.has(key as never) && value !== undefined) {
      contentUpdates[key] = value;
    }
  }

  // Write structural fields immediately
  if (Object.keys(structuralUpdates).length > 0) {
    const { error } = await adminClient
      .from("site_content")
      .update({ ...structuralUpdates, updated_by: auth.ctx.userId, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Error updating site content (structural):", error);
      return { success: false, error: error.message };
    }
    revalidatePath("/about");
  }

  // Queue content fields for approval
  if (Object.keys(contentUpdates).length > 0) {
    // Fetch current record for previous values and display name
    const { data: current } = await adminClient
      .from("site_content")
      .select("*")
      .eq("id", id)
      .single();

    const displayName = meta?.entityDisplayName ?? (current as SiteContent | null)?.title ?? id;
    const pageHref = meta?.pageHref ?? "/about";
    const currentRecord = (current ?? {}) as Record<string, unknown>;

    // Multiple content fields share one batch_id so they can be approved atomically
    const fieldEntries = Object.entries(contentUpdates);
    const batchId = fieldEntries.length > 1 ? crypto.randomUUID() : null;

    for (const [column, proposedValue] of fieldEntries) {
      const previousValue = currentRecord[column] ?? null;
      await queueTier2Change({
        requestedBy: auth.ctx.userId,
        targetTable: "site_content",
        targetColumn: column,
        targetEntityId: id,
        previousValue: (previousValue as string | number | null) ?? null,
        proposedValue: (proposedValue as string | number | null) ?? null,
        entityDisplayName: displayName,
        fieldDisplayLabel: fieldDisplayLabel(column),
        anchorId: editAnchorId("site_content", column, id),
        pageHref,
        batchId,
      });
    }

    return { success: true, requiresApproval: true, queuedCount: fieldEntries.length };
  }

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

// ─────────────────────────────────────────────────────────────────
// Slot → Contact assignment (super_admin only)
// ─────────────────────────────────────────────────────────────────

/**
 * Assign (or unassign) a contact to a site_content person slot.
 * Only super_admin can do this — the slot determines *who fills the role*,
 * which is a structural site decision, not a content edit.
 *
 * Passing contactId = null clears the assignment (slot falls back to
 * the inline title/subtitle/image_url columns).
 */
export async function assignSlotContact(
  slotId: string,
  contactId: string | null
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("site_content")
    .update({
      contact_id: contactId,
      updated_by: auth.ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", slotId);

  if (error) {
    console.error("Error assigning slot contact:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/about");
  return { success: true };
}

/**
 * Search contacts by name for the slot-assignment picker.
 * Admin only (same bar as content editing).
 * Returns a lightweight projection — only what the picker needs.
 */
export async function searchContactsForSlot(
  query: string
): Promise<{
  success: boolean;
  data?: Pick<Contact, "id" | "name" | "profile_picture_url" | "role_title" | "organization_id">[];
  error?: string;
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const trimmed = query.trim();

  const { data, error } = await adminClient
    .from("contacts")
    .select("id, name, profile_picture_url, role_title, organization_id")
    .ilike("name", `%${trimmed}%`)
    .is("archived_at", null)
    .order("name")
    .limit(20);

  if (error) {
    console.error("Error searching contacts:", error);
    return { success: false, error: error.message };
  }

  return {
    success: true,
    data: (data || []) as Pick<Contact, "id" | "name" | "profile_picture_url" | "role_title" | "organization_id">[],
  };
}
