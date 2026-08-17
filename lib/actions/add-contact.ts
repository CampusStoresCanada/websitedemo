"use server";

import { revalidateTag } from "next/cache";
import {
  canManageOrganization,
  requireAuthenticated,
} from "@/lib/auth/guards";
import { ensureKnownPerson, upsertPersonContact } from "@/lib/identity/lifecycle";
import { enqueueNewContactCircleProvisioning } from "@/lib/circle/sync";
import { loginSkipReason, type LoginSkipReason } from "@/lib/contacts/login-policy";
import { provisionOrgLogin } from "@/lib/identity/org-login";

interface AddContactParams {
  organizationId: string;
  name: string;
  email?: string;
  workEmail?: string;
  roleTitle?: string;
  phone?: string;
  workPhoneNumber?: string;
  /** Non-member segmentation tags (see lib/contacts/tags.ts). Defaults to ["directory"] when omitted. */
  tags?: string[];
  /**
   * Whether to also provision a portal login and email them an invite.
   * Omit to let the login policy decide (the default the UI presents);
   * pass false to explicitly add a directory-only contact.
   */
  invite?: boolean;
  /** Role for the login being provisioned. Ignored when no invite is sent. */
  inviteRole?: "member" | "org_admin";
}

export interface AddContactInviteResult {
  status: "sent" | "already_had_login" | "skipped" | "failed";
  /** Why no invite went out — present for "skipped" and "failed". */
  reason?: LoginSkipReason | "declined" | string;
}

interface AddContactResult {
  success: boolean;
  error?: string;
  contactId?: string;
  /**
   * What happened to the person's login. Always present. The contact is
   * created either way — a failed invite never fails the whole action, or
   * an admin would have to guess whether to retry and risk a duplicate.
   */
  invite: AddContactInviteResult;
}

/**
 * Add a new contact to an organization.
 * Used by the global Toolkit Edit feature.
 *
 * Security:
 * - Only admins (super_admin or org_admin for the org) can add contacts
 *
 * This creates the contact record AND, unless the login policy or the caller
 * says otherwise, provisions their portal login and emails the invite. It
 * used to do only the former, which meant every person added through the org
 * profile silently never got an account — they appeared in the directory, so
 * the omission was invisible until someone noticed they had never logged in.
 */
export async function addContact({
  organizationId,
  name,
  email,
  workEmail,
  roleTitle,
  phone,
  workPhoneNumber,
  tags,
  invite,
  inviteRole = "member",
}: AddContactParams): Promise<AddContactResult> {
  const notAttempted: AddContactInviteResult = { status: "skipped" };

  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: "You must be logged in to add contacts", invite: notAttempted };
    }
    const { supabase, userEmail } = auth.ctx;

    // Verify user can add contacts to this organization
    const canAdd = canManageOrganization(auth.ctx, organizationId);

    if (!canAdd) {
      return {
        success: false,
        error: "You don't have permission to add contacts to this organization",
        invite: notAttempted,
      };
    }

    // Verify the organization exists
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, tenant_id, membership_status")
      .eq("id", organizationId)
      .single();

    if (!org) {
      return { success: false, error: "Organization not found", invite: notAttempted };
    }

    // Validate required fields
    if (!name?.trim()) {
      return { success: false, error: "Contact name is required", invite: notAttempted };
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
      return {
        success: false,
        error: person.error ?? "Failed to create person record",
        invite: notAttempted,
      };
    }

    const contactType = tags && tags.length > 0 ? ["directory", ...tags] : ["directory"];
    const contactEmail = workEmail?.trim() || email?.trim() || null;

    const contact = await upsertPersonContact({
      organizationId,
      personId: person.personId,
      name: name.trim(),
      email: contactEmail,
      roleTitle: roleTitle ?? null,
      phone: phone ?? null,
      workPhone: workPhoneNumber ?? null,
      contactType,
    });

    if (contact.error || !contact.contactId) {
      console.error("Error upserting contact:", contact.error);
      return {
        success: false,
        error: contact.error ?? "Failed to add contact",
        invite: notAttempted,
      };
    }

    // Queue Circle provisioning for the new contact (fire-and-forget)
    void enqueueNewContactCircleProvisioning(contact.contactId, organizationId);

    // Provision the portal login in the same pass. Same gate Circle
    // provisioning uses, so a contact never ends up with one and not the other.
    const inviteResult = await provisionLogin({
      organizationId,
      email: contactEmail,
      contactType,
      membershipStatus: (org as { membership_status?: string | null }).membership_status ?? null,
      role: inviteRole,
      requested: invite,
      personId: person.personId,
    });

    revalidateTag("org-profile", "max");

    return { success: true, contactId: contact.contactId, invite: inviteResult };
  } catch (err) {
    console.error("Error adding contact:", err);
    return { success: false, error: "An unexpected error occurred", invite: notAttempted };
  }
}

/**
 * Decide whether this new contact gets a login, and provision it if so.
 *
 * Never throws: the contact row already exists by the time this runs, so an
 * invite failure is reported alongside a successful add rather than
 * unwinding it. The admin sees exactly what did and didn't happen.
 */
async function provisionLogin(params: {
  organizationId: string;
  email: string | null;
  contactType: string[];
  membershipStatus: string | null;
  role: "member" | "org_admin";
  /** Explicit caller choice; undefined means "follow the policy". */
  requested?: boolean;
  personId: string;
}): Promise<AddContactInviteResult> {
  if (params.requested === false) {
    return { status: "skipped", reason: "declined" };
  }

  // The policy is a ceiling, not a default: `requested: true` opts in, it
  // does not force. Letting the caller override would put a contact in the
  // exact state this change exists to prevent — a login without the matching
  // Circle account, which is gated on the same rules.
  const skip = loginSkipReason({
    email: params.email,
    contactType: params.contactType,
    membershipStatus: params.membershipStatus,
  });

  if (skip) {
    return { status: "skipped", reason: skip };
  }

  try {
    // syncIdentity: false — the person and contact rows were just written
    // above with the admin's actual input. Re-running the identity sync here
    // would overwrite title and phone with nulls.
    const result = await provisionOrgLogin({
      orgId: params.organizationId,
      email: params.email!,
      role: params.role,
      syncIdentity: false,
      personId: params.personId,
    });

    if (result.outcome === "already_member") {
      return { status: "already_had_login" };
    }
    if (!result.success) {
      console.error("[addContact] Login provisioning failed:", result.error);
      return { status: "failed", reason: result.error ?? "Failed to send invite" };
    }
    return { status: "sent" };
  } catch (err) {
    console.error("[addContact] Login provisioning threw:", err);
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : "Failed to send invite",
    };
  }
}
