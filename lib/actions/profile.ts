"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import { enqueueContactProfileSync } from "@/lib/circle/sync";

export interface UpdateProfileData {
  display_name: string;
  role_title?: string;
}

export interface UpdateProfileResult {
  success: boolean;
  error?: string;
}

/**
 * Update the authenticated user's display name (profiles) and optionally
 * their role title on the linked contact (contacts).
 *
 * Enqueues a Circle profile sync so the change propagates automatically.
 */
export async function updateProfile(
  data: UpdateProfileData
): Promise<UpdateProfileResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return { success: false, error: "Not authenticated" };
  }

  const displayName = data.display_name.trim();
  if (!displayName) {
    return { success: false, error: "Display name is required" };
  }

  const db = createAdminClient();

  // Update display_name in profiles
  const { error: profileErr } = await db
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", auth.ctx.userId);

  if (profileErr) {
    return { success: false, error: profileErr.message };
  }

  // If role_title provided and user has a linked contact, update it too
  let contactId: string | null = null;
  if (auth.ctx.userEmail) {
    const updates: Record<string, string> = {};
    if (data.role_title !== undefined) {
      updates.role_title = data.role_title.trim();
    }

    if (Object.keys(updates).length > 0) {
      const { data: contact } = await db
        .from("contacts")
        .select("id")
        .eq("email", auth.ctx.userEmail)
        .limit(1)
        .maybeSingle();

      if (contact?.id) {
        contactId = contact.id;
        await db
          .from("contacts")
          .update(updates)
          .eq("id", contact.id);
      }
    } else {
      // Still need contactId for Circle sync even without role_title update
      const { data: contact } = await db
        .from("contacts")
        .select("id")
        .eq("email", auth.ctx.userEmail)
        .limit(1)
        .maybeSingle();
      contactId = contact?.id ?? null;
    }
  }

  // Enqueue Circle profile sync (fire-and-forget)
  if (contactId) {
    void enqueueContactProfileSync(contactId, {
      name: displayName,
      ...(data.role_title !== undefined ? { headline: data.role_title.trim() } : {}),
    });
  }

  return { success: true };
}
