"use server";

import { revalidateTag } from "next/cache";
import { canManageOrganization, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONTACT_TAGS } from "@/lib/contacts/tags";

interface UpdateContactTagsResult {
  success: boolean;
  error?: string;
}

const VALID_TAGS = new Set<string>(CONTACT_TAGS.map((t) => t.value));

/**
 * Update a contact's segmentation tags (contacts.contact_type).
 * Used by ContactEditModal's Tags section — separate from updateField since
 * contact_type is an array column, not a scalar field.
 */
export async function updateContactTags(
  contactId: string,
  organizationId: string,
  tags: string[]
): Promise<UpdateContactTagsResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: "You must be logged in to edit contacts" };
    }

    if (!canManageOrganization(auth.ctx, organizationId)) {
      return { success: false, error: "You don't have permission to edit this contact" };
    }

    const adminClient = createAdminClient();

    // contact_type also carries unrelated provenance/role values (e.g.
    // "Staff", which powers the public staff listing, or "directory"/
    // "conference" origin markers) — only replace the slice of the array
    // this Tags UI actually manages, leave everything else untouched.
    const { data: existing } = await adminClient
      .from("contacts")
      .select("contact_type")
      .eq("id", contactId)
      .single();
    const preserved = (existing?.contact_type ?? []).filter((t) => !VALID_TAGS.has(t));
    const nextTags = [...preserved, ...new Set(tags.filter((t) => VALID_TAGS.has(t)))];

    const { error } = await adminClient
      .from("contacts")
      .update({ contact_type: nextTags, updated_at: new Date().toISOString() })
      .eq("id", contactId);

    if (error) {
      console.error("[update-contact-tags] update failed:", error);
      return { success: false, error: "Failed to update tags" };
    }

    revalidateTag("org-profile", "max");
    return { success: true };
  } catch (err) {
    console.error("Error updating contact tags:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
