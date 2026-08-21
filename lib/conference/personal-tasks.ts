/**
 * The personal half of the exhibitor checklist — what each attendee answers for
 * themselves, as opposed to what an org admin answers for the company.
 *
 * Deliberately separate from `DataObligation` (lib/conference/grants.ts), which
 * means "you must supply this field because of a grant you hold" — an emergency
 * contact for an offsite seat, dietary restrictions for meal access. Those are
 * requirements.
 *
 * These are check-ins. A hotel booking is not owed to CSC: the attendee may
 * have booked already, or be staying somewhere else entirely, and both are
 * complete answers. Conflating the two would either nag people who are fine or
 * let a real requirement be dismissed.
 *
 * Hence three states — done, not applicable, not yet — carried by
 * `conference_task_acknowledgements` with `person_id` set. Where a real capture
 * already exists (a hotel confirmation code) it counts as done on its own, so
 * nobody is asked to tick a box about something they already told us.
 */

import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type PersonalTaskState = "done" | "not_applicable" | "pending";

export type PersonalTask = {
  taskId: string;
  name: string;
  description: string;
  state: PersonalTaskState;
  /** What they told us, when they told us something (a confirmation code). */
  evidence: string | null;
  /** True when the state came from real captured data, not a tick. */
  derived: boolean;
  /** ISO date this closes, from the task's checklist. */
  deadline: string | null;
};

/**
 * Fields on `conference_people` that already answer a task without anyone
 * ticking anything. Keyed by task name so the mapping is visible and editable
 * in one place rather than hidden behind a check-type switch.
 *
 * `hotel_confirmation_code` has existed on the table since before this feature
 * and was read by nothing — asking for it turns hotel from self-reported into
 * genuinely captured.
 */
const DERIVED_FROM_FIELD: Record<string, string> = {
  "Book your hotel room": "hotel_confirmation_code",
};

/** Tasks this person is being asked about, with their current state. */
export async function loadPersonalTasks(
  db: AdminClient,
  conferenceId: string,
  personId: string
): Promise<PersonalTask[]> {
  const [{ data: checklists }, { data: person }] = await Promise.all([
    db
      .from("conference_checklists")
      .select("id, deadline_at, conference_checklist_tasks(id, name, description, sort_order, active, audience)")
      .eq("conference_id", conferenceId)
      .eq("active", true),
    db.from("conference_people").select("hotel_confirmation_code").eq("id", personId).maybeSingle(),
  ]);

  type TaskRow = { id: string; name: string; description: string; sort_order: number; active: boolean; audience: string };
  const rows: { task: TaskRow; deadline: string | null }[] = [];
  for (const cl of checklists ?? []) {
    const tasks = (cl as unknown as { conference_checklist_tasks: TaskRow[] }).conference_checklist_tasks ?? [];
    for (const task of tasks) {
      if (!task.active || task.audience !== "person") continue;
      rows.push({ task, deadline: (cl as { deadline_at: string | null }).deadline_at });
    }
  }
  if (rows.length === 0) return [];

  const { data: acks } = await db
    .from("conference_task_acknowledgements")
    .select("task_id, state, evidence")
    .eq("person_id", personId)
    .in("task_id", rows.map((r) => r.task.id));
  const ackByTask = new Map((acks ?? []).map((a) => [a.task_id, a]));

  const personFields = (person ?? {}) as Record<string, unknown>;

  return rows
    .sort((a, b) => a.task.sort_order - b.task.sort_order)
    .map(({ task, deadline }): PersonalTask => {
      const derivedField = DERIVED_FROM_FIELD[task.name];
      const derivedValue = derivedField ? personFields[derivedField] : null;
      if (typeof derivedValue === "string" && derivedValue.trim().length > 0) {
        return { taskId: task.id, name: task.name, description: task.description,
                 state: "done", evidence: derivedValue, derived: true, deadline };
      }
      const ack = ackByTask.get(task.id);
      return {
        taskId: task.id,
        name: task.name,
        description: task.description,
        state: ack ? (ack.state as PersonalTaskState) : "pending",
        evidence: ack?.evidence ?? null,
        derived: false,
        deadline,
      };
    });
}

/**
 * Record one person's answer. Idempotent per (task, person) — answering again
 * replaces the previous answer rather than stacking, so "actually I did book
 * after all" works without an extra clear step.
 *
 * When the task maps to a real column and evidence is supplied, the column is
 * written too: a confirmation code belongs on the person, not buried in an
 * acknowledgement row.
 */
export async function recordPersonalTaskAnswer(
  db: AdminClient,
  input: {
    conferenceId: string;
    taskId: string;
    personId: string;
    organizationId: string;
    state: "done" | "not_applicable";
    evidence?: string | null;
    userId?: string | null;
  }
): Promise<{ success: true } | { success: false; error: string }> {
  const { data: task } = await db
    .from("conference_checklist_tasks").select("name").eq("id", input.taskId).maybeSingle();

  const evidence = input.evidence?.trim() || null;
  const field = task?.name ? DERIVED_FROM_FIELD[task.name] : undefined;
  if (field && evidence && input.state === "done") {
    const { error } = await db
      .from("conference_people").update({ [field]: evidence }).eq("id", input.personId);
    if (error) return { success: false, error: error.message };
  }

  const { error } = await db
    .from("conference_task_acknowledgements")
    .upsert({
      conference_id: input.conferenceId,
      task_id: input.taskId,
      organization_id: input.organizationId,
      person_id: input.personId,
      state: input.state,
      evidence,
      acknowledged_by: input.userId ?? null,
      acknowledged_at: new Date().toISOString(),
    }, { onConflict: "task_id,person_id" });
  if (error) return { success: false, error: error.message };
  return { success: true };
}
