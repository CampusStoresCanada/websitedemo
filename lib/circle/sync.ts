// ---------------------------------------------------------------------------
// Circle sync infrastructure — enqueue, process queue, link accounts
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { getIntegrationConfig } from "@/lib/policy/engine";
import { isCircleConfigured } from "./config";
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
