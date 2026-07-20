"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveChecklist } from "@/lib/actions/conference-checklists";
import { parseUTC } from "@/lib/utils";

interface EntityOption {
  id: string;
  name: string;
  kind: string;
}

interface ChecklistRow {
  id: string;
  name: string;
  description: string | null;
  scope_entity_id: string | null;
  deadline_at: string;
  active: boolean;
  created_at: string;
  conference_checklist_tasks: { count: number }[] | { count: number } | null;
  conference_checklist_checkpoints: { count: number }[] | { count: number } | null;
  scope_entity: { name: string }[] | { name: string } | null;
}

function countOf(rel: { count: number }[] | { count: number } | null): number {
  if (!rel) return 0;
  return Array.isArray(rel) ? (rel[0]?.count ?? 0) : rel.count;
}

function nameOf(rel: { name: string }[] | { name: string } | null): string | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0]?.name ?? null) : rel.name;
}

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent";

export default function ChecklistList({
  conferenceId,
  checklists,
  entities,
}: {
  conferenceId: string;
  checklists: ChecklistRow[];
  entities: EntityOption[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
        >
          {adding ? "Cancel" : "New Checklist"}
        </button>
      </div>

      {adding && (
        <NewChecklistForm
          conferenceId={conferenceId}
          entities={entities}
          onClose={() => setAdding(false)}
          onSaved={(id) => router.push(`/admin/conference/${conferenceId}/checklists/${id}`)}
        />
      )}

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {checklists.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            No checklists yet. Create one to start tracking task completion for a group of orgs.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Scope</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Deadline</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Tasks</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Checkpoints</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {checklists.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/conference/${conferenceId}/checklists/${c.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{nameOf(c.scope_entity) ?? "All registered orgs"}</td>
                  <td className="px-4 py-3 text-gray-500">{parseUTC(c.deadline_at).toLocaleDateString("en-CA")}</td>
                  <td className="px-4 py-3 text-gray-700">{countOf(c.conference_checklist_tasks)}</td>
                  <td className="px-4 py-3 text-gray-700">{countOf(c.conference_checklist_checkpoints)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {c.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function NewChecklistForm({
  conferenceId,
  entities,
  onClose,
  onSaved,
}: {
  conferenceId: string;
  entities: EntityOption[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeEntityId, setScopeEntityId] = useState("");
  const [deadlineAt, setDeadlineAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entitiesByKind = entities.reduce<Record<string, EntityOption[]>>((acc, e) => {
    (acc[e.kind] ??= []).push(e);
    return acc;
  }, {});

  async function save() {
    if (!deadlineAt) {
      setError("Set a deadline.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveChecklist(conferenceId, {
      name,
      description: description || null,
      scopeEntityId: scopeEntityId || null,
      deadlineAt: new Date(`${deadlineAt}T00:00:00`).toISOString(),
      active: true,
    });
    setSaving(false);
    if (res.success) onSaved(res.data.id);
    else setError(res.error);
  }

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Booth Readiness"
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this checklist is tracking, for your own reference"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Scope (optional)</label>
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
          <p className="mt-1 text-xs text-gray-500">Only orgs holding this item are in scope. Blank = every org with a purchase for this conference.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Deadline</label>
          <input
            type="date"
            value={deadlineAt}
            onChange={(e) => setDeadlineAt(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">Checkpoints are set as days-before this date, once created.</p>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={save}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create & continue"}
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
