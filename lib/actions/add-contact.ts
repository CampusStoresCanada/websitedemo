"use server";

import {
  canManageOrganization,
  requireAuthenticated,
} from "@/lib/auth/guards";
import { ensureKnownPerson, upsertPersonContact } from "@/lib/identity/lifecycle";

interface AddContactParams {
  organizationId: string;
  name: string;
  email?: string;
  workEmail?: string;
  roleTitle?: string;
  phone?: string;
  workPhoneNumber?: string;
}

interface AddContactResult {
  success: boolean;
  error?: string;
  contactId?: string;
}

/**
 * Add a new contact to an organization.
 * Used by the global Toolkit Edit feature.
 *
 * Security:
 * - Only admins (super_admin or org_admin for the org) can add contacts
 *
 * Note: This creates a contact record. User account creation
 * (inviting the person to log in) is a separate flow.
 */
export async function addContact({
  organizationId,
  name,
  email,
  workEmail,
  roleTitle,
  phone,
  workPhoneNumber,
}: AddContactParams): Promise<AddContactResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: "You must be logged in to add contacts" };
    }
    const { supabase, userEmail } = auth.ctx;

    // Verify user can add contacts to this organization
    const canAdd = canManageOrganization(auth.ctx, organizationId);

    if (!canAdd) {
      return { success: false, error: "You don't have permission to add contacts to this organization" };
    }

    // Verify the organization exists
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, tenant_id")
      .eq("id", organizationId)
      .single();

    if (!org) {
      return { success: false, error: "Organization not found" };
    }

    // Validate required fields
    if (!name?.trim()) {
      return { success: false, error: "Contact name is required" };
    }

    const person = await ensureKnownPerson({
      organizationId,
      tenantId: (org as { tenant_id?: string | null }).tenant_id ?? null,
      name,
      email: workEmail?.trim() || email?.trim() || null,
      title: roleTitle ?? null,
      workPhone: workPhoneNumber ?? null,
      mobilePhone: phone ?? null,
    });

    if (person.error || !person.personId) {
      console.error("Error creating known person for contact:", person.error);
      return { success: false, error: person.error ?? "Failed to create person record" };
    }

    const contact = await upsertPersonContact({
      organizationId,
      personId: person.personId,
      name: name.trim(),
      email: workEmail?.trim() || email?.trim() || null,
      roleTitle: roleTitle ?? null,
      phone: phone ?? null,
      workPhone: workPhoneNumber ?? null,
      contactType: ["directory"],
    });

    if (contact.error || !contact.contactId) {
      console.error("Error upserting contact:", contact.error);
      return { success: false, error: contact.error ?? "Failed to add contact" };
    }

    console.log("=== CONTACT ADDED ===");
    console.log("Contact ID:", contact.contactId);
    console.log("Name:", name);
    console.log("Organization:", org.name);
    console.log("Added by:", userEmail);
    console.log("=====================");

    return { success: true, contactId: contact.contactId };
  } catch (err) {
    console.error("Error adding contact:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
