// ---------------------------------------------------------------------------
// Circle sync infrastructure — enqueue, process queue, link accounts
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { getIntegrationConfig } from "@/lib/policy/engine";
import { isCircleConfigured, getAccessGroupIds } from "./config";
import { getCircleClient } from "./client";
import { executeCircleSyncOperation } from "./operations";
import type { CircleSyncOperation, CircleSyncQueueItem } from "./types";
import type { Json } from "@/lib/database.types";

// ---------------------------------------------------------------------------
// Enqueue — called from server actions, non-throwing
// ---------------------------------------------------------------------------

interface EnqueueParams {
  operation: CircleSyncOperation;
  entityType: "contact" | "organization";
  entityId: string;
  payload: Record<string, unknown>;
  orgId?: string;
  idempotencyKey?: string;
}

/**
 * Enqueue a Circle sync operation. Safe to call from any server action.
 *
 * - Returns immediately (non-blocking).
 * - Checks policy flags before enqueuing.
 * - No-ops silently if Circle is not configured or cutover is disabled.
 * - Never throws — logs errors instead.
 */
export async function enqueueCircleSync(params: EnqueueParams): Promise<void> {
  try {
    // 1. Skip if Circle env vars are not set
    if (!isCircleConfigured()) return;

    // 2. Check policy feature flags
    let integrationConfig;
    try {
      integrationConfig = await getIntegrationConfig();
    } catch {
      // Policy engine unavailable — skip silently
      console.warn(
        "[circle/sync] Could not read integration config — skipping enqueue"
      );
      return;
    }

    if (!integrationConfig.circle_cutover_enabled) return;

    // 3. Canary check: if canary list is non-empty and orgId not in it, skip
    const canaryOrgs = integrationConfig.circle_canary_org_ids;
    if (
      canaryOrgs &&
      canaryOrgs.length > 0 &&
      params.orgId &&
      !canaryOrgs.includes(params.orgId)
    ) {
      return;
    }

    // 4. Insert into queue
    const adminClient = createAdminClient();
    const { error } = await adminClient.from("circle_sync_queue").insert({
      operation: params.operation,
      entity_type: params.entityType,
      entity_id: params.entityId,
      payload: params.payload as Json,
      status: "pending",
      next_retry_at: new Date().toISOString(),
      idempotency_key: params.idempotencyKey ?? null,
    });

    if (error) {
      // Duplicate idempotency_key → 23505 unique violation → expected, skip
      if (error.code === "23505") return;
      console.error("[circle/sync] Failed to enqueue:", error.message);
    }
  } catch (err) {
    console.error(
      "[circle/sync] Unexpected enqueue error:",
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Process queue — called by the cron job
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;

interface QueueResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

/**
 * Process pending items from the circle_sync_queue.
 *
 * - Picks up to BATCH_SIZE items in pending/failed state.
 * - Executes each via the Circle API.
 * - Marks completed or failed with exponential backoff.
 * - Logs results to sync_log table.
 */
export async function processCircleSyncQueue(): Promise<QueueResult> {
  const result: QueueResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  const circleClient = getCircleClient();
  if (!circleClient) {
    return result; // Not configured
  }

  const adminClient = createAdminClient();

  // Fetch pending items ready for processing
  const { data: items, error: fetchErr } = await adminClient
    .from("circle_sync_queue")
    .select("*")
    .in("status", ["pending", "failed"])
    .or("next_retry_at.is.null,next_retry_at.lte." + new Date().toISOString())
    .lt("attempts", 3) // max_attempts default
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    result.errors.push(`Queue fetch failed: ${fetchErr.message}`);
    return result;
  }

  if (!items || items.length === 0) {
    return result;
  }

  for (const item of items) {
    result.processed++;

    // Mark as processing + increment attempts
    await adminClient
      .from("circle_sync_queue")
      .update({
        status: "processing",
        attempts: (item.attempts ?? 0) + 1,
      })
      .eq("id", item.id);

    try {
      // Execute the actual Circle API call
      await executeCircleSyncOperation(
        circleClient,
        item as unknown as CircleSyncQueueItem
      );

      // Mark completed
      await adminClient
        .from("circle_sync_queue")
        .update({
          status: "completed",
          processed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", item.id);

      result.succeeded++;

      // Log success to sync_log
      await logSyncResult(adminClient, item, "completed");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const attempts = (item.attempts ?? 0) + 1;

      // Exponential backoff: attempts^2 * 30 seconds
      const backoffMs = Math.pow(attempts, 2) * 30_000;
      const nextRetry = new Date(Date.now() + backoffMs).toISOString();

      const newStatus = attempts >= (item.max_attempts ?? 3) ? "failed" : "failed";

      await adminClient
        .from("circle_sync_queue")
        .update({
          status: newStatus,
          last_error: errorMsg,
          next_retry_at: nextRetry,
        })
        .eq("id", item.id);

      result.failed++;
      result.errors.push(
        `${item.operation} for ${item.entity_id}: ${errorMsg}`
      );

      // Log failure to sync_log
      await logSyncResult(adminClient, item, "failed", errorMsg);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Inbound sync — pull profile updates from Circle → Supabase
// ---------------------------------------------------------------------------

const INBOUND_SYNC_BATCH_SIZE = 10;
const INBOUND_SYNC_INTERVAL_MINUTES = 1440; // 24 hours — bio/avatar/headline change rarely

/**
 * Pull non-canonical profile data (bio, headline, avatar) from Circle into
 * contact.circle_properties for all linked contacts not synced recently.
 *
 * - Only updates non-canonical fields (Supabase wins on identity fields).
 * - Safe to run on a schedule; no-ops if Circle is not configured.
 */
export async function pullInboundFromCircle(): Promise<{
  checked: number;
  updated: number;
  errors: string[];
}> {
  // DISABLED — was generating ~30k GET /community_members/{id} calls/month via
  // per-contact polling every 60 min. Shut down pending a webhook-based approach.
  // To re-enable: justify a minimum polling interval that keeps monthly calls < 500.
  return { checked: 0, updated: 0, errors: ["pullInboundFromCircle disabled"] };

  const circleClient = getCircleClient();
  if (!circleClient) return result;

  const adminClient = createAdminClient();
  const cutoffTime = new Date(
    Date.now() - INBOUND_SYNC_INTERVAL_MINUTES * 60 * 1000
  ).toISOString();

  // Fetch contacts with a circle_id that haven't been inbound-synced recently
  const { data: contacts, error } = await adminClient
    .from("contacts")
    .select("id, email, circle_id, circle_properties")
    .not("circle_id", "is", null)
    .or(`synced_from_circle_at.is.null,synced_from_circle_at.lt.${cutoffTime}`)
    .limit(INBOUND_SYNC_BATCH_SIZE);

  if (error) {
    result.errors.push(`Failed to fetch contacts: ${error.message}`);
    return result;
  }

  if (!contacts || contacts.length === 0) return result;

  for (const contact of contacts) {
    result.checked++;
    const circleId = Number(contact.circle_id);
    if (!circleId) continue;

    try {
      const member = await circleClient.getMember(circleId);

      // Extract non-canonical engagement fields only
      const nonCanonical: Record<string, unknown> = {};
      if (member.headline !== null) nonCanonical.headline = member.headline;
      if (member.bio !== null) nonCanonical.bio = member.bio;
      if (member.avatar_url !== null) nonCanonical.avatar_url = member.avatar_url;
      nonCanonical.space_ids = member.space_ids;
      nonCanonical.tag_ids = member.tag_ids;
      nonCanonical.active = member.active;

      // Merge with any existing circle_properties (don't clobber other keys)
      const existing =
        typeof contact.circle_properties === "object" &&
        contact.circle_properties !== null
          ? (contact.circle_properties as Record<string, unknown>)
          : {};

      const merged = { ...existing, ...nonCanonical };

      // Intentional exception to identity lifecycle helper usage:
      // circle_properties and synced_from_circle_at are external-system
      // engagement metadata, not identity fields.
      //
      // profile_picture_url: Circle is the source of truth for member photos.
      // Promote avatar_url into the canonical column so it flows to the website
      // without needing a separate upload. Only update when Circle provides a
      // value — never blank it out if Circle returns null.
      const photoUpdate: Record<string, unknown> = {};
      if (member.avatar_url) {
        photoUpdate.profile_picture_url = member.avatar_url;
      }

      await adminClient
        .from("contacts")
        .update({
          circle_properties: merged as Json,
          synced_from_circle_at: new Date().toISOString(),
          ...photoUpdate,
        })
        .eq("id", contact.id);

      result.updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 means member was deleted in Circle — update their sync timestamp to avoid hammering
      if (msg.includes("404") || msg.includes("not found")) {
        await adminClient
          .from("contacts")
          .update({ synced_from_circle_at: new Date().toISOString() })
          .eq("id", contact.id);
      }
      result.errors.push(`contact ${contact.id}: ${msg}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Access group sync — reflect org membership state in Circle access groups
// ---------------------------------------------------------------------------

/**
 * Active-access statuses: add to the appropriate access group.
 * Inactive statuses: remove from the access group, optionally add to alumni.
 */
const ACCESS_ACTIVE_STATUSES = new Set([
  "active",
  "reactivated",
  "grace",
]);

/**
 * Enqueue Circle access group add/remove operations for all contacts in an org.
 *
 * Called after a membership state transition. Non-throwing, fire-and-forget safe.
 *
 * Partner orgs each have their own Circle access group (stored on the org row).
 * Member orgs share the global Members access group from env config.
 *
 * Lifecycle:
 *   active/grace/reactivated → add to access group (create partner group if needed)
 *   locked                   → remove from access group + delete from Circle
 *   canceled                 → same as locked + delete the partner access group
 */
export async function enqueueOrgCircleAccessSync(
  orgId: string,
  newStatus: string,
  _orgType?: string | null  // kept for backwards compat; we fetch from DB
): Promise<void> {
  try {
    if (!isCircleConfigured()) return;

    const groupIds = getAccessGroupIds();
    const adminClient = createAdminClient();

    // Fetch org details we need
    const { data: org } = await adminClient
      .from("organizations")
      .select("name, type, circle_access_group_id, circle_tag_id, logo_url")
      .eq("id", orgId)
      .single();

    if (!org) return;

    const isPartner = org.type?.toLowerCase().includes("partner") ?? false;
    const isActive = ACCESS_ACTIVE_STATUSES.has(newStatus);
    const isLocked = newStatus === "locked";
    const isCanceled = newStatus === "canceled";
    const isDeactivated = isLocked || isCanceled;

    if (!isActive && !isDeactivated) {
      // applied, approved, etc. — no Circle action needed
      return;
    }

    // ── Resolve the access group ID for this org ──────────────────────────────
    let activeGroupId: number | null = null;

    if (isPartner) {
      if (isActive) {
        // Ensure partner has a Circle access group — create one if missing
        if (org.circle_access_group_id) {
          activeGroupId = Number(org.circle_access_group_id);
        } else {
          const circleClient = getCircleClient();
          if (circleClient) {
            try {
              const group = await circleClient.createAccessGroup(org.name);
              activeGroupId = group.id;
              // Persist the new group ID on the org row
              await adminClient
                .from("organizations")
                .update({ circle_access_group_id: String(group.id) })
                .eq("id", orgId);
              console.log(
                `[circle/sync] Created access group "${org.name}" (id=${group.id}) for org ${orgId}`
              );
            } catch (err) {
              console.error(
                `[circle/sync] Failed to create access group for org ${orgId}:`,
                err instanceof Error ? err.message : err
              );
              return; // Can't proceed without a group ID
            }
          }
        }
      } else {
        // Deactivated — use whatever group they had (for removal)
        activeGroupId = org.circle_access_group_id
          ? Number(org.circle_access_group_id)
          : null;
      }
    } else {
      // Member org — use the global Members group
      activeGroupId = groupIds.member ?? null;
    }

    // ── Ensure partner has a Circle tag — create one if missing ──────────────
    if (isPartner && isActive && !org.circle_tag_id) {
      const circleClient = getCircleClient();
      if (circleClient) {
        try {
          const tag = await circleClient.createTag({
            name: org.name,
            color: "#ffffff",
            display_format: "label",
            is_background_enabled: false,
            ...(org.logo_url ? { custom_emoji_url: org.logo_url } : {}),
          });
          (org as Record<string, unknown>).circle_tag_id = String(tag.id);
          await adminClient
            .from("organizations")
            .update({ circle_tag_id: String(tag.id) })
            .eq("id", orgId);
          console.log(
            `[circle/sync] Created tag "${org.name}" (id=${tag.id}) for org ${orgId}`
          );
        } catch (err) {
          console.error(
            `[circle/sync] Failed to create tag for org ${orgId}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    // ── Fetch all org contacts with emails ────────────────────────────────────
    const { data: contacts, error } = await adminClient
      .from("contacts")
      .select("id, email")
      .eq("organization_id", orgId)
      .not("email", "is", null);

    if (error || !contacts || contacts.length === 0) {
      // Still need to handle partner group deletion on cancel even with no contacts
      if (isCanceled && isPartner && activeGroupId) {
        await deletePartnerAccessGroup(adminClient, orgId, activeGroupId);
      }
      return;
    }

    const now = new Date().toISOString();

    for (const contact of contacts) {
      if (!contact.email) continue;

      if (isActive) {
        // Re-add to Circle if they were deleted during a prior lock/cancel
        if (newStatus === "reactivated") {
          await enqueueCircleSync({
            operation: "link_member",
            entityType: "contact",
            entityId: contact.id,
            payload: { email: contact.email },
            orgId,
            idempotencyKey: `reactivate-link-${contact.id}-${now}`,
          });
        }
        // Add to access group
        if (activeGroupId) {
          await enqueueCircleSync({
            operation: "add_to_access_group",
            entityType: "contact",
            entityId: contact.id,
            payload: { groupId: activeGroupId, email: contact.email },
            orgId,
            idempotencyKey: `access-add-${contact.id}-${activeGroupId}-${newStatus}`,
          });
        }
        // Tag with org tag
        if (org.circle_tag_id) {
          await enqueueCircleSync({
            operation: "add_tag",
            entityType: "contact",
            entityId: contact.id,
            payload: { tagId: Number(org.circle_tag_id), email: contact.email },
            orgId,
            idempotencyKey: `org-tag-add-${contact.id}-${org.circle_tag_id}-${newStatus}`,
          });
        }
      } else if (isDeactivated) {
        // Remove org tag
        if (org.circle_tag_id) {
          await enqueueCircleSync({
            operation: "remove_tag",
            entityType: "contact",
            entityId: contact.id,
            payload: { tagId: Number(org.circle_tag_id), email: contact.email },
            orgId,
            idempotencyKey: `org-tag-remove-${contact.id}-${org.circle_tag_id}-${now}`,
          });
        }
        // Remove from access group
        if (activeGroupId) {
          await enqueueCircleSync({
            operation: "remove_from_access_group",
            entityType: "contact",
            entityId: contact.id,
            payload: { groupId: activeGroupId, email: contact.email },
            orgId,
            idempotencyKey: `access-remove-${contact.id}-${activeGroupId}-${now}`,
          });
        }
        // Delete from Circle community (removes posting/DM access)
        await enqueueCircleSync({
          operation: "delete_member",
          entityType: "contact",
          entityId: contact.id,
          payload: { email: contact.email },
          orgId,
          idempotencyKey: `delete-member-${contact.id}-${now}`,
        });
      }
    }

    // ── On cancel: delete the partner's access group ──────────────────────────
    if (isCanceled && isPartner && activeGroupId) {
      await deletePartnerAccessGroup(adminClient, orgId, activeGroupId);
    }
  } catch (err) {
    console.error(
      "[circle/sync] enqueueOrgCircleAccessSync failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Provision a single newly-added contact into Circle.
 * Called from add-contact.ts after a contact row is created.
 * Queues: link_member + add_to_access_group + add_tag (if org is active).
 * Safe to call — never throws.
 */
export async function enqueueNewContactCircleProvisioning(
  contactId: string,
  orgId: string
): Promise<void> {
  if (!isCircleConfigured()) return;

  try {
    const adminClient = createAdminClient();
    const groupIds = getAccessGroupIds();

    // Fetch contact email
    const { data: contact } = await adminClient
      .from("contacts")
      .select("email")
      .eq("id", contactId)
      .single();

    if (!contact?.email) return;

    // Fetch org details + active membership status
    const { data: org } = await adminClient
      .from("organizations")
      .select("type, membership_status, circle_access_group_id, circle_tag_id")
      .eq("id", orgId)
      .single();

    if (!org || !ACCESS_ACTIVE_STATUSES.has(org.membership_status ?? "")) return;

    const isPartner = org.type?.toLowerCase().includes("partner") ?? false;
    const groupId = isPartner
      ? (org.circle_access_group_id ? Number(org.circle_access_group_id) : null)
      : (groupIds.member ?? null);

    const now = new Date().toISOString();

    // 1. Link to Circle (create account if needed)
    await enqueueCircleSync({
      operation: "link_member",
      entityType: "contact",
      entityId: contactId,
      payload: { email: contact.email },
      orgId,
      idempotencyKey: `new-contact-link-${contactId}-${now}`,
    });

    // 2. Add to access group
    if (groupId) {
      await enqueueCircleSync({
        operation: "add_to_access_group",
        entityType: "contact",
        entityId: contactId,
        payload: { groupId, email: contact.email },
        orgId,
        idempotencyKey: `new-contact-access-${contactId}-${groupId}`,
      });
    }

    // 3. Apply org tag
    if (org.circle_tag_id) {
      await enqueueCircleSync({
        operation: "add_tag",
        entityType: "contact",
        entityId: contactId,
        payload: { tagId: Number(org.circle_tag_id), email: contact.email },
        orgId,
        idempotencyKey: `new-contact-tag-${contactId}-${org.circle_tag_id}`,
      });
    }

    console.log(`[circle/sync] Queued Circle provisioning for new contact ${contactId} in org ${orgId}`);
  } catch (err) {
    console.error(
      "[circle/sync] enqueueNewContactCircleProvisioning failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Queue Circle de-provisioning for an archived/deleted contact.
 * Removes them from their access group, removes their org tag, and deletes
 * their Circle member account. Safe to call — never throws.
 */
export async function enqueueContactCircleDeprovisioning(
  contactId: string,
): Promise<void> {
  if (!isCircleConfigured()) return;

  try {
    const adminClient = createAdminClient();
    const groupIds = getAccessGroupIds();

    // Fetch contact email, circle_id, and org details in one go
    const { data: contact } = await adminClient
      .from("contacts")
      .select("email, circle_id, organization_id, organizations(type, circle_access_group_id, circle_tag_id)")
      .eq("id", contactId)
      .single();

    if (!contact?.email) return;

    const org = Array.isArray(contact.organizations)
      ? contact.organizations[0]
      : contact.organizations;

    const orgId = contact.organization_id ?? undefined;
    const isPartner = org?.type?.toLowerCase().includes("partner") ?? false;
    const groupId = isPartner
      ? (org?.circle_access_group_id ? Number(org.circle_access_group_id) : null)
      : (groupIds.member ?? null);

    // 1. Remove from access group
    if (groupId) {
      await enqueueCircleSync({
        operation: "remove_from_access_group",
        entityType: "contact",
        entityId: contactId,
        payload: { groupId, email: contact.email },
        orgId,
        idempotencyKey: `archive-contact-access-${contactId}-${groupId}`,
      });
    }

    // 2. Remove org tag
    if (org?.circle_tag_id) {
      await enqueueCircleSync({
        operation: "remove_tag",
        entityType: "contact",
        entityId: contactId,
        payload: { tagId: Number(org.circle_tag_id), email: contact.email },
        orgId,
        idempotencyKey: `archive-contact-tag-${contactId}-${org.circle_tag_id}`,
      });
    }

    // 3. Delete Circle member account
    if (contact.circle_id) {
      await enqueueCircleSync({
        operation: "delete_member",
        entityType: "contact",
        entityId: contactId,
        payload: { circleId: Number(contact.circle_id), email: contact.email },
        orgId,
        idempotencyKey: `archive-contact-delete-${contactId}`,
      });
    }

    console.log(`[circle/sync] Queued Circle de-provisioning for archived contact ${contactId}`);
  } catch (err) {
    console.error(
      "[circle/sync] enqueueContactCircleDeprovisioning failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/** Delete a partner's Circle access group and clear it from the org row. */
async function deletePartnerAccessGroup(
  adminClient: ReturnType<typeof createAdminClient>,
  orgId: string,
  groupId: number
): Promise<void> {
  const circleClient = getCircleClient();
  if (!circleClient) return;
  try {
    await circleClient.deleteAccessGroup(groupId);
    await adminClient
      .from("organizations")
      .update({ circle_access_group_id: null })
      .eq("id", orgId);
    console.log(`[circle/sync] Deleted access group ${groupId} for org ${orgId}`);
  } catch (err) {
    console.error(
      `[circle/sync] Failed to delete access group ${groupId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Profile sync — push canonical Supabase data to Circle member profile
// ---------------------------------------------------------------------------

/**
 * Enqueue a Circle profile update for a single contact.
 * Uses contacts.name and contacts.role_title as the source of truth.
 *
 * Safe to call from server actions. Never throws.
 */
export async function enqueueContactProfileSync(
  contactId: string,
  overrides?: { name?: string; headline?: string }
): Promise<void> {
  try {
    if (!isCircleConfigured()) return;

    const payload: Record<string, unknown> = {};
    if (overrides?.name) payload.name = overrides.name;
    if (overrides?.headline) payload.headline = overrides.headline;

    await enqueueCircleSync({
      operation: "update_profile",
      entityType: "contact",
      entityId: contactId,
      payload,
      // No idempotency key — allow multiple updates
    });
  } catch (err) {
    console.error(
      "[circle/sync] enqueueContactProfileSync failed:",
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Link a CSC contact to their Circle member
// ---------------------------------------------------------------------------

/**
 * Look up a Circle member by email. If found, link to the local contact.
 * If not found, optionally create a new Circle member.
 *
 * Updates contacts.circle_id and synced_to_circle_at.
 */
export async function linkCircleAccount(
  contactId: string,
  email: string,
  name?: string,
  autoCreate = false
): Promise<{ circleId: number | null; error?: string }> {
  const client = getCircleClient();
  if (!client) {
    return { circleId: null, error: "Circle not configured" };
  }

  try {
    // Search for existing Circle member
    const members = await client.searchMembers(email);

    let circleId: number | null = null;

    if (members.length > 0) {
      circleId = members[0].id;
    } else if (autoCreate && name) {
      // Create new Circle member
      const created = await client.createMember({
        email,
        name,
        skip_invitation: true,
      });
      circleId = created.id;
    }

    if (circleId !== null) {
      // Intentional exception to identity lifecycle helper usage:
      // this is sync metadata for external integration, not person identity.
      const adminClient = createAdminClient();
      await adminClient
        .from("contacts")
        .update({
          circle_id: String(circleId),
          synced_to_circle_at: new Date().toISOString(),
        })
        .eq("id", contactId);
    }

    return { circleId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[circle/sync] linkCircleAccount failed:", errorMsg);
    return { circleId: null, error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Sync log helper
// ---------------------------------------------------------------------------

async function logSyncResult(
  adminClient: ReturnType<typeof createAdminClient>,
  item: Record<string, unknown>,
  status: "completed" | "failed",
  errorMessage?: string
): Promise<void> {
  try {
    await adminClient.from("sync_log").insert({
      id: crypto.randomUUID(),
      entity_type: String(item.entity_type ?? "unknown"),
      entity_id: String(item.entity_id ?? ""),
      operation: String(item.operation ?? "unknown"),
      source_system: "circle",
      status,
      error_message: errorMessage ?? null,
      synced_at: new Date().toISOString(),
      tenant_id: "00000000-0000-0000-0000-000000000000", // system tenant
    });
  } catch {
    // Non-critical — don't break the queue on log failure
    console.warn("[circle/sync] Failed to write sync_log entry");
  }
}
