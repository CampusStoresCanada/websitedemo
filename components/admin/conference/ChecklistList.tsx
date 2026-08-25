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
  publication_id: string | null;
  deadline_at: string;
  active: boolean;
  created_at: string;
  // Full rows rather than a count: the list now reports WHO each checklist
  // speaks to, which is derived from its tasks' audience.
  conference_checklist_tasks: { audience: string | null; active: boolean }[] | null;
  conference_checklist_checkpoints: { id: string }[] | null;
  scope_entity: { name: string }[] | { name: string } | null;
  publication: { id: string; title: string }[] | { id: string; title: string } | null;
}

function countOf(rel: unknown[] | null): number {
  if (!rel) return 0;
  return Array.isArray(rel) ? rel.length : 0;
}

function nameOf(rel: { name: string }[] | { name: string } | null): string | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0]?.name ?? null) : rel.name;
}

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent";

export interface PublicationOption {
  id: string;
  title: string;
}

const one = <T,>(v: T[] | T | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/**
 * Who this checklist actually reaches.
 *
 * A publication-scoped checklist used to read "All registered orgs", which is
 * badly wrong: the network directory reaches 123 organisations including 52
 * member stores who bought nothing at the conference. An admin deciding whether
 * to switch it on has to be told the real audience.
 */
/**
 * Who this checklist actually speaks to.
 *
 * "Your Conference" is entirely person-audience — its tasks render on each
 * individual's own page and are deliberately excluded from the org reminder
 * engine — yet it displayed the same scope sentence as Booth Readiness. Two
 * checklists that behave completely differently looked identical in the list.
 */
function audienceLabel(c: ChecklistRow): string {
  const audiences = new Set(
    (c.conference_checklist_tasks ?? []).filter((t) => t.active).map((t) => t.audience)
  );
  if (audiences.size === 0) return "—";
  if (audiences.has("org") && audiences.has("person")) return "Org admins + individuals";
  return audiences.has("person") ? "Individuals" : "Org admins";
}

function scopeLabel(c: ChecklistRow): string {
  // A person-audience checklist never resolves to organisations at all, so the
  // org scope sentence would be actively misleading.
  const audiences = new Set(
    (c.conference_checklist_tasks ?? []).filter((t) => t.active).map((t) => t.audience)
  );
  if (audiences.size > 0 && !audiences.has("org")) {
    return "Each person, on their own conference page";
  }
  const publication = one(c.publication);
  if (publication) return `Everyone listed in ${publication.title}`;
  const entity = one(c.scope_entity);
  if (entity) return entity.name;
  return "Every org with a purchase for this conference";
}

export default function ChecklistList({
  conferenceId,
  checklists,
  entities,
  publications,
}: {
  conferenceId: string;
  checklists: ChecklistRow[];
  entities: EntityOption[];
  publications: PublicationOption[];
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
          publications={publications}
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
                <th className="px-4 py-2 text-left font-medium text-gray-600">Who</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Reaches</th>
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
                  <td className="px-4 py-3 text-gray-600">{audienceLabel(c)}</td>
                  <td className="px-4 py-3 text-gray-600">{scopeLabel(c)}</td>
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
  publications,
  conferenceId,
  entities,
  onClose,
  onSaved,
}: {
  conferenceId: string;
  entities: EntityOption[];
  publications: PublicationOption[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeEntityId, setScopeEntityId] = useState("");
  const [publicationId, setPublicationId] = useState("");
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
      publicationId: publicationId || null,
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
          <label className="block text-xs font-medium text-gray-700 mb-1">Or scope to a publication</label>
          <select
            value={publicationId}
            onChange={(e) => setPublicationId(e.target.value)}
            className={inputClass}
            disabled={publications.length === 0}
          >
            <option value="">Not publication-scoped</option>
            {publications.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Reaches everyone listed in that publication, including organisations with no
            conference purchase. Overrides the scope on the left.
          </p>
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
