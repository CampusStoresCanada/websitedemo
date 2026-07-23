"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";
import { requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { requiresSuperAdminApproval, type EditableTable } from "@/lib/editable-fields";
import { revalidatePath } from "next/cache";
import {
  sendContentChangeQueued,
  sendContentChangeApproved,
  sendContentChangeRejected,
} from "@/lib/email/send";
import { createReviewToken } from "@/lib/actions/content-change-tokens";
import type { PendingContentChange } from "@/lib/types/db";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueTier2ChangeParams {
  targetTable: EditableTable;
  targetColumn: string;
  targetEntityId: string;
  proposedValue: string | number | null;
  previousValue: string | number | null;
  entityDisplayName: string;
  fieldDisplayLabel: string;
  pageHref: string | null;
  anchorId: string;
  requestedBy: string;
  /** Shared UUID for changes submitted together in one save. Null for single-field changes. */
  batchId?: string | null;
}

export interface PendingChangeWithRequester extends PendingContentChange {
  requester_display_name: string | null;
  requester_email: string | null;
  reviewer_display_name: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue a Tier 2 change (called from update-field.ts, not directly from client)
// ─────────────────────────────────────────────────────────────────────────────

export async function queueTier2Change(
  params: QueueTier2ChangeParams
): Promise<{ success: boolean; error?: string; pendingChangeId?: string }> {
  const adminClient = createAdminClient();

  const { data: pending, error } = await adminClient
    .from("pending_content_changes")
    .insert({
      target_table: params.targetTable,
      target_column: params.targetColumn,
      target_entity_id: params.targetEntityId,
      proposed_value: params.proposedValue,
      previous_value: params.previousValue,
      entity_display_name: params.entityDisplayName,
      field_display_label: params.fieldDisplayLabel,
      page_href: params.pageHref,
      anchor_id: params.anchorId,
      requested_by: params.requestedBy,
      batch_id: params.batchId ?? null,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error || !pending) {
    console.error("[pending-content-changes] queueTier2Change failed:", error);
    return { success: false, error: "Failed to queue change" };
  }

  await logAuditEventSafe({
    action: "field_change_queued",
    entityType: params.targetTable,
    entityId: params.targetEntityId,
    actorId: params.requestedBy,
    actorType: "user",
    details: {
      column: params.targetColumn,
      pendingChangeId: pending.id,
      previousValue: params.previousValue,
      proposedValue: params.proposedValue,
    },
  });

  // Notify eligible approvers by email (non-blocking)
  void notifyApprovers(pending.id, params).catch((err) => {
    console.warn("[pending-content-changes] approver notification failed:", err);
  });

  return { success: true, pendingChangeId: pending.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Approve
// ─────────────────────────────────────────────────────────────────────────────

export async function approvePendingChange(
  pendingChangeId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Load the pending change
  const { data: pending, error: loadError } = await adminClient
    .from("pending_content_changes")
    .select("*")
    .eq("id", pendingChangeId)
    .single();

  if (loadError || !pending) return { success: false, error: "Change not found" };
  if (pending.status !== "pending") return { success: false, error: `Change is already ${pending.status}` };
  if (new Date(pending.expires_at) < new Date()) {
    await adminClient
      .from("pending_content_changes")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pendingChangeId);
    return { success: false, error: "This change has expired" };
  }

  // Self-approval check (belt-and-suspenders beyond DB constraint)
  if (pending.requested_by === auth.ctx.userId) {
    return { success: false, error: "You cannot approve your own change" };
  }

  // Super-admin-only fields
  if (
    requiresSuperAdminApproval(pending.target_table as EditableTable, pending.target_column) &&
    auth.ctx.globalRole !== "super_admin"
  ) {
    return { success: false, error: "This field requires super_admin approval" };
  }

  // Optimistic-lock: verify the field hasn't changed since the request was submitted
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: current } = await (adminClient as any)
    .from(pending.target_table)
    .select(pending.target_column)
    .eq("id", pending.target_entity_id)
    .single();

  if (!current) {
    await adminClient
      .from("pending_content_changes")
      .update({ status: "rejected", review_note: "Entity no longer exists", reviewed_by: auth.ctx.userId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", pendingChangeId);
    return { success: false, error: "The entity this change targets no longer exists" };
  }

  const currentVal = (current as unknown as Record<string, unknown>)[pending.target_column] ?? null;
  const storedPrev = pending.previous_value ?? null;
  if (JSON.stringify(currentVal) !== JSON.stringify(storedPrev)) {
    return {
      success: false,
      error: "This field was modified after the change was submitted. Reject and ask the requester to resubmit.",
    };
  }

  // Write the change
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: writeError } = await (adminClient as any)
    .from(pending.target_table)
    .update({
      [pending.target_column]: pending.proposed_value,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pending.target_entity_id);

  if (writeError) {
    console.error("[pending-content-changes] approve write failed:", writeError);
    return { success: false, error: "Failed to apply the change" };
  }

  // Mark approved
  await adminClient
    .from("pending_content_changes")
    .update({
      status: "approved",
      reviewed_by: auth.ctx.userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", pendingChangeId);

  await logAuditEventSafe({
    action: "field_change_approved",
    entityType: pending.target_table,
    entityId: pending.target_entity_id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { pendingChangeId, column: pending.target_column, approvedValue: pending.proposed_value },
  });

  if (pending.page_href) {
    revalidatePath(pending.page_href);
  }

  // Notify requester (non-blocking)
  void notifyRequesterApproved(pending).catch((err) => {
    console.warn("[pending-content-changes] approval notification failed:", err);
  });

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reject (with optional counter-proposal)
// ─────────────────────────────────────────────────────────────────────────────

export async function rejectPendingChange(
  pendingChangeId: string,
  options?: {
    note?: string;
    /** If provided, creates a new pending change with this value as the counter-proposal. */
    counterProposalValue?: string | number | null;
  }
): Promise<{ success: boolean; error?: string; counterChangeId?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: pending, error: loadError } = await adminClient
    .from("pending_content_changes")
    .select("*")
    .eq("id", pendingChangeId)
    .single();

  if (loadError || !pending) return { success: false, error: "Change not found" };
  if (pending.status !== "pending") return { success: false, error: `Change is already ${pending.status}` };
  if (pending.requested_by === auth.ctx.userId) {
    return { success: false, error: "You cannot reject your own change" };
  }

  // Mark rejected
  await adminClient
    .from("pending_content_changes")
    .update({
      status: "rejected",
      reviewed_by: auth.ctx.userId,
      reviewed_at: new Date().toISOString(),
      review_note: options?.note ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pendingChangeId);

  await logAuditEventSafe({
    action: "field_change_rejected",
    entityType: pending.target_table,
    entityId: pending.target_entity_id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { pendingChangeId, note: options?.note, column: pending.target_column },
  });

  let counterChangeId: string | undefined;

  // Counter-proposal: create a new pending change from the reviewer's suggested value
  if (options?.counterProposalValue !== undefined) {
    const counterResult = await queueTier2Change({
      targetTable: pending.target_table as EditableTable,
      targetColumn: pending.target_column,
      targetEntityId: pending.target_entity_id,
      proposedValue: options.counterProposalValue,
      previousValue: pending.previous_value as string | number | null,
      entityDisplayName: pending.entity_display_name ?? "",
      fieldDisplayLabel: pending.field_display_label ?? pending.target_column,
      pageHref: pending.page_href,
      anchorId: pending.anchor_id ?? "",
      requestedBy: auth.ctx.userId,
    });

    if (counterResult.success && counterResult.pendingChangeId) {
      counterChangeId = counterResult.pendingChangeId;

      // Link counter-proposal back to the rejected change
      await adminClient
        .from("pending_content_changes")
        .update({ counter_to_id: pendingChangeId, updated_at: new Date().toISOString() })
        .eq("id", counterChangeId);
    }
  }

  // Notify requester (non-blocking)
  void notifyRequesterRejected(pending, options?.note, counterChangeId).catch((err) => {
    console.warn("[pending-content-changes] rejection notification failed:", err);
  });

  return { success: true, counterChangeId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch approve / reject
// ─────────────────────────────────────────────────────────────────────────────

/** Approve all pending changes sharing a batch_id atomically. */
export async function approveBatch(
  batchId: string
): Promise<{ success: boolean; error?: string; approvedCount?: number }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Load all pending changes in this batch
  const { data: changes, error: loadErr } = await adminClient
    .from("pending_content_changes")
    .select("*")
    .eq("batch_id", batchId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());

  if (loadErr || !changes?.length) {
    return { success: false, error: "No pending changes found for this batch" };
  }

  // Shared validations
  for (const pending of changes) {
    if (pending.requested_by === auth.ctx.userId) {
      return { success: false, error: "You cannot approve your own changes" };
    }
    if (requiresSuperAdminApproval(pending.target_table as EditableTable, pending.target_column) && auth.ctx.globalRole !== "super_admin") {
      return { success: false, error: `Field "${pending.target_column}" requires super_admin approval` };
    }
  }

  // Optimistic-lock check and write for each field
  const now = new Date().toISOString();
  let approvedCount = 0;

  for (const pending of changes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current } = await (adminClient as any)
      .from(pending.target_table)
      .select(pending.target_column)
      .eq("id", pending.target_entity_id)
      .single();

    if (!current) continue; // entity deleted — skip silently

    const currentVal = (current as unknown as Record<string, unknown>)[pending.target_column] ?? null;
    if (JSON.stringify(currentVal) !== JSON.stringify(pending.previous_value ?? null)) {
      return {
        success: false,
        error: `"${pending.target_column}" was modified after this batch was submitted. Reject and ask the requester to resubmit.`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: writeErr } = await (adminClient as any)
      .from(pending.target_table)
      .update({ [pending.target_column]: pending.proposed_value, updated_at: now })
      .eq("id", pending.target_entity_id);

    if (writeErr) {
      console.error("[pending-content-changes] batch approve write failed:", writeErr);
      return { success: false, error: `Failed to apply change for "${pending.target_column}"` };
    }

    approvedCount++;
  }

  // Mark all approved
  await adminClient
    .from("pending_content_changes")
    .update({ status: "approved", reviewed_by: auth.ctx.userId, reviewed_at: now, updated_at: now })
    .eq("batch_id", batchId)
    .eq("status", "pending");

  // Revalidate and notify (use first change for page path)
  if (changes[0]?.page_href) revalidatePath(changes[0].page_href);

  void notifyRequesterApproved(changes[0]).catch(() => {});

  return { success: true, approvedCount };
}

/** Reject all pending changes sharing a batch_id. */
export async function rejectBatch(
  batchId: string,
  options?: { note?: string }
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  const { data: changes, error: loadErr } = await adminClient
    .from("pending_content_changes")
    .select("*")
    .eq("batch_id", batchId)
    .eq("status", "pending");

  if (loadErr || !changes?.length) {
    return { success: false, error: "No pending changes found for this batch" };
  }

  await adminClient
    .from("pending_content_changes")
    .update({
      status: "rejected",
      review_note: options?.note ?? null,
      reviewed_by: auth.ctx.userId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq("batch_id", batchId)
    .eq("status", "pending");

  void notifyRequesterRejected(changes[0], options?.note).catch(() => {});

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// List pending changes (review queue)
// ─────────────────────────────────────────────────────────────────────────────

export async function listPendingChanges(opts?: {
  targetTable?: string;
  requestedBy?: string;
  limit?: number;
}): Promise<{ success: boolean; error?: string; changes?: PendingChangeWithRequester[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  let query = adminClient
    .from("pending_content_changes")
    .select(`
      *,
      requester:profiles!requested_by(id, display_name),
      reviewer:profiles!reviewed_by(id, display_name)
    `)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("requested_at", { ascending: false })
    .limit(opts?.limit ?? 50);

  if (opts?.targetTable) query = query.eq("target_table", opts.targetTable);
  if (opts?.requestedBy) query = query.eq("requested_by", opts.requestedBy);

  const { data, error } = await query;

  if (error) {
    console.error("[pending-content-changes] listPendingChanges failed:", error);
    return { success: false, error: "Failed to load pending changes" };
  }

  return { success: true, changes: data as unknown as PendingChangeWithRequester[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expire stale changes (called by internal cron route)
// ─────────────────────────────────────────────────────────────────────────────

export async function expireStaleChanges(): Promise<{ success: boolean; expiredCount?: number }> {
  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("pending_content_changes")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    console.error("[pending-content-changes] expireStaleChanges failed:", error);
    return { success: false };
  }

  const count = data?.length ?? 0;

  if (count > 0) {
    await logAuditEventSafe({
      action: "pending_changes_expired",
      entityType: "system",
      entityId: "system",
      actorId: "system",
      actorType: "system",
      details: { expiredCount: count },
    });
  }

  return { success: true, expiredCount: count };
}

// ─────────────────────────────────────────────────────────────────────────────
// My pending changes (for the submitter's bell notifications)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMyPendingChanges(): Promise<{
  success: boolean;
  error?: string;
  changes?: PendingContentChange[];
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await adminClient
    .from("pending_content_changes")
    .select("id, target_table, target_column, target_entity_id, entity_display_name, field_display_label, proposed_value, previous_value, status, requested_at, expires_at, review_note, page_href, anchor_id")
    .eq("requested_by", auth.ctx.userId)
    .in("status", ["pending", "rejected"])
    .gt("requested_at", thirtyDaysAgo)
    .order("requested_at", { ascending: false });

  if (error) {
    return { success: false, error: "Failed to load your pending changes" };
  }

  return { success: true, changes: data as PendingContentChange[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: email helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getApprovers(superAdminOnly: boolean): Promise<{ id: string; email: string }[]> {
  const adminClient = createAdminClient();
  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id, global_role")
    .in("global_role", superAdminOnly ? ["super_admin"] : ["admin", "super_admin"]);

  if (!profiles?.length) return [];

  const userIds = profiles.map((p) => p.id);
  const emailMap = await lookupUserEmailsByIds(adminClient, userIds);
  return userIds.filter((id) => emailMap[id]).map((id) => ({ id, email: emailMap[id] }));
}

async function getRequesterEmail(userId: string): Promise<string | null> {
  const adminClient = createAdminClient();
  const { data: user } = await adminClient.auth.admin.getUserById(userId);
  return user?.user?.email ?? null;
}

async function notifyApprovers(
  pendingChangeId: string,
  params: QueueTier2ChangeParams
): Promise<void> {
  const superAdminOnly = requiresSuperAdminApproval(params.targetTable, params.targetColumn);
  const approvers = await getApprovers(superAdminOnly);
  if (!approvers.length) return;

  for (const approver of approvers) {
    const tokenResult = await createReviewToken(pendingChangeId, approver.id);
    const reviewUrl = tokenResult.success && tokenResult.token && params.pageHref
      ? `${params.pageHref}?review_token=${tokenResult.token}#${params.anchorId}`
      : null;

    await sendContentChangeQueued({
      to: approver.email,
      entityDisplayName: params.entityDisplayName,
      fieldLabel: params.fieldDisplayLabel,
      previousValue: params.previousValue !== null ? String(params.previousValue) : null,
      proposedValue: params.proposedValue !== null ? String(params.proposedValue) : null,
      reviewUrl,
      superAdminOnly,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
  }
}

async function notifyRequesterApproved(pending: PendingContentChange): Promise<void> {
  const requesterEmail = await getRequesterEmail(pending.requested_by);
  if (!requesterEmail) return;

  await sendContentChangeApproved({
    to: requesterEmail,
    entityDisplayName: pending.entity_display_name ?? "",
    fieldLabel: pending.field_display_label ?? pending.target_column,
    approvedValue: pending.proposed_value !== null ? String(pending.proposed_value) : null,
    pageHref: pending.page_href,
  });
}

async function notifyRequesterRejected(
  pending: PendingContentChange,
  note?: string,
  counterChangeId?: string
): Promise<void> {
  const requesterEmail = await getRequesterEmail(pending.requested_by);
  if (!requesterEmail) return;

  await sendContentChangeRejected({
    to: requesterEmail,
    entityDisplayName: pending.entity_display_name ?? "",
    fieldLabel: pending.field_display_label ?? pending.target_column,
    proposedValue: pending.proposed_value !== null ? String(pending.proposed_value) : null,
    rejectionNote: note ?? null,
    hasCounterProposal: Boolean(counterChangeId),
    pageHref: pending.page_href,
  });
}
