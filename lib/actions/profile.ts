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
 * Keeps the linked contact's name in step with the profile, and only
 * enqueues a Circle sync when name/role_title actually changed — Circle
 * pushes cost API quota, so no-op saves shouldn't generate calls.
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

  // Sync the linked contact (CRM/Circle record), pushing only the fields
  // that changed to Circle.
  if (auth.ctx.userEmail) {
    const { data: contact } = await db
      .from("contacts")
      .select("id, name, role_title, circle_id")
      .eq("email", auth.ctx.userEmail)
      .limit(1)
      .maybeSingle();

    if (contact) {
      const contactUpdates: Record<string, string> = {};
      const circleChanges: { name?: string; headline?: string } = {};

      if (displayName !== contact.name) {
        contactUpdates.name = displayName;
        circleChanges.name = displayName;
      }

      if (data.role_title !== undefined) {
        const roleTitle = data.role_title.trim();
        if (roleTitle !== (contact.role_title ?? "")) {
          contactUpdates.role_title = roleTitle;
          circleChanges.headline = roleTitle;
        }
      }

      if (Object.keys(contactUpdates).length > 0) {
        await db.from("contacts").update(contactUpdates).eq("id", contact.id);
      }

      if (contact.circle_id && Object.keys(circleChanges).length > 0) {
        void enqueueContactProfileSync(contact.id, circleChanges);
      }
    }
  }

  return { success: true };
}
