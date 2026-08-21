"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveChecklist,
  saveChecklistTask,
  deleteChecklistTask,
  saveChecklistCheckpoint,
  deleteChecklistCheckpoint,
  runChecklistRemindersNow,
} from "@/lib/actions/conference-checklists";
import { CHECK_TYPES, type CheckType } from "@/lib/conference/checklist-check-types";
import type { ChecklistRunResult } from "@/lib/conference/checklist-engine";
import type { Tables } from "@/lib/database.types";
import { parseUTC } from "@/lib/utils";

type Checklist = Tables<"conference_checklists">;
type Task = Tables<"conference_checklist_tasks">;
type Checkpoint = Tables<"conference_checklist_checkpoints">;

interface EntityOption {
  id: string;
  name: string;
  kind: string;
}

interface LogRow {
  id: string;
  sent_at: string;
  organization: { name: string }[] | { name: string } | null;
  checkpoint: { days_before_deadline: number }[] | { days_before_deadline: number } | null;
}

function one<T>(rel: T[] | T | null): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent";

const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  seat_assigned: "Seat assigned (for a catalog item)",
  entity_purchased: "Item purchased (for a catalog item)",
  travel_info_submitted: "Travel info submitted (per org, all attendees)",
  payment_complete: "Payment complete",
  legal_document_accepted: "Legal document accepted (per org, all attendees)",
  directory_profile_complete: "Directory listing ready (logo, description, categories, contacts)",
};

const ENTITY_SCOPED = new Set<CheckType>(["seat_assigned", "entity_purchased"]);

type TaskFormState = { mode: "add" } | { mode: "edit"; id: string } | null;

export default function ChecklistDetail({
  conferenceId,
  checklist,
  tasks,
  checkpoints,
  entities,
  log,
}: {
  conferenceId: string;
  checklist: Checklist;
  tasks: Task[];
  checkpoints: Checkpoint[];
  entities: EntityOption[];
  log: LogRow[];
}) {
  const router = useRouter();
  const [taskForm, setTaskForm] = useState<TaskFormState>(null);
  const [runResult, setRunResult] = useState<ChecklistRunResult | null>(null);
  const [running, setRunning] = useState(false);

  return (
    <div className="space-y-8">
      <ChecklistMetaForm conferenceId={conferenceId} checklist={checklist} entities={entities} onSaved={() => router.refresh()} />

      {/* Tasks */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-900">Tasks</h2>
          <button
            type="button"
            onClick={() => setTaskForm({ mode: "add" })}
            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            + Add Task
          </button>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
          {taskForm?.mode === "add" && (
            <div className="p-4">
              <TaskForm
                checklistId={checklist.id}
                task={null}
                entities={entities}
                nextSortOrder={tasks.length}
                onClose={() => setTaskForm(null)}
                onSaved={() => {
                  setTaskForm(null);
                  router.refresh();
                }}
              />
            </div>
          )}
          {tasks.length === 0 && taskForm?.mode !== "add" && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No tasks yet. Each task needs a check that reads something real — see the check-type list when adding one.
            </div>
          )}
          {tasks.map((task) =>
            taskForm?.mode === "edit" && taskForm.id === task.id ? (
              <div key={task.id} className="p-4">
                <TaskForm
                  checklistId={checklist.id}
                  task={task}
                  entities={entities}
                  nextSortOrder={task.sort_order}
                  onClose={() => setTaskForm(null)}
                  onSaved={() => {
                    setTaskForm(null);
                    router.refresh();
                  }}
                />
              </div>
            ) : (
              <div key={task.id} className="p-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {task.name}
                    {!task.active && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        Inactive
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">{task.description}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {CHECK_TYPE_LABELS[task.check_type as CheckType]}
                    {task.check_entity_id && (
                      <> — {entities.find((e) => e.id === task.check_entity_id)?.name ?? "unknown item"}</>
                    )}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setTaskForm({ mode: "edit", id: task.id })}
                    className="text-xs text-accent hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Delete task "${task.name}"?`)) return;
                      const res = await deleteChecklistTask(task.id);
                      if (res.success) router.refresh();
                      else window.alert(res.error);
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </section>

      {/* Checkpoints */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Schedule</h2>
        <p className="text-xs text-gray-500 mb-3">
          Days-before-deadline. Space these tighter near the deadline for an escalating cadence — a due, unlogged
          checkpoint sends a digest to every org still incomplete.
        </p>
        <CheckpointList
          checklistId={checklist.id}
          checkpoints={checkpoints}
          deadlineAt={checklist.deadline_at}
          onChanged={() => router.refresh()}
        />
      </section>

      {/* Run now */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Send Reminders Now</h2>
        <p className="text-xs text-gray-500 mb-3">
          Runs the exact same evaluation the daily cron uses — for every active checklist across every conference, not
          just this one. Anyone already logged for their due checkpoint, or already fully caught up, is skipped.
        </p>
        <button
          type="button"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            setRunResult(null);
            const res = await runChecklistRemindersNow();
            setRunning(false);
            if (res.success) {
              setRunResult(res.data);
              router.refresh();
            } else {
              window.alert(res.error);
            }
          }}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {running ? "Running…" : "Send Reminders Now"}
        </button>
        {runResult && (
          <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <p>
              Checklists processed: {runResult.checklistsProcessed} · Orgs reminded: {runResult.orgsReminded}
            </p>
            {runResult.errors.length > 0 && (
              <ul className="mt-1 text-red-600 list-disc list-inside">
                {runResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Log */}
      {log.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Recent Sends</h2>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Organization</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Checkpoint</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {log.map((row) => {
                  const org = one(row.organization);
                  const cp = one(row.checkpoint);
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-2 text-gray-900">{org?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-500">
                        {cp ? `${cp.days_before_deadline}d before deadline` : "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{parseUTC(row.sent_at).toLocaleString("en-CA")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function ChecklistMetaForm({
  conferenceId,
  checklist,
  entities,
  onSaved,
}: {
  conferenceId: string;
  checklist: Checklist;
  entities: EntityOption[];
  onSaved: () => void;
}) {
  const [name, setName] = useState(checklist.name);
  const [description, setDescription] = useState(checklist.description ?? "");
  const [scopeEntityId, setScopeEntityId] = useState(checklist.scope_entity_id ?? "");
  const [deadlineAt, setDeadlineAt] = useState(checklist.deadline_at.slice(0, 10));
  const [active, setActive] = useState(checklist.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entitiesByKind = entities.reduce<Record<string, EntityOption[]>>((acc, e) => {
    (acc[e.kind] ??= []).push(e);
    return acc;
  }, {});

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveChecklist(conferenceId, {
      id: checklist.id,
      name,
      description: description || null,
      scopeEntityId: scopeEntityId || null,
      deadlineAt: new Date(`${deadlineAt}T00:00:00`).toISOString(),
      active,
    });
    setSaving(false);
    if (res.success) onSaved();
    else setError(res.error);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Deadline</label>
          <input type="date" value={deadlineAt} onChange={(e) => setDeadlineAt(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Scope</label>
          <select value={scopeEntityId} onChange={(e) => setScopeEntityId(e.target.value)} className={inputClass}>
            <option value="">All registered orgs</option>
            {Object.entries(entitiesByKind).map(([kind, items]) => (
              <optgroup key={kind} label={kind}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </section>
  );
}

function TaskForm({
  checklistId,
  task,
  entities,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  checklistId: string;
  task: Task | null;
  entities: EntityOption[];
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(task?.name ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [checkType, setCheckType] = useState<CheckType>((task?.check_type as CheckType) ?? "seat_assigned");
  const [checkEntityId, setCheckEntityId] = useState(task?.check_entity_id ?? "");
  const [active, setActive] = useState(task?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entitiesByKind = entities.reduce<Record<string, EntityOption[]>>((acc, e) => {
    (acc[e.kind] ??= []).push(e);
    return acc;
  }, {});

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveChecklistTask(checklistId, {
      id: task?.id,
      name,
      description,
      checkType,
      checkEntityId: checkEntityId || null,
      sortOrder: task?.sort_order ?? nextSortOrder,
      active,
    });
    setSaving(false);
    if (res.success) onSaved();
    else setError(res.error);
  }

  return (
    <div className="space-y-3">
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Task name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Assign your booth staff"
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Why this matters (shown in the reminder email)</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Booths without assigned staff can't be checked in on-site."
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Check</label>
          <select value={checkType} onChange={(e) => setCheckType(e.target.value as CheckType)} className={inputClass}>
            {CHECK_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {CHECK_TYPE_LABELS[ct]}
              </option>
            ))}
          </select>
        </div>
        {ENTITY_SCOPED.has(checkType) && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Catalog item</label>
            <select value={checkEntityId} onChange={(e) => setCheckEntityId(e.target.value)} className={inputClass}>
              <option value="">— Select an item —</option>
              {Object.entries(entitiesByKind).map(([kind, items]) => (
                <optgroup key={kind} label={kind}>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !name.trim() || !description.trim()}
          onClick={save}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Task"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function CheckpointList({
  checklistId,
  checkpoints,
  deadlineAt,
  onChanged,
}: {
  checklistId: string;
  checkpoints: Checkpoint[];
  deadlineAt: string;
  onChanged: () => void;
}) {
  const [days, setDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadline = parseUTC(deadlineAt);

  function targetDate(daysBeforeDeadline: number): string {
    const d = new Date(deadline);
    d.setDate(d.getDate() - daysBeforeDeadline);
    return d.toLocaleDateString("en-CA");
  }

  async function add() {
    const parsed = parseInt(days, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError("Enter a whole number of days.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveChecklistCheckpoint(checklistId, parsed);
    setSaving(false);
    if (res.success) {
      setDays("");
      onChanged();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {error && <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {checkpoints.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">Days before deadline</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Target date</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {checkpoints.map((cp) => (
              <tr key={cp.id}>
                <td className="px-4 py-2 text-gray-900">{cp.days_before_deadline}</td>
                <td className="px-4 py-2 text-gray-500">{targetDate(cp.days_before_deadline)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await deleteChecklistCheckpoint(cp.id);
                      if (res.success) onChanged();
                      else window.alert(res.error);
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="p-4 flex items-end gap-2 border-t border-gray-100">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Days before deadline</label>
          <input
            type="number"
            min={0}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="e.g. 14"
            className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        <button
          type="button"
          disabled={saving || !days}
          onClick={add}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Add Checkpoint
        </button>
      </div>
    </div>
  );
}
