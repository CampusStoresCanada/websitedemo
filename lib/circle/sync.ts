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

const INBOUND_SYNC_BATCH_SIZE = 25;
const INBOUND_SYNC_INTERVAL_MINUTES = 60; // only re-sync contacts older than this

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
  const result = { checked: 0, updated: 0, errors: [] as string[] };

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
      await adminClient
        .from("contacts")
        .update({
          circle_properties: merged as Json,
          synced_from_circle_at: new Date().toISOString(),
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
 * @param orgId      - Supabase org UUID
 * @param newStatus  - The status the org just transitioned TO
 * @param orgType    - Optional: "Vendor Partner" triggers partner group; otherwise member group
 */
export async function enqueueOrgCircleAccessSync(
  orgId: string,
  newStatus: string,
  orgType?: string | null
): Promise<void> {
  try {
    if (!isCircleConfigured()) return;

    const groupIds = getAccessGroupIds();
    const isPartner = orgType?.toLowerCase().includes("partner") ?? false;
    const activeGroupId = isPartner ? groupIds.partner : groupIds.member;

    if (!activeGroupId && !groupIds.alumni) {
      // No access group IDs configured — nothing to do
      return;
    }

    const isActive = ACCESS_ACTIVE_STATUSES.has(newStatus);
    const isDeactivated = newStatus === "locked" || newStatus === "canceled";

    if (!isActive && !isDeactivated) {
      // applied, approved, etc. — no access group change needed
      return;
    }

    const adminClient = createAdminClient();

    // Fetch all contacts in this org that have an email (needed for access group ops)
    const { data: contacts, error } = await adminClient
      .from("contacts")
      .select("id, email")
      .eq("organization_id", orgId)
      .not("email", "is", null);

    if (error || !contacts || contacts.length === 0) return;

    const now = new Date().toISOString();

    for (const contact of contacts) {
      if (!contact.email) continue;

      if (isActive && activeGroupId) {
        // Add to active access group
        await enqueueCircleSync({
          operation: "add_to_access_group",
          entityType: "contact",
          entityId: contact.id,
          payload: { groupId: activeGroupId, email: contact.email },
          orgId,
          idempotencyKey: `access-add-${contact.id}-${activeGroupId}-${newStatus}`,
        });
      } else if (isDeactivated) {
        // Remove from active access group
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
        // Add to alumni group if configured
        if (groupIds.alumni) {
          await enqueueCircleSync({
            operation: "add_to_access_group",
            entityType: "contact",
            entityId: contact.id,
            payload: { groupId: groupIds.alumni, email: contact.email },
            orgId,
            idempotencyKey: `access-alumni-${contact.id}-${groupIds.alumni}`,
          });
        }
      }
    }
  } catch (err) {
    console.error(
      "[circle/sync] enqueueOrgCircleAccessSync failed:",
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
