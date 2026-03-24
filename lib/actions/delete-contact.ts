"use server";

import {
  canManageOrganization,
  requireAuthenticated,
} from "@/lib/auth/guards";
import { archivePersonContact } from "@/lib/identity/lifecycle";
import { enqueueContactCircleDeprovisioning } from "@/lib/circle/sync";

interface DeleteContactParams {
  contactId: string;
}

interface DeleteContactResult {
  success: boolean;
  error?: string;
  deletedName?: string;
}

/**
 * Delete a contact from an organization.
 * Used by the global Toolkit Edit feature.
 *
 * Security:
 * - Only admins (super_admin or org_admin for the org) can delete contacts
 *
 * Note: This is an archive operation. We set archived_at so identity
 * history remains available for future account linking.
 */
export async function deleteContact({
  contactId,
}: DeleteContactParams): Promise<DeleteContactResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: "You must be logged in to delete contacts" };
    }
    const { supabase, userEmail } = auth.ctx;

    // 3. Get the contact to verify ownership
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, name, organization_id, archived_at")
      .eq("id", contactId)
      .single();

    if (!contact) {
      return { success: false, error: "Contact not found" };
    }

    // Verify user can delete contacts from this organization
    const canDelete =
      !!contact.organization_id &&
      canManageOrganization(auth.ctx, contact.organization_id);

    if (!canDelete) {
      return { success: false, error: "You don't have permission to delete this contact" };
    }

    const alreadyArchived = Boolean(contact.archived_at);
    if (alreadyArchived) {
      return { success: true, deletedName: contact.name };
    }

    // 5. Archive the contact instead of hard delete to preserve identity lineage.
    const archived = await archivePersonContact({ contactId });
    const deleteError = archived.success ? null : new Error(archived.error ?? "Archive failed");

    if (deleteError) {
      console.error("Error deleting contact:", deleteError);
      return { success: false, error: "Failed to delete contact" };
    }

    console.log("=== CONTACT DELETED ===");
    console.log("Contact ID:", contactId);
    console.log("Name:", contact.name);
    console.log("Deleted by:", userEmail);
    console.log("=======================");

    // Queue Circle de-provisioning (fire-and-forget)
    void enqueueContactCircleDeprovisioning(contactId);

    return { success: true, deletedName: contact.name };
  } catch (err) {
    console.error("Error deleting contact:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
