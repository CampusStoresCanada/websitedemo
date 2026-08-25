/**
 * The admin's view of where people actually are on their personal checklist
 * tasks — the counterpart to loadPersonalTasks(), which answers the same
 * question one attendee at a time.
 *
 * Exists because nothing on the admin side read
 * `conference_task_acknowledgements` at all: the site could nag an attendee
 * about their hotel booking and then had no way to tell staff how many people
 * were still outstanding.
 *
 * The state rules are deliberately duplicated from loadPersonalTasks() in only
 * one place — summarizePersonTasks() below — so an admin count can never
 * disagree with what the attendee is looking at on their own page. If the
 * derivation rules change there, this must change with them.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { DERIVED_FROM_FIELD, type PersonalTaskState } from "./checklist-tasks";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface PersonTaskPerson {
  personId: string;
  name: string;
  organizationName: string;
}

export interface PersonTaskSummary {
  taskId: string;
  name: string;
  description: string;
  deadline: string | null;
  checklistName: string;
  done: number;
  notApplicable: number;
  pending: number;
  /** How many of the `done` came from captured data rather than a tick. */
  derived: number;
  /** Who is still outstanding — the actionable half. */
  outstanding: PersonTaskPerson[];
}

/**
 * A task nobody is being asked about, and why.
 *
 * The two reasons are separately toggleable and need separately accurate
 * wording: "make the checklist active" is the wrong instruction for a task
 * that is switched off inside a checklist that is already live.
 */
export interface InactivePersonTask {
  name: string;
  reason: "checklist_off" | "task_off";
}

export interface PersonTaskStatus {
  /** People the tasks are asked of. Zero means there is nobody to chase yet. */
  population: number;
  /**
   * Tasks that exist but are asked of nobody. Without this an admin sees an
   * empty panel and cannot tell "nobody is outstanding" from "this was never
   * turned on" — which is the actual state most of the year.
   */
  inactiveTasks: InactivePersonTask[];
  tasks: PersonTaskSummary[];
}

/** Shape of one checklist as the loader reads it, kept separate so the
 *  active/inactive split can be tested without a database. */
export interface ChecklistShape {
  name: string;
  active: boolean;
  deadline_at: string | null;
  tasks: Array<{
    id: string; name: string; description: string;
    sort_order: number; active: boolean; audience: string;
  }>;
}

/**
 * Split person-audience tasks into "being asked" and "not being asked, for
 * this reason". Org-audience tasks are dropped entirely — this panel is about
 * what individuals answer, and an org task switched off has nothing to say
 * here.
 */
export function classifyPersonTasks(checklists: ChecklistShape[]): {
  tasks: TaskInput[];
  inactive: InactivePersonTask[];
} {
  const tasks: TaskInput[] = [];
  const inactive: InactivePersonTask[] = [];

  for (const checklist of checklists) {
    for (const task of checklist.tasks) {
      if (task.audience !== "person") continue;
      // Checklist first: when the whole list is off, that is the fact worth
      // reporting even if the task is also off — turning the task on would
      // change nothing on its own.
      if (!checklist.active) {
        inactive.push({ name: task.name, reason: "checklist_off" });
        continue;
      }
      if (!task.active) {
        inactive.push({ name: task.name, reason: "task_off" });
        continue;
      }
      tasks.push({
        id: task.id,
        name: task.name,
        description: task.description,
        sort_order: task.sort_order,
        deadline: checklist.deadline_at,
        checklistName: checklist.name,
      });
    }
  }
  return { tasks, inactive };
}

interface TaskInput {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  deadline: string | null;
  checklistName: string;
}

interface PersonInput extends PersonTaskPerson {
  /** conference_people row, for tasks answered by captured data. */
  fields: Record<string, unknown>;
}

interface AckInput {
  task_id: string;
  person_id: string;
  state: string;
}

/**
 * Pure roll-up. Mirrors loadPersonalTasks(): a derived field with a non-empty
 * value wins outright, then an explicit acknowledgement, then pending.
 */
export function summarizePersonTasks(
  tasks: TaskInput[],
  people: PersonInput[],
  acks: AckInput[]
): PersonTaskSummary[] {
  const ackByTaskPerson = new Map<string, string>();
  for (const ack of acks) {
    ackByTaskPerson.set(`${ack.task_id}:${ack.person_id}`, ack.state);
  }

  return tasks
    .slice()
    .sort((a, b) => {
      const at = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
      const bt = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
      return a.sort_order - b.sort_order;
    })
    .map((task) => {
      const derivedField = DERIVED_FROM_FIELD[task.name];
      let done = 0;
      let notApplicable = 0;
      let derived = 0;
      const outstanding: PersonTaskPerson[] = [];

      for (const person of people) {
        const derivedValue = derivedField ? person.fields[derivedField] : null;
        if (typeof derivedValue === "string" && derivedValue.trim().length > 0) {
          done++;
          derived++;
          continue;
        }
        const state = (ackByTaskPerson.get(`${task.id}:${person.personId}`) ??
          "pending") as PersonalTaskState;
        if (state === "done") done++;
        // "Staying elsewhere" is a complete answer, not a laggard — it must
        // never land in the chase list.
        else if (state === "not_applicable") notApplicable++;
        else {
          outstanding.push({
            personId: person.personId,
            name: person.name,
            organizationName: person.organizationName,
          });
        }
      }

      return {
        taskId: task.id,
        name: task.name,
        description: task.description,
        deadline: task.deadline,
        checklistName: task.checklistName,
        done,
        notApplicable,
        pending: outstanding.length,
        derived,
        outstanding: outstanding.sort(
          (a, b) =>
            a.organizationName.localeCompare(b.organizationName) ||
            a.name.localeCompare(b.name)
        ),
      };
    });
}

/** Load everything the roll-up needs, in four queries rather than per person. */
export async function loadPersonTaskStatus(
  db: AdminClient,
  conferenceId: string
): Promise<PersonTaskStatus> {
  const { data: checklists } = await db
    .from("conference_checklists")
    .select(
      "id, name, active, deadline_at, conference_checklist_tasks(id, name, description, sort_order, active, audience)"
    )
    .eq("conference_id", conferenceId);

  type TaskRow = {
    id: string; name: string; description: string;
    sort_order: number; active: boolean; audience: string;
  };

  const { tasks, inactive } = classifyPersonTasks(
    (checklists ?? []).map((cl) => {
      const row = cl as unknown as {
        name: string; active: boolean; deadline_at: string | null;
        conference_checklist_tasks: TaskRow[];
      };
      return {
        name: row.name,
        active: row.active,
        deadline_at: row.deadline_at,
        tasks: row.conference_checklist_tasks ?? [],
      };
    })
  );

  // Only select the conference_people columns some task actually derives from,
  // so adding a mapping is the only change needed to make it count here.
  const derivedColumns = [...new Set(Object.values(DERIVED_FROM_FIELD))];
  const { data: peopleRows } = await db
    .from("conference_people")
    .select(
      `id, display_name, legal_name, contact_email, organization_id, organizations(name)${
        derivedColumns.length ? `, ${derivedColumns.join(", ")}` : ""
      }`
    )
    .eq("conference_id", conferenceId);

  const people: PersonInput[] = (peopleRows ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown> & {
      id: string; display_name: string | null; legal_name: string | null;
      contact_email: string | null; organizations: { name: string } | null;
    };
    return {
      personId: r.id,
      name: r.display_name || r.legal_name || r.contact_email || "Unnamed attendee",
      organizationName: r.organizations?.name ?? "—",
      fields: r,
    };
  });

  if (tasks.length === 0 || people.length === 0) {
    return {
      population: people.length,
      inactiveTasks: inactive,
      tasks: summarizePersonTasks(tasks, people, []),
    };
  }

  const { data: acks } = await db
    .from("conference_task_acknowledgements")
    .select("task_id, person_id, state")
    .eq("conference_id", conferenceId)
    .not("person_id", "is", null)
    .in("task_id", tasks.map((t) => t.id));

  return {
    population: people.length,
    inactiveTasks: inactive,
    tasks: summarizePersonTasks(
      tasks,
      people,
      (acks ?? []) as unknown as AckInput[]
    ),
  };
}

export interface ViewerTaskState {
  state: PersonalTaskState;
  /** What they told us — a hotel confirmation code, where we have one. */
  evidence: string | null;
  /** True when the state came from captured data rather than a tick. */
  derived: boolean;
}

/**
 * One task's state for the person currently looking at a public page, so a
 * page can stop nagging someone who has already dealt with it.
 *
 * Returns null when there is nobody to answer for — anonymous viewers, and
 * signed-in people who aren't registered for this conference. Callers should
 * treat null as "show the generic version", never as "outstanding".
 *
 * Deliberately does NOT require the checklist to be active, unlike
 * loadPersonalTasks(). `active` governs whether we ASK someone about a task;
 * it has no bearing on whether we already KNOW the answer. If we are holding
 * this person's hotel confirmation code, telling them to hurry up and book is
 * wrong whether or not the checklist has been switched on.
 */
export async function loadViewerTaskState(
  db: AdminClient,
  conferenceId: string,
  userId: string,
  taskName: string
): Promise<ViewerTaskState | null> {
  const derivedField = DERIVED_FROM_FIELD[taskName];
  const { data: person } = await db
    .from("conference_people")
    .select(`id${derivedField ? `, ${derivedField}` : ""}`)
    .eq("conference_id", conferenceId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!person) return null;

  const row = person as unknown as Record<string, unknown> & { id: string };
  const derivedValue = derivedField ? row[derivedField] : null;
  if (typeof derivedValue === "string" && derivedValue.trim().length > 0) {
    return { state: "done", evidence: derivedValue.trim(), derived: true };
  }

  const { data: task } = await db
    .from("conference_checklist_tasks")
    .select("id, conference_checklists!inner(conference_id)")
    .eq("name", taskName)
    .eq("conference_checklists.conference_id", conferenceId)
    .limit(1)
    .maybeSingle();

  if (!task) return { state: "pending", evidence: null, derived: false };

  const { data: ack } = await db
    .from("conference_task_acknowledgements")
    .select("state, evidence")
    .eq("task_id", (task as { id: string }).id)
    .eq("person_id", row.id)
    .maybeSingle();

  return {
    state: (ack?.state as PersonalTaskState) ?? "pending",
    evidence: ack?.evidence ?? null,
    derived: false,
  };
}
