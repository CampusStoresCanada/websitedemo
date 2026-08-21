/**
 * The exhibitor checklist as people see it — both halves. — what each attendee answers for
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
import { evaluateChecklistTaskCheck } from "./checklist-checks";
import type { CheckType } from "./checklist-check-types";

type AdminClient = ReturnType<typeof createAdminClient>;

export type PersonalTaskState = "done" | "not_applicable" | "pending";

/**
 * Whether the viewer can tick this off. `monitored` tasks are answered by the
 * site itself — payment, seat assignment, the directory listing — and show as
 * read-only state. Only `self_reported` ones get buttons.
 */
export type TaskSource = "self_reported" | "monitored";

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
  source: TaskSource;
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


/**
 * Write one answer, replacing any previous one.
 *
 * Explicit read-then-write rather than upsert: the uniqueness that makes an
 * answer singular lives in two PARTIAL indexes (person_id IS NULL / IS NOT
 * NULL), because Postgres treats NULLs as distinct and a plain unique index
 * would let an org stack duplicate company-level answers. A partial index can
 * only be an ON CONFLICT target together with its WHERE clause, which PostgREST
 * cannot express — an upsert here fails at runtime with 42P10 while
 * type-checking perfectly. Verified against the real table before writing this.
 */
async function writeAnswer(
  db: AdminClient,
  row: {
    conference_id: string; task_id: string; organization_id: string;
    person_id: string | null; state: string; evidence: string | null;
    acknowledged_by: string | null;
  }
): Promise<{ success: true } | { success: false; error: string }> {
  let existing = db
    .from("conference_task_acknowledgements")
    .select("id")
    .eq("task_id", row.task_id);
  existing = row.person_id
    ? existing.eq("person_id", row.person_id)
    : existing.eq("organization_id", row.organization_id).is("person_id", null);

  const { data: found } = await existing.maybeSingle();
  const now = new Date().toISOString();

  const { error } = found
    ? await db
        .from("conference_task_acknowledgements")
        .update({ state: row.state, evidence: row.evidence, acknowledged_by: row.acknowledged_by, acknowledged_at: now })
        .eq("id", found.id)
    : await db
        .from("conference_task_acknowledgements")
        .insert({ ...row, acknowledged_at: now });

  if (error) return { success: false, error: error.message };
  return { success: true };
}


/**
 * Soonest deadline first, then the checklist's own order.
 *
 * Tasks come from several checklists at once — the directory closes in
 * November, exhibitor services in January — so ordering by `sort_order` alone
 * interleaves them into an order that looks arbitrary to a reader. What's due
 * next should be at the top. Undated tasks sink to the bottom rather than
 * jumping ahead of real deadlines.
 */
function byDeadlineThenOrder(
  a: { deadline: string | null; task: { sort_order: number } },
  b: { deadline: string | null; task: { sort_order: number } }
): number {
  const at = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
  const bt = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;
  return a.task.sort_order - b.task.sort_order;
}

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
    .sort(byDeadlineThenOrder)
    .map(({ task, deadline }): PersonalTask => {
      const derivedField = DERIVED_FROM_FIELD[task.name];
      const derivedValue = derivedField ? personFields[derivedField] : null;
      if (typeof derivedValue === "string" && derivedValue.trim().length > 0) {
        return { taskId: task.id, name: task.name, description: task.description,
                 state: "done", evidence: derivedValue, derived: true, deadline,
                 source: "self_reported" };
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
        source: "self_reported",
      };
    });
}

/**
 * The company's tasks, as an org admin sees them.
 *
 * Monitored and self-reported items appear in ONE list. A partner shouldn't have
 * to know which of their obligations the site can see — they want the list of
 * what's outstanding. Monitored state is evaluated through the reminder engine's
 * own `evaluateChecklistTaskCheck`, so this page can never disagree with the
 * email they just received about the same task.
 */
export async function loadOrgTasks(
  db: AdminClient,
  conferenceId: string,
  organizationId: string,
  /** Narrow to one checklist — used by surfaces that own a single topic, like
   *  the listing proof showing only its own approval. */
  checklistId?: string
): Promise<PersonalTask[]> {
  let q = db
    .from("conference_checklists")
    .select("id, deadline_at, conference_checklist_tasks(id, name, description, sort_order, active, audience, check_type, check_entity_id)")
    .eq("conference_id", conferenceId)
    .eq("active", true);
  if (checklistId) q = q.eq("id", checklistId);
  const { data: checklists } = await q;

  type TaskRow = {
    id: string; name: string; description: string; sort_order: number;
    active: boolean; audience: string; check_type: string; check_entity_id: string | null;
  };
  const rows: { task: TaskRow; deadline: string | null }[] = [];
  for (const cl of checklists ?? []) {
    const tasks = (cl as unknown as { conference_checklist_tasks: TaskRow[] }).conference_checklist_tasks ?? [];
    for (const task of tasks) {
      if (!task.active || task.audience !== "org") continue;
      rows.push({ task, deadline: (cl as { deadline_at: string | null }).deadline_at });
    }
  }
  if (rows.length === 0) return [];

  const { data: acks } = await db
    .from("conference_task_acknowledgements")
    .select("task_id, state, evidence")
    .eq("organization_id", organizationId)
    .is("person_id", null)
    .in("task_id", rows.map((r) => r.task.id));
  const ackByTask = new Map((acks ?? []).map((a) => [a.task_id, a]));

  return Promise.all(
    rows
      .sort(byDeadlineThenOrder)
      .map(async ({ task, deadline }): Promise<PersonalTask> => {
        if (task.check_type === "self_reported") {
          const ack = ackByTask.get(task.id);
          return {
            taskId: task.id, name: task.name, description: task.description,
            state: ack ? (ack.state as PersonalTaskState) : "pending",
            evidence: ack?.evidence ?? null, derived: false, deadline,
            source: "self_reported",
          };
        }
        const complete = await evaluateChecklistTaskCheck(
          db, task.check_type as CheckType, organizationId, conferenceId, task.check_entity_id, task.id
        );
        return {
          taskId: task.id, name: task.name, description: task.description,
          state: complete ? "done" : "pending",
          evidence: null, derived: true, deadline, source: "monitored",
        };
      })
  );
}

/** Record the company's answer to a self-reported task. */
export async function recordOrgTaskAnswer(
  db: AdminClient,
  input: {
    conferenceId: string; taskId: string; organizationId: string;
    state: "done" | "not_applicable"; evidence?: string | null; userId?: string | null;
  }
): Promise<{ success: true } | { success: false; error: string }> {
  return writeAnswer(db, {
    conference_id: input.conferenceId,
    task_id: input.taskId,
    organization_id: input.organizationId,
    person_id: null,
    state: input.state,
    evidence: input.evidence?.trim() || null,
    acknowledged_by: input.userId ?? null,
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

  return writeAnswer(db, {
    conference_id: input.conferenceId,
    task_id: input.taskId,
    organization_id: input.organizationId,
    person_id: input.personId,
    state: input.state,
    evidence,
    acknowledged_by: input.userId ?? null,
  });
}
