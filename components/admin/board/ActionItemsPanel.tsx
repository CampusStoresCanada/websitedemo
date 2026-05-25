"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemStatus = "open" | "in_progress" | "complete" | "deferred";

interface ActionItem {
  id:             string;
  title:          string;
  description:    string | null;
  assignees:      string[];
  due_date:       string | null;
  status:         ItemStatus;
  sort_order:     number;
  complete_token: string;
  created_at:     string;
}

interface BoardMember {
  id:           string;
  display_name: string;
  email:        string;
}

interface Props {
  meetingId: string;
  items:     ActionItem[];
  isSA:      boolean;
}

const STATUS_LABELS: Record<ItemStatus, string> = {
  open:        "Open",
  in_progress: "In Progress",
  complete:    "Complete",
  deferred:    "Deferred",
};

const STATUS_COLORS: Record<ItemStatus, string> = {
  open:        "bg-blue-100 text-blue-700",
  in_progress: "bg-purple-100 text-purple-700",
  complete:    "bg-green-100 text-green-700",
  deferred:    "bg-amber-100 text-amber-700",
};

// ─── Member checklist ─────────────────────────────────────────────────────────

function MemberChecklist({ members, selected, onChange }: {
  members:  BoardMember[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <div className="grid grid-cols-2 gap-1">
      {members.map((m) => {
        const checked = selected.includes(m.id);
        return (
          <label
            key={m.id}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer text-sm transition-colors ${
              checked ? "bg-[#163D6D]/10 text-[#163D6D] font-medium" : "hover:bg-gray-50 text-gray-700"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(m.id)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-[#163D6D] focus:ring-[#163D6D]"
            />
            {m.display_name}
          </label>
        );
      })}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ActionItemsPanel({ meetingId, items: initial, isSA }: Props) {
  const router = useRouter();
  const [items,   setItems]   = useState<ActionItem[]>(initial);
  const [adding,  setAdding]  = useState(false);
  const [saving,  startSave]  = useTransition();
  const [members, setMembers] = useState<BoardMember[]>([]);

  // Form state
  const [title,     setTitle]     = useState("");
  const [desc,      setDesc]      = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [due,       setDue]       = useState("");

  useEffect(() => {
    fetch("/api/admin/board/members")
      .then((r) => r.json())
      .then((d) => { if (d.members) setMembers(d.members); })
      .catch(() => {});
  }, []);

  function assigneeNames(uuids: string[]) {
    return uuids.map((id) => members.find((m) => m.id === id)?.display_name ?? "…").join(", ");
  }

  function resetForm() {
    setTitle(""); setDesc(""); setAssignees([]); setDue("");
    setAdding(false);
  }

  async function handleAdd() {
    if (!title.trim()) return;
    startSave(async () => {
      const res = await fetch("/api/admin/board/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId,
          title:     title.trim(),
          description: desc.trim() || null,
          assignees,
          dueDate: due || null,
        }),
      });
      if (!res.ok) return;
      const { item } = await res.json();
      setItems((prev) => [...prev, item]);
      resetForm();
      router.refresh();
    });
  }

  async function handleStatus(id: string, status: ItemStatus) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    await fetch(`/api/admin/board/action-items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  async function handleDelete(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/admin/board/action-items/${id}`, { method: "DELETE" });
    router.refresh();
  }

  const open       = items.filter((i) => i.status === "open");
  const inProgress = items.filter((i) => i.status === "in_progress");
  const deferred   = items.filter((i) => i.status === "deferred");
  const complete   = items.filter((i) => i.status === "complete");

  return (
    <div>
      {/* Add button */}
      {isSA && !adding && (
        <div className="mb-4">
          <button
            onClick={() => setAdding(true)}
            className="rounded-md border border-[#163D6D] px-3 py-1.5 text-sm font-medium text-[#163D6D] hover:bg-[#163D6D]/5 transition-colors"
          >
            + Add Action Item
          </button>
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">New Action Item</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#163D6D] focus:outline-none focus:ring-1 focus:ring-[#163D6D]"
                placeholder="Short name for this action item"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description <span className="text-gray-400">(optional)</span></label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#163D6D] focus:outline-none focus:ring-1 focus:ring-[#163D6D]"
                placeholder="Additional detail about what needs to happen"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Assign to{assignees.length > 0 && <span className="ml-2 text-[#163D6D]">({assignees.length} selected)</span>}
              </label>
              {members.length === 0 ? (
                <p className="text-xs text-gray-400">Loading members…</p>
              ) : (
                <MemberChecklist members={members} selected={assignees} onChange={setAssignees} />
              )}
            </div>

            <div className="max-w-xs">
              <label className="block text-xs font-medium text-gray-600 mb-1">Due date</label>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#163D6D] focus:outline-none focus:ring-1 focus:ring-[#163D6D]"
              />
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={resetForm} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!title.trim() || saving}
                className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Add & notify"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <div className="text-2xl mb-2">✅</div>
          <p className="text-sm font-medium text-gray-700">No action items for this meeting</p>
          {isSA && <p className="mt-1 text-xs text-gray-400">Click &ldquo;Add Action Item&rdquo; above to create one.</p>}
        </div>
      )}

      {/* Item groups */}
      {[
        { label: "Open",        list: open },
        { label: "In Progress", list: inProgress },
        { label: "Deferred",    list: deferred },
        { label: "Completed",   list: complete },
      ].map(({ label, list }) =>
        list.length === 0 ? null : (
          <div key={label} className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{label}</h3>
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {list.map((item) => (
                  <li key={item.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {isSA ? (
                        <select
                          value={item.status}
                          onChange={(e) => handleStatus(item.id, e.target.value as ItemStatus)}
                          className="rounded border border-gray-300 px-1.5 py-0.5 text-xs font-medium focus:outline-none"
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="complete">Complete</option>
                          <option value="deferred">Deferred</option>
                        </select>
                      ) : (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status]}`}>
                          {STATUS_LABELS[item.status]}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium text-gray-900 ${item.status === "complete" ? "line-through text-gray-400" : ""}`}>
                        {item.title}
                      </p>
                      {item.description && (
                        <p className="mt-0.5 text-xs text-gray-500">{item.description}</p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400">
                        {item.assignees?.length > 0 && members.length > 0 && (
                          <span>→ {assigneeNames(item.assignees)}</span>
                        )}
                        {item.due_date && <span>Due {item.due_date}</span>}
                      </div>
                    </div>

                    {isSA && (
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="shrink-0 text-gray-400 hover:text-red-500 transition-colors text-sm mt-0.5 px-1"
                        title="Delete action item"
                      >
                        🗑
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      )}
    </div>
  );
}
