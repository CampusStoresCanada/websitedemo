"use server";

import {
  requireAuthenticated,
  canManageOrganization,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueCircleSync } from "@/lib/circle/sync";
import { logAuditEventSafe } from "@/lib/ops/audit";
import {
  ensureKnownPerson,
  ensurePersonForUser,
  linkUserToPerson,
  upsertPersonContact,
} from "@/lib/identity/lifecycle";

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
 * Guard: caller must be org_admin of this org, or global admin/super_admin.
 */
export async function inviteOrgUser(
  orgId: string,
  email: string,
  role: "member" | "org_admin"
): Promise<{ success: boolean; error?: string }> {
  // --- Auth ---
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data: orgRow } = await adminClient
      .from("organizations")
      .select("id, tenant_id")
      .eq("id", orgId)
      .maybeSingle();

    if (!orgRow) {
      return { success: false, error: "Organization not found" };
    }

    const knownPerson = await ensureKnownPerson({
      organizationId: orgId,
      tenantId: orgRow.tenant_id,
      name: normalizedEmail,
      email: normalizedEmail,
    });
    if (knownPerson.personId) {
      await upsertPersonContact({
        organizationId: orgId,
        personId: knownPerson.personId,
        name: normalizedEmail,
        email: normalizedEmail,
        contactType: ["directory"],
      });
    }

    // Check if a user with this email already exists in auth
    const { data: existingUsers } =
      await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
      const ensuredPerson = await ensurePersonForUser({
        userId,
        organizationId: orgId,
        fallbackEmail: normalizedEmail,
      });
      if (!ensuredPerson.personId && knownPerson.personId) {
        await linkUserToPerson({ userId, personId: knownPerson.personId });
      }

      // Check if they're already a member of this org
      const { data: existingMembership } = await adminClient
        .from("user_organizations")
        .select("id, status")
        .eq("user_id", userId)
        .eq("organization_id", orgId)
        .maybeSingle();

      if (existingMembership) {
        if (existingMembership.status === "active") {
          return {
            success: false,
            error: "User is already an active member of this organization",
          };
        }
        // Reactivate if inactive
        const { error: updateErr } = await adminClient
          .from("user_organizations")
          .update({ status: "active", role, updated_at: new Date().toISOString() })
          .eq("id", existingMembership.id);

        if (updateErr) {
          console.error("[inviteOrgUser] Reactivation failed:", updateErr);
          return { success: false, error: "Failed to reactivate user membership" };
        }

        // TODO(chunk-22): send "added back to org" notification email
        return { success: true };
      }
    } else {
      // Create a new auth user via invite (sends magic-link email)
      const { data: inviteData, error: inviteErr } =
        await adminClient.auth.admin.inviteUserByEmail(normalizedEmail);

      if (inviteErr || !inviteData.user) {
        console.error("[inviteOrgUser] Invite failed:", inviteErr);
        return {
          success: false,
          error: inviteErr?.message ?? "Failed to send invite",
        };
      }

      userId = inviteData.user.id;

      // Create profile row if it doesn't exist
      const { error: profileErr } = await adminClient
        .from("profiles")
        .upsert(
          {
            id: userId,
            global_role: "user",
          },
          { onConflict: "id" }
        );

      if (profileErr) {
        console.error("[inviteOrgUser] Profile creation failed:", profileErr);
        // Non-fatal: the profile trigger may handle this
      }

      const ensuredPerson = await ensurePersonForUser({
        userId,
        organizationId: orgId,
        fallbackEmail: normalizedEmail,
      });
      if (!ensuredPerson.personId && knownPerson.personId) {
        await linkUserToPerson({ userId, personId: knownPerson.personId });
      }
    }

    // Create user_organizations row
    const { error: orgErr } = await adminClient
      .from("user_organizations")
      .insert({
        user_id: userId,
        organization_id: orgId,
        role,
        status: "active",
      });

    if (orgErr) {
      console.error("[inviteOrgUser] user_organizations insert failed:", orgErr);
      return {
        success: false,
        error: orgErr.message.includes("duplicate")
          ? "User is already a member of this organization"
          : "Failed to add user to organization",
      };
    }

    // Circle sync: tag the new user with their role
    await enqueueCircleSync({
      operation: "add_tag",
      entityType: "contact",
      entityId: userId,
      payload: { email: normalizedEmail, role, orgId },
      orgId,
      idempotencyKey: `invite:${userId}:${orgId}`,
    });

    // TODO(chunk-22): send invite/welcome email via communications system

    return { success: true };
  } catch (err) {
    console.error("[inviteOrgUser] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
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

    // TODO(chunk-22): send deactivation notification email

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

    // TODO(chunk-22): send reactivation notification email

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

    // Circle sync: update Circle tag to match new role
    await enqueueCircleSync({
      operation: "add_tag",
      entityType: "contact",
      entityId: userId,
      payload: { orgId, newRole },
      orgId,
      idempotencyKey: `role:${userId}:${orgId}:${newRole}`,
    });

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

    // TODO(chunk-22): send role change notification email

    return { success: true };
  } catch (err) {
    console.error("[changeOrgUserRole] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
