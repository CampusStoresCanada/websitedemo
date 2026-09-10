"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { runChecklistReminders, type ChecklistRunResult } from "@/lib/conference/checklist-engine";
import { CHECK_TYPES, type CheckType } from "@/lib/conference/checklist-check-types";
import { revalidatePath } from "next/cache";

type Result<T> = { success: true; data: T } | { success: false; error: string };

// ── Checklists ──────────────────────────────────────────────────────

export type ChecklistInput = {
  id?: string;
  name: string;
  description: string | null;
  scopeEntityId: string | null;
  /**
   * Target everyone listed in a publication instead of everyone who bought
   * something at the conference. Mutually exclusive with scopeEntityId — one
   * says "orgs holding this item", the other says "orgs printed in this book",
   * and they answer different questions.
   */
  publicationId?: string | null;
  deadlineAt: string; // ISO
  active: boolean;
};

export async function saveChecklist(
  conferenceId: string,
  input: ChecklistInput
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.name.trim()) return { success: false, error: "Give the checklist a name." };
  if (!input.deadlineAt) return { success: false, error: "Set a deadline." };

  const db = createAdminClient();
  // ⚠️ `publicationId` is a THREE-state field, and the distinction is
  // load-bearing: `undefined` means "this caller does not manage publication
  // scope, leave it alone", `null` means "clear it". Writing `?? null` here
  // instead would let any older form that has never heard of publication scope
  // silently wipe it on an unrelated edit — the Directory Listing checklist
  // would quietly revert from 123 organisations to the 30 who bought something.
  const managesPublication = input.publicationId !== undefined;
  const row = {
    conference_id: conferenceId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    // Publication scope wins and clears the entity scope: a checklist cannot
    // sensibly be "orgs holding booth 12" AND "everyone in the directory".
    scope_entity_id: input.publicationId ? null : input.scopeEntityId,
    ...(managesPublication ? { publication_id: input.publicationId } : {}),
    deadline_at: input.deadlineAt,
    active: input.active,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await db.from("conference_checklists").update(row).eq("id", input.id);
    if (error) return { success: false, error: error.message };
    revalidatePath(`/admin/conference/${conferenceId}/checklists/${input.id}`);
    return { success: true, data: { id: input.id } };
  }

  const { data, error } = await db.from("conference_checklists").insert(row).select("id").single();
  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };
  revalidatePath(`/admin/conference/${conferenceId}/checklists`);
  return { success: true, data: { id: data.id } };
}

export async function deleteChecklist(conferenceId: string, checklistId: string): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db.from("conference_checklists").delete().eq("id", checklistId);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/admin/conference/${conferenceId}/checklists`);
  return { success: true, data: null };
}

// ── Tasks ───────────────────────────────────────────────────────────

export type ChecklistTaskInput = {
  id?: string;
  name: string;
  description: string;
  checkType: CheckType;
  checkEntityId: string | null;
  sortOrder: number;
  active: boolean;
};

const ENTITY_SCOPED_CHECKS = new Set<CheckType>(["seat_assigned", "entity_purchased"]);

export async function saveChecklistTask(
  checklistId: string,
  input: ChecklistTaskInput
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.name.trim()) return { success: false, error: "Give the task a name." };
  if (!input.description.trim()) return { success: false, error: "Explain why this task matters — it's shown in the reminder email." };
  if (!CHECK_TYPES.includes(input.checkType)) return { success: false, error: "Unknown check type." };
  if (ENTITY_SCOPED_CHECKS.has(input.checkType) && !input.checkEntityId) {
    return { success: false, error: "This check type needs a specific catalog item selected." };
  }

  const db = createAdminClient();
  const row = {
    checklist_id: checklistId,
    name: input.name.trim(),
    description: input.description.trim(),
    check_type: input.checkType,
    check_entity_id: ENTITY_SCOPED_CHECKS.has(input.checkType) ? input.checkEntityId : null,
    sort_order: input.sortOrder,
    active: input.active,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await db.from("conference_checklist_tasks").update(row).eq("id", input.id);
    if (error) return { success: false, error: error.message };
    return { success: true, data: { id: input.id } };
  }

  const { data, error } = await db.from("conference_checklist_tasks").insert(row).select("id").single();
  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };
  return { success: true, data: { id: data.id } };
}

export async function deleteChecklistTask(taskId: string): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db.from("conference_checklist_tasks").delete().eq("id", taskId);
  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}

// ── Checkpoints ─────────────────────────────────────────────────────

export async function saveChecklistCheckpoint(
  checklistId: string,
  daysBeforeDeadline: number
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!Number.isInteger(daysBeforeDeadline) || daysBeforeDeadline < 0) {
    return { success: false, error: "Days-before-deadline must be a whole number, 0 or more." };
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("conference_checklist_checkpoints")
    .insert({ checklist_id: checklistId, days_before_deadline: daysBeforeDeadline })
    .select("id")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };
  return { success: true, data: { id: data.id } };
}

export async function deleteChecklistCheckpoint(checkpointId: string): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db.from("conference_checklist_checkpoints").delete().eq("id", checkpointId);
  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}

// ── Manual run ──────────────────────────────────────────────────────

export async function runChecklistRemindersNow(): Promise<Result<ChecklistRunResult>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const result = await runChecklistReminders();
  return { success: true, data: result };
}
