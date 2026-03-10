"use server";

import {
  requireAuthenticated,
  canManageOrganization,
  isGlobalAdmin,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectivePolicy } from "@/lib/policy/engine";
import { enqueueCircleSync } from "@/lib/circle/sync";

// ─────────────────────────────────────────────────────────────────
// Initiate Admin Transfer
// ─────────────────────────────────────────────────────────────────

/**
 * Initiate an admin transfer for an organization.
 *
 * The current org_admin (or a global admin) selects a successor.
 * A pending transfer request is created with a timeout based on
 * the `admin_transfer.timeout_duration` policy (hours).
 *
 * If `toUserId` is null, a no-successor fallback is set up:
 * after the timeout, the system assigns a designated super_admin.
 */
export async function initiateAdminTransfer(
  orgId: string,
  toUserId: string | null,
  reason?: string
): Promise<{ success: boolean; error?: string; requestId?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, orgId)) {
    return { success: false, error: "Not authorized for this organization" };
  }

  const adminClient = createAdminClient();

  try {
    // Check no pending transfer already exists for this org
    const { data: existingPending } = await adminClient
      .from("admin_transfer_requests")
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .maybeSingle();

    if (existingPending) {
      return {
        success: false,
        error: "A transfer is already pending for this organization",
      };
    }

    // If successor specified, validate they're an active member of the org
    if (toUserId) {
      const { data: successor } = await adminClient
        .from("user_organizations")
        .select("id, status")
        .eq("user_id", toUserId)
        .eq("organization_id", orgId)
        .eq("status", "active")
        .single();

      if (!successor) {
        return {
          success: false,
          error: "Selected successor is not an active member of this organization",
        };
      }

      // Successor cannot be the current initiator
      if (toUserId === auth.ctx.userId) {
        return {
          success: false,
          error: "Cannot transfer admin rights to yourself",
        };
      }
    }

    // Read timeout duration from policy (in hours)
    let timeoutHours: number;
    try {
      timeoutHours = await getEffectivePolicy<number>(
        "admin_transfer.timeout_duration"
      );
    } catch {
      // Default to 72 hours if policy not configured
      timeoutHours = 72;
      console.warn(
        "[initiateAdminTransfer] Policy admin_transfer.timeout_duration not found, using default 72h"
      );
    }

    const now = new Date();
    const timeoutAt = new Date(now.getTime() + timeoutHours * 60 * 60 * 1000);

    const { data: request, error: insertErr } = await adminClient
      .from("admin_transfer_requests")
      .insert({
        organization_id: orgId,
        from_user_id: auth.ctx.userId,
        to_user_id: toUserId,
        status: "pending",
        requested_at: now.toISOString(),
        timeout_at: timeoutAt.toISOString(),
        reason: reason ?? null,
        metadata: {
          timeout_hours: timeoutHours,
          initiated_by_role: auth.ctx.globalRole,
        },
      })
      .select("id")
      .single();

    if (insertErr || !request) {
      console.error("[initiateAdminTransfer] Insert failed:", insertErr);
      return {
        success: false,
        error: insertErr?.message ?? "Failed to create transfer request",
      };
    }

    // TODO(chunk-22): send notification emails
    // - To successor (if exists): "You've been nominated as admin"
    // - To all global admins: "Admin transfer initiated for org X"

    return { success: true, requestId: request.id };
  } catch (err) {
    console.error("[initiateAdminTransfer] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Accept Admin Transfer
// ─────────────────────────────────────────────────────────────────

/**
 * The nominated successor accepts the admin transfer.
 *
 * Calls the `execute_admin_transfer` RPC which atomically:
 * - Promotes the successor to org_admin
 * - Demotes the old admin to member
 * - Updates the transfer request status
 */
export async function acceptAdminTransfer(
  requestId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  try {
    // Fetch the transfer request
    const { data: request, error: fetchErr } = await adminClient
      .from("admin_transfer_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (fetchErr || !request) {
      return { success: false, error: "Transfer request not found" };
    }

    if (request.status !== "pending") {
      return {
        success: false,
        error: `Transfer is no longer pending (status: ${request.status})`,
      };
    }

    // Validate that the current user is the nominated successor
    if (request.to_user_id !== auth.ctx.userId) {
      // Allow global admins to force-accept
      if (!isGlobalAdmin(auth.ctx.globalRole)) {
        return {
          success: false,
          error: "Only the nominated successor can accept this transfer",
        };
      }
    }

    // Execute the atomic transfer via RPC
    const { data: result, error: rpcErr } = await adminClient.rpc(
      "execute_admin_transfer",
      {
        p_request_id: requestId,
        p_completed_by: "successor",
      }
    );

    if (rpcErr) {
      console.error("[acceptAdminTransfer] RPC failed:", rpcErr);
      return {
        success: false,
        error: rpcErr.message ?? "Failed to execute transfer",
      };
    }

    // TODO(chunk-05): trigger onboarding reset for new org admin

    // Circle sync: update tags for both old and new admin
    if (request.to_user_id) {
      await enqueueCircleSync({
        operation: "add_tag",
        entityType: "contact",
        entityId: request.to_user_id,
        payload: { orgId: request.organization_id, newRole: "org_admin" },
        orgId: request.organization_id,
        idempotencyKey: `transfer-accept-to:${requestId}`,
      });
    }
    await enqueueCircleSync({
      operation: "add_tag",
      entityType: "contact",
      entityId: request.from_user_id,
      payload: { orgId: request.organization_id, newRole: "member" },
      orgId: request.organization_id,
      idempotencyKey: `transfer-accept-from:${requestId}`,
    });

    // TODO(chunk-22): send confirmation emails

    return { success: true };
  } catch (err) {
    console.error("[acceptAdminTransfer] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Cancel Admin Transfer
// ─────────────────────────────────────────────────────────────────

/**
 * Cancel a pending admin transfer.
 *
 * Can be done by the initiator (from_user_id) or a global admin.
 */
export async function cancelAdminTransfer(
  requestId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  try {
    const { data: request, error: fetchErr } = await adminClient
      .from("admin_transfer_requests")
      .select("id, from_user_id, status, organization_id")
      .eq("id", requestId)
      .single();

    if (fetchErr || !request) {
      return { success: false, error: "Transfer request not found" };
    }

    if (request.status !== "pending") {
      return {
        success: false,
        error: `Transfer is no longer pending (status: ${request.status})`,
      };
    }

    // Only the initiator or a global admin can cancel
    if (
      request.from_user_id !== auth.ctx.userId &&
      !isGlobalAdmin(auth.ctx.globalRole)
    ) {
      return {
        success: false,
        error: "Only the initiator or a global admin can cancel this transfer",
      };
    }

    const { error: updateErr } = await adminClient
      .from("admin_transfer_requests")
      .update({
        status: "canceled",
        completed_at: new Date().toISOString(),
        completed_by: "initiator",
        reason: reason ?? null,
      })
      .eq("id", requestId);

    if (updateErr) {
      console.error("[cancelAdminTransfer] Update failed:", updateErr);
      return { success: false, error: "Failed to cancel transfer" };
    }

    // TODO(chunk-22): send cancellation notification

    return { success: true };
  } catch (err) {
    console.error("[cancelAdminTransfer] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Admin Transfer Timeout Check (called by cron, not a server action)
// ─────────────────────────────────────────────────────────────────

/**
 * Process any pending admin transfers that have passed their timeout.
 *
 * For each timed-out transfer:
 * - If a successor is nominated: auto-approve via RPC
 * - If no successor (to_user_id is null): trigger fallback
 *   (assign a designated super_admin as temporary org_admin)
 *
 * This function uses the admin client (no user auth context)
 * and is called by the cron route.
 */
export async function adminTransferTimeoutCheck(): Promise<{
  processed: number;
  auto_approved: number;
  fallback_triggered: number;
  errors: string[];
}> {
  const adminClient = createAdminClient();

  const result = {
    processed: 0,
    auto_approved: 0,
    fallback_triggered: 0,
    errors: [] as string[],
  };

  try {
    // Find all pending transfers past their timeout
    const { data: expiredTransfers, error: queryErr } = await adminClient
      .from("admin_transfer_requests")
      .select("*")
      .eq("status", "pending")
      .lt("timeout_at", new Date().toISOString());

    if (queryErr) {
      result.errors.push(`Query failed: ${queryErr.message}`);
      return result;
    }

    if (!expiredTransfers || expiredTransfers.length === 0) {
      return result;
    }

    for (const transfer of expiredTransfers) {
      result.processed++;

      try {
        if (transfer.to_user_id) {
          // Auto-approve: execute the transfer via RPC
          const { error: rpcErr } = await adminClient.rpc(
            "execute_admin_transfer",
            {
              p_request_id: transfer.id,
              p_completed_by: "system_timeout",
            }
          );

          if (rpcErr) {
            result.errors.push(
              `Auto-approve failed for ${transfer.id}: ${rpcErr.message}`
            );
            continue;
          }

          result.auto_approved++;

          // TODO(chunk-05): trigger onboarding reset for new org admin

          // Circle sync: update tags for auto-approved transfer
          await enqueueCircleSync({
            operation: "add_tag",
            entityType: "contact",
            entityId: transfer.to_user_id,
            payload: { orgId: transfer.organization_id, newRole: "org_admin" },
            orgId: transfer.organization_id,
            idempotencyKey: `transfer-auto-to:${transfer.id}`,
          });
          await enqueueCircleSync({
            operation: "add_tag",
            entityType: "contact",
            entityId: transfer.from_user_id,
            payload: { orgId: transfer.organization_id, newRole: "member" },
            orgId: transfer.organization_id,
            idempotencyKey: `transfer-auto-from:${transfer.id}`,
          });

          // TODO(chunk-22): send auto-approval notification emails
        } else {
          // No successor — fallback: assign a super_admin as temp org_admin
          const { data: superAdmins } = await adminClient
            .from("profiles")
            .select("id")
            .eq("global_role", "super_admin")
            .limit(1);

          if (!superAdmins || superAdmins.length === 0) {
            result.errors.push(
              `Fallback failed for ${transfer.id}: no super_admin found`
            );
            continue;
          }

          const designatedSuperAdmin = superAdmins[0];

          // Check if super_admin is already in the org
          const { data: existingMembership } = await adminClient
            .from("user_organizations")
            .select("id, role")
            .eq("user_id", designatedSuperAdmin.id)
            .eq("organization_id", transfer.organization_id)
            .maybeSingle();

          if (existingMembership) {
            // Update their role to org_admin
            await adminClient
              .from("user_organizations")
              .update({ role: "org_admin", updated_at: new Date().toISOString() })
              .eq("id", existingMembership.id);
          } else {
            // Add them as org_admin
            await adminClient
              .from("user_organizations")
              .insert({
                user_id: designatedSuperAdmin.id,
                organization_id: transfer.organization_id,
                role: "org_admin",
                status: "active",
              });
          }

          // Demote old admin to member
          await adminClient
            .from("user_organizations")
            .update({ role: "member", updated_at: new Date().toISOString() })
            .eq("user_id", transfer.from_user_id)
            .eq("organization_id", transfer.organization_id);

          // Update transfer request
          await adminClient
            .from("admin_transfer_requests")
            .update({
              status: "fallback_triggered",
              completed_at: new Date().toISOString(),
              completed_by: "fallback",
              metadata: {
                ...(typeof transfer.metadata === "object" && transfer.metadata !== null
                  ? transfer.metadata
                  : {}),
                fallback_admin_id: designatedSuperAdmin.id,
              },
            })
            .eq("id", transfer.id);

          result.fallback_triggered++;

          // TODO(chunk-22): send fallback notification to super_admins
        }
      } catch (transferErr) {
        const msg =
          transferErr instanceof Error
            ? transferErr.message
            : "Unknown error";
        result.errors.push(`Transfer ${transfer.id}: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    result.errors.push(`Unhandled: ${msg}`);
  }

  return result;
}
