"use server";

import {
  requireAuthenticated,
  canManageOrganization,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueCircleSync } from "@/lib/circle/sync";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { sendTransactional } from "@/lib/comms/send";
import {
  loginSkipReason,
  LOGIN_SKIP_MESSAGES,
  type LoginSkipReason,
} from "@/lib/contacts/login-policy";
import {
  provisionOrgLogin,
  type ProvisionOrgLoginResult,
} from "@/lib/identity/org-login";
import { findUserByEmail } from "../supabase/user-lookup";

// ─────────────────────────────────────────────────────────────────
// Invite a new user to an organization
// ─────────────────────────────────────────────────────────────────

/**
 * Invite a user to the organization by email.
 *
 * - If the user already has an auth account, they are simply added
 *   to the org in `user_organizations`.
 * - If they don't have an account, we create one via
 *   `auth.admin.inviteUserByEmail` which sends a magic-link invite.
 *
 * The work itself lives in provisionOrgLogin, shared with addContact so that
 * adding a person and giving them a login are one operation rather than two
 * that can silently drift apart.
 *
 * Guard: caller must be org_admin of this org, or global admin/super_admin.
 */
export async function inviteOrgUser(
  orgId: string,
  email: string,
  role: "member" | "org_admin"
): Promise<ProvisionOrgLoginResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  return provisionOrgLogin({ orgId, email, role, syncIdentity: true });
}

// ─────────────────────────────────────────────────────────────────
// Deactivate a user from an organization
// ─────────────────────────────────────────────────────────────────

/**
 * Deactivate a user's membership in an organization.
 * This sets their `user_organizations.status` to `inactive`.
 *
 * Cannot deactivate:
 * - Yourself (use admin transfer instead)
 * - The last org_admin (must transfer admin first)
 */
export async function deactivateOrgUser(
  orgId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  // Cannot deactivate yourself
  if (auth.ctx.userId === userId) {
    return {
      success: false,
      error: "Cannot deactivate yourself. Use admin transfer to step down.",
    };
  }

  const adminClient = createAdminClient();

  try {
    // Check if user is an org_admin — if so, ensure they're not the last one
    const { data: membership } = await adminClient
      .from("user_organizations")
      .select("id, role, status")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .single();

    if (!membership) {
      return { success: false, error: "User is not an active member of this organization" };
    }

    if (membership.role === "org_admin") {
      // Count other active org_admins
      const { count } = await adminClient
        .from("user_organizations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("role", "org_admin")
        .eq("status", "active")
        .neq("user_id", userId);

      if ((count ?? 0) < 1) {
        return {
          success: false,
          error: "Cannot deactivate the last org admin. Transfer admin rights first.",
        };
      }
    }

    const { error: updateErr } = await adminClient
      .from("user_organizations")
      .update({ status: "inactive", updated_at: new Date().toISOString() })
      .eq("id", membership.id);

    if (updateErr) {
      console.error("[deactivateOrgUser] Update failed:", updateErr);
      return { success: false, error: "Failed to deactivate user" };
    }

    // Circle sync: remove user from Circle spaces
    await enqueueCircleSync({
      operation: "remove_from_space",
      entityType: "contact",
      entityId: userId,
      payload: { orgId },
      orgId,
      idempotencyKey: `deactivate:${userId}:${orgId}:${Date.now()}`,
    });

    await logAuditEventSafe({
      action: "organization_user_deactivated",
      entityType: "organization",
      entityId: orgId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        orgId,
        targetUserId: userId,
      },
    });

    // Fire-and-forget: look up user email + org name for notification
    Promise.all([
      adminClient.auth.admin.getUserById(userId),
      adminClient.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    ]).then(([{ data: userRes }, { data: orgRes }]) => {
      const email = userRes?.user?.email;
      if (email) {
        sendTransactional({
          templateKey: "org_user_deactivated",
          to: email,
          variables: { user_name: email, org_name: orgRes?.name ?? orgId },
        }).catch(() => {});
      }
    }).catch(() => {});

    return { success: true };
  } catch (err) {
    console.error("[deactivateOrgUser] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Reactivate a user in an organization
// ─────────────────────────────────────────────────────────────────

/**
 * Reactivate a previously deactivated user.
 * Sets their `user_organizations.status` back to `active`.
 */
export async function reactivateOrgUser(
  orgId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();

  try {
    const { data: membership } = await adminClient
      .from("user_organizations")
      .select("id, status")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .single();

    if (!membership) {
      return { success: false, error: "User is not a member of this organization" };
    }

    if (membership.status === "active") {
      return { success: false, error: "User is already active" };
    }

    const { error: updateErr } = await adminClient
      .from("user_organizations")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", membership.id);

    if (updateErr) {
      console.error("[reactivateOrgUser] Update failed:", updateErr);
      return { success: false, error: "Failed to reactivate user" };
    }

    // Circle sync: restore user to Circle spaces
    await enqueueCircleSync({
      operation: "add_to_space",
      entityType: "contact",
      entityId: userId,
      payload: { orgId },
      orgId,
      idempotencyKey: `reactivate:${userId}:${orgId}:${Date.now()}`,
    });

    Promise.all([
      adminClient.auth.admin.getUserById(userId),
      adminClient.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    ]).then(([{ data: userRes }, { data: orgRes }]) => {
      const email = userRes?.user?.email;
      if (email) {
        sendTransactional({
          templateKey: "org_user_reactivated",
          to: email,
          variables: { user_name: email, org_name: orgRes?.name ?? orgId },
        }).catch(() => {});
      }
    }).catch(() => {});

    return { success: true };
  } catch (err) {
    console.error("[reactivateOrgUser] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Change a user's role within an organization
// ─────────────────────────────────────────────────────────────────

/**
 * Change a user's role between `member` and `org_admin`.
 *
 * Cannot demote the last org_admin — transfer admin first.
 */
export async function changeOrgUserRole(
  orgId: string,
  userId: string,
  newRole: "member" | "org_admin"
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();

  try {
    const { data: membership } = await adminClient
      .from("user_organizations")
      .select("id, role, status")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .single();

    if (!membership) {
      return { success: false, error: "User is not an active member of this organization" };
    }

    if (membership.role === newRole) {
      return { success: false, error: `User already has the ${newRole} role` };
    }

    // If demoting from org_admin, ensure they're not the last one
    if (membership.role === "org_admin" && newRole === "member") {
      const { count } = await adminClient
        .from("user_organizations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("role", "org_admin")
        .eq("status", "active")
        .neq("user_id", userId);

      if ((count ?? 0) < 1) {
        return {
          success: false,
          error: "Cannot demote the last org admin. Transfer admin rights first.",
        };
      }
    }

    const { error: updateErr } = await adminClient
      .from("user_organizations")
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq("id", membership.id);

    if (updateErr) {
      console.error("[changeOrgUserRole] Update failed:", updateErr);
      return { success: false, error: "Failed to change user role" };
    }

    await logAuditEventSafe({
      action: "organization_user_role_changed",
      entityType: "organization",
      entityId: orgId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        orgId,
        targetUserId: userId,
        previousRole: membership.role,
        newRole,
      },
    });

    Promise.all([
      adminClient.auth.admin.getUserById(userId),
      adminClient.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    ]).then(([{ data: userRes }, { data: orgRes }]) => {
      const email = userRes?.user?.email;
      if (email) {
        sendTransactional({
          templateKey: "org_user_role_changed",
          to: email,
          variables: {
            user_name: email,
            org_name: orgRes?.name ?? orgId,
            old_role: membership.role,
            new_role: newRole,
          },
        }).catch(() => {});
      }
    }).catch(() => {});

    return { success: true };
  } catch (err) {
    console.error("[changeOrgUserRole] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Toggle member visibility within an org
// ─────────────────────────────────────────────────────────────────

/**
 * Hide or unhide a member within an organization.
 *
 * A hidden member retains their account, role, and data access but is
 * invisible in all public and peer-member-facing views. Only the org's
 * own org_admin, global admins, and super_admins can see hidden members.
 *
 * Guard: caller must be org_admin of this org, or global admin/super_admin.
 */
export async function setOrgMemberHidden(
  orgId: string,
  userId: string,
  hidden: boolean
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("user_organizations")
    .update({ hidden, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("user_id", userId);

  if (error) {
    console.error("[setOrgMemberHidden] Update failed:", error);
    return { success: false, error: "Failed to update member visibility" };
  }

  await logAuditEventSafe({
    action: hidden ? "organization_member_hidden" : "organization_member_shown",
    entityType: "organization",
    entityId: orgId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { orgId, targetUserId: userId, hidden },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Individual contact visibility
// ---------------------------------------------------------------------------

/**
 * Show or hide a single contact record from non-privileged viewers.
 * The contact remains in the DB; privileged viewers (org_admin, admin, super_admin)
 * can always see it.
 *
 * Guard: caller must be org_admin of this org, or global admin/super_admin.
 */
export async function setContactHidden(
  orgId: string,
  contactId: string,
  hidden: boolean
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const isOrgAdmin = canManageOrganization(auth.ctx, orgId);

  // Members can toggle their own contact's visibility (matched by email)
  let isOwnContact = false;
  if (!isOrgAdmin && auth.ctx.userEmail) {
    const adminClient = createAdminClient();
    const { data: contact } = await adminClient
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("organization_id", orgId)
      .or(`email.eq.${auth.ctx.userEmail},work_email.eq.${auth.ctx.userEmail}`)
      .maybeSingle();
    isOwnContact = !!contact;
  }

  if (!isOrgAdmin && !isOwnContact) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("contacts")
    .update({ hidden, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("organization_id", orgId);

  if (error) {
    console.error("[setContactHidden] Update failed:", error);
    return { success: false, error: "Failed to update contact visibility" };
  }

  await logAuditEventSafe({
    action: hidden ? "contact_hidden" : "contact_shown",
    entityType: "organization",
    entityId: orgId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { orgId, contactId, hidden },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Invite an existing contact
// ---------------------------------------------------------------------------

/**
 * Provision a login for a contact who already exists in the directory.
 *
 * Distinct from inviteOrgUser: that one takes a bare email and builds the
 * person/contact records around it, which overwrites title and phone with
 * nulls. Here the contact is the source of truth and already has those
 * fields, so the identity sync is skipped.
 *
 * Guard: caller must be org_admin of this org, or global admin/super_admin.
 */
export async function inviteExistingContact(
  orgId: string,
  contactId: string,
  role: "member" | "org_admin"
): Promise<ProvisionOrgLoginResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const resolved = await resolveContactForLogin(orgId, contactId);
  if ("error" in resolved) return { success: false, error: resolved.error };

  return provisionOrgLogin({
    orgId,
    email: resolved.email,
    role,
    syncIdentity: false,
    personId: resolved.personId,
  });
}

/**
 * Shared lookup: a contact's login email, its person projection, and whether
 * the login policy allows provisioning at all. Callers must authorize first.
 */
async function resolveContactForLogin(
  orgId: string,
  contactId: string
): Promise<{ email: string; personId: string | null } | { error: string }> {
  const adminClient = createAdminClient();

  const [{ data: contact }, { data: org }] = await Promise.all([
    adminClient
      .from("contacts")
      .select("email, work_email, contact_type")
      .eq("id", contactId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    adminClient
      .from("organizations")
      .select("membership_status")
      .eq("id", orgId)
      .maybeSingle(),
  ]);

  if (!contact) return { error: "Contact not found" };

  const email = (contact.work_email ?? contact.email ?? "").trim();
  const skip = loginSkipReason({
    email,
    contactType: contact.contact_type,
    membershipStatus: org?.membership_status ?? null,
  });
  if (skip) {
    return { error: `Can't create a login — ${LOGIN_SKIP_MESSAGES[skip]}.` };
  }

  // `people` is retired — the contact IS the person record now, so its own
  // id is the person id. No second lookup, no email re-match.
  return { email, personId: contactId };
}

// ---------------------------------------------------------------------------
// Grant / revoke org admin, addressed by contact
// ---------------------------------------------------------------------------

export type SetContactAdminOutcome =
  | "granted"
  | "invited_as_admin"
  | "revoked"
  | "no_change";

/**
 * Make a contact an org admin, or step them back down to member.
 *
 * Addressed by contact rather than user id because the org profile's people
 * table is a list of contacts — some of whom have no account yet. Granting
 * admin to one of those provisions the login and sends the invite in the same
 * pass, so "make this person an admin" is one action from the admin's side
 * regardless of whether they had an account.
 *
 * Revoking is guarded against removing the last admin. This is deliberately
 * NOT the handover ceremony: adding or removing a co-admin leaves the org
 * with an admin either way, so it needs no successor timeout. Handing over
 * sole control still goes through initiateAdminTransfer.
 *
 * Guard: caller must be org_admin of this org, or global admin/super_admin.
 */
export async function setContactOrgAdmin(
  orgId: string,
  contactId: string,
  makeAdmin: boolean
): Promise<{ success: boolean; error?: string; outcome?: SetContactAdminOutcome }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();

  try {
    const resolved = await resolveContactForLogin(orgId, contactId);

    // Revoking from someone who can't hold a login is already the desired
    // state — only report the policy problem when trying to grant.
    if ("error" in resolved) {
      return makeAdmin
        ? { success: false, error: resolved.error }
        : { success: true, outcome: "no_change" };
    }

    const existingUser = await findUserByEmail(adminClient, resolved.email);

    if (!existingUser) {
      if (!makeAdmin) return { success: true, outcome: "no_change" };

      const provisioned = await provisionOrgLogin({
        orgId,
        email: resolved.email,
        role: "org_admin",
        syncIdentity: false,
        personId: resolved.personId,
      });
      return provisioned.success
        ? { success: true, outcome: "invited_as_admin" }
        : { success: false, error: provisioned.error };
    }

    const { data: membership } = await adminClient
      .from("user_organizations")
      .select("id, role, status")
      .eq("user_id", existingUser.id)
      .eq("organization_id", orgId)
      .maybeSingle();

    // Has an account but isn't an active member here — provisionOrgLogin
    // covers both "no membership" and "inactive membership" and sets the role.
    if (!membership || membership.status !== "active") {
      if (!makeAdmin) return { success: true, outcome: "no_change" };

      const provisioned = await provisionOrgLogin({
        orgId,
        email: resolved.email,
        role: "org_admin",
        syncIdentity: false,
        personId: resolved.personId,
      });
      return provisioned.success
        ? { success: true, outcome: "granted" }
        : { success: false, error: provisioned.error };
    }

    const targetRole = makeAdmin ? "org_admin" : "member";
    if (membership.role === targetRole) {
      return { success: true, outcome: "no_change" };
    }

    // changeOrgUserRole owns the last-admin guard, the audit entry, and the
    // notification email — don't reimplement any of it here.
    const result = await changeOrgUserRole(orgId, existingUser.id, targetRole);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, outcome: makeAdmin ? "granted" : "revoked" };
  } catch (err) {
    console.error("[setContactOrgAdmin] Failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not update admin access",
    };
  }
}

// ---------------------------------------------------------------------------
// Login status for a single contact
// ---------------------------------------------------------------------------

export interface ContactLoginStatus {
  email: string | null;
  /** An auth account exists for this contact's email. */
  hasAccount: boolean;
  /** Their membership row in THIS org, if any. */
  membership: { role: "member" | "org_admin"; status: string } | null;
  /** True once they have actually signed in — distinguishes a live account
   *  from an invite that was sent and never accepted. */
  hasSignedIn: boolean;
  /** Null when they qualify for a login; otherwise why they don't. */
  skipReason: LoginSkipReason | null;
}

/**
 * Report whether a contact has a working login, for the contact editor.
 *
 * Exists because a contact row and a login are separate records: a contact
 * can sit in the directory looking perfectly normal while having no account
 * at all. The editor surfaces this so an admin can see and fix it in place,
 * rather than discovering it when the person says they never got in.
 *
 * Guard: caller must be org_admin of this org, or global admin/super_admin.
 */
export async function getContactLoginStatus(
  orgId: string,
  contactId: string
): Promise<{ success: boolean; error?: string; status?: ContactLoginStatus }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();

  try {
    const [{ data: contact }, { data: org }] = await Promise.all([
      adminClient
        .from("contacts")
        .select("email, work_email, contact_type")
        .eq("id", contactId)
        .eq("organization_id", orgId)
        .maybeSingle(),
      adminClient
        .from("organizations")
        .select("membership_status")
        .eq("id", orgId)
        .maybeSingle(),
    ]);

    if (!contact) return { success: false, error: "Contact not found" };

    const email = (contact.work_email ?? contact.email ?? "").trim() || null;
    const skipReason = loginSkipReason({
      email,
      contactType: contact.contact_type,
      membershipStatus: org?.membership_status ?? null,
    });

    if (!email) {
      return {
        success: true,
        status: { email: null, hasAccount: false, membership: null, hasSignedIn: false, skipReason },
      };
    }

    const user = await findUserByEmail(adminClient, email);
    if (!user) {
      return {
        success: true,
        status: { email, hasAccount: false, membership: null, hasSignedIn: false, skipReason },
      };
    }

    const [{ data: membership }, { data: userRes }] = await Promise.all([
      adminClient
        .from("user_organizations")
        .select("role, status")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .maybeSingle(),
      adminClient.auth.admin.getUserById(user.id),
    ]);

    return {
      success: true,
      status: {
        email,
        hasAccount: true,
        membership: membership
          ? { role: membership.role as "member" | "org_admin", status: membership.status }
          : null,
        hasSignedIn: !!userRes?.user?.last_sign_in_at,
        skipReason,
      },
    };
  } catch (err) {
    console.error("[getContactLoginStatus] Failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not check login status",
    };
  }
}

// ---------------------------------------------------------------------------
// Org profile section visibility settings
// ---------------------------------------------------------------------------

export interface OrgProfileVisibilityFlags {
  showContacts: boolean;
  showBrandColors: boolean;
  showInBenchmarking: boolean;
  showPrimaryContact: boolean;
  showStoreInformation: boolean;
}

/**
 * Update the org-level section visibility flags.
 * Controls what non-admin viewers can see on the organization's profile page.
 * Guard: caller must be org_admin of this org, or global admin/super_admin.
 */
export async function updateOrgProfileVisibilitySettings(
  orgId: string,
  flags: OrgProfileVisibilityFlags
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("organizations")
    .update({
      show_contacts: flags.showContacts,
      show_brand_colors: flags.showBrandColors,
      show_in_benchmarking: flags.showInBenchmarking,
      show_primary_contact: flags.showPrimaryContact,
      show_store_information: flags.showStoreInformation,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId);

  if (error) {
    console.error("[updateOrgProfileVisibilitySettings] Update failed:", error);
    return { success: false, error: "Failed to update visibility settings" };
  }

  await logAuditEventSafe({
    action: "organization_profile_visibility_updated",
    entityType: "organization",
    entityId: orgId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { orgId, flags },
  });

  return { success: true };
}
