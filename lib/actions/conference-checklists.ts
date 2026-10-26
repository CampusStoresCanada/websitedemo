"use server";

import { requireAdmin, requireSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { runChecklistReminders, type ChecklistRunResult } from "@/lib/conference/checklist-engine";
import {
  CHECK_TYPES,
  STAFF_TASK_CHECK_TYPES,
  TASK_AUDIENCES,
  type CheckType,
  type StaffCheckType,
  type TaskAudience,
} from "@/lib/conference/checklist-check-types";
import { revalidatePath } from "next/cache";

type Result<T> = { success: true; data: T } | { success: false; error: string };

// ── Checklists ──────────────────────────────────────────────────────

export type ChecklistInput = {
  id?: string;
  name: string;
  description: string | null;
  scopeEntityId: string | null;
  /**
   * Scope to a KIND of holding — "whoever has a booth" — rather than one
   * particular entity. Booths are 60 separately numbered entities, so
   * scopeEntityId could never express the Exhibitor checklist's real audience.
   * Three-state like publicationId: `undefined` leaves it alone.
   */
  scopeEntityKind?: string | null;
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
  const managesEntityKind = input.scopeEntityKind !== undefined;
  const row = {
    conference_id: conferenceId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    // Publication scope wins and clears the entity scope: a checklist cannot
    // sensibly be "orgs holding booth 12" AND "everyone in the directory".
    scope_entity_id: input.publicationId ? null : input.scopeEntityId,
    ...(managesEntityKind
      ? { scope_entity_kind: input.publicationId ? null : input.scopeEntityKind }
      : {}),
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
  /** Who answers. `undefined` leaves an existing task's audience alone. */
  audience?: TaskAudience;
  /**
   * Documents from the conference's Documents page that belong to this task
   * (a speech, a run-sheet). `undefined` leaves them alone.
   */
  documentIds?: string[];
  checkType: CheckType | StaffCheckType;
  checkEntityId: string | null;
  /**
   * Restrict the task to orgs holding a kind of thing — "a booth". Three-state
   * like the checklist's: `undefined` leaves it alone, `null` clears it.
   * Needed because a `self_reported` check has nothing to read and so cannot
   * notice that the org it is asking has no booth.
   */
  scopeEntityKind?: string | null;
  /**
   * Restrict to orgs holding one NAMED thing, rather than a class of them.
   * "Ship your Conference in a Box" cannot be scoped by kind: that is an
   * `item`, and so are the folding tables bundled with every booth.
   * Three-state like the others — `undefined` leaves it alone.
   */
  scopeEntityId?: string | null;
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
  if (input.audience !== undefined && !TASK_AUDIENCES.includes(input.audience)) {
    return { success: false, error: "Unknown audience." };
  }
  // Staff checks read the conference, org checks read a company: neither is
  // meaningful for the other's answerer.
  const allowed: readonly string[] = input.audience === "staff" ? STAFF_TASK_CHECK_TYPES : CHECK_TYPES;
  if (!allowed.includes(input.checkType)) {
    return { success: false, error: "That check doesn't apply to who answers this task." };
  }
  const isStaff = input.audience === "staff";
  if (!isStaff && ENTITY_SCOPED_CHECKS.has(input.checkType as CheckType) && !input.checkEntityId) {
    return { success: false, error: "This check type needs a specific catalog item selected." };
  }

  const db = createAdminClient();
  const row = {
    checklist_id: checklistId,
    name: input.name.trim(),
    description: input.description.trim(),
    check_type: input.checkType,
    check_entity_id: !isStaff && ENTITY_SCOPED_CHECKS.has(input.checkType as CheckType) ? input.checkEntityId : null,
    ...(input.audience !== undefined ? { audience: input.audience } : {}),
    ...(input.documentIds !== undefined
      ? { document_ids: [...new Set(input.documentIds.filter((id) => typeof id === "string" && id))] }
      : {}),
    // A staff task has no org to scope by.
    ...(isStaff
      ? { scope_entity_kind: null, scope_entity_id: null }
      : {
          ...(input.scopeEntityKind !== undefined ? { scope_entity_kind: input.scopeEntityKind } : {}),
          ...(input.scopeEntityId !== undefined ? { scope_entity_id: input.scopeEntityId } : {}),
        }),
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

/**
 * The War Room's "Send reminders now": this conference's checklists only, the
 * same engine the daily cron runs for every conference. `dryRun` is its
 * Preview: who would get what, sending and writing nothing.
 *
 * ⛔ It used to run every active checklist on the site, from any one
 * checklist's page (WAR_ROOM_OPERATE_PLAN §8.1).
 */
export async function runConferenceRemindersNow(
  conferenceId: string,
  options: { dryRun?: boolean } = {}
): Promise<Result<ChecklistRunResult>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const result = await runChecklistReminders({ conferenceId, dryRun: options.dryRun === true });
  return { success: true, data: result };
}
