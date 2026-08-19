"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BoardChecklistData, ChecklistRow } from "@/lib/board/checklist";

/**
 * The board action-item checklist.
 *
 * A checklist, not a dashboard — the job is to get items ticked, so every
 * control on a row edits in place: tick to complete, click the state to change
 * it, the date to move it, the pill to set importance, ⋯ to relinquish.
 * See docs/BOARD_ACTION_ITEM_MINT.md §11.
 *
 * Colours and geometry come from the approved SVG.
 */

const NAVY = "#16345a";
const CARD = "#e6e6e6";
const ROW = "#f2f2f2";
const TRACK = "#ccc";
const MUTED = "#999";
const GRAD = "linear-gradient(90deg, red 0%, #9e1b43 100%)";

const PRIORITY_STYLE = {
  high: { bg: "#d6001c", fg: "#fff", label: "High" },
  medium: { bg: "#d66b79", fg: "#fff", label: "Medium" },
  low: { bg: TRACK, fg: "#666", label: "Low" },
  unset: { bg: TRACK, fg: "#666", label: "Importance" },
} as const;

const STATE_LABEL: Record<ChecklistRow["status"], string> = {
  open: "Not started",
  in_progress: "In progress",
  deferred: "On hold",
  complete: "Complete",
  intention: "Unclaimed",
};

const FLAG_LABEL: Record<string, string> = {
  no_owner: "No owner",
  owner_unresolved: "Owner unclear",
  uncompletable_verb: "No completable verb",
  no_finish_line: "No finish line",
};

type Tab = "mine" | "all" | "stats";

// ── Bar ────────────────────────────────────────────────────────────────
// Fills as runway disappears: full means out of time, not nearly done.

function StateBar({ row }: { row: ChecklistRow }) {
  const held = row.status === "deferred";
  const done = row.status === "complete";
  const fill = row.status === "open" ? 0 : Math.max(row.runway, row.status === "in_progress" ? 0.04 : 0);

  return (
    <div
      className="relative overflow-hidden rounded-full"
      // White rather than the row's own grey: an empty track has to be
      // visible, or "Not started" looks like a rendering fault and nobody
      // realises the bar is the control for changing state.
      style={{ width: 82, height: 18, background: done ? MUTED : "#fff", opacity: held ? 0.5 : 1 }}
      aria-hidden="true"
    >
      {!done && fill > 0 && (
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${fill * 100}%`, background: GRAD }}
        />
      )}
      {done && (
        <span
          className="absolute inset-0 flex items-center justify-center text-[11px] font-medium"
          style={{ color: "#666" }}
        >
          Complete
        </span>
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────

function Row({
  row,
  data,
  onPatch,
  onOpenDetail,
  busy,
}: {
  row: ChecklistRow;
  data: BoardChecklistData;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onOpenDetail: (row: ChecklistRow) => void;
  busy: boolean;
}) {
  const done = row.status === "complete";
  const p = PRIORITY_STYLE[row.priority ?? "unset"];
  const isMine = data.viewerId ? row.assignees.includes(data.viewerId) : false;
  const [menuOpen, setMenuOpen] = useState(false);

  const secondary =
    row.assigneeNames.length > 0 ? row.assigneeNames.join(", ") : "Unassigned";

  return (
    <div
      className="grid items-center gap-3 rounded-2xl px-4 py-3"
      style={{
        background: ROW,
        gridTemplateColumns: "24px minmax(0,1fr) 104px 82px 92px 32px",
        opacity: busy ? 0.55 : 1,
      }}
    >
      {/* Tick to complete */}
      <button
        type="button"
        onClick={() => onPatch(row.id, { status: done ? "open" : "complete" })}
        aria-label={done ? `Reopen ${row.title}` : `Mark ${row.title} complete`}
        className="flex h-6 w-6 items-center justify-center"
      >
        {done ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#009245" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 7.5v4.2A2.3 2.3 0 0 1 11.7 14H4.3A2.3 2.3 0 0 1 2 11.7V4.3A2.3 2.3 0 0 1 4.3 2h6.2" />
            <polyline points="5,7.3 7,9.4 13.3,3.1" />
          </svg>
        ) : (
          <span className="block h-[14px] w-[14px] rounded-[3px] border-2 border-black" />
        )}
      </button>

      {/* Title + secondary line */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p
            className="truncate text-[15px] font-medium"
            style={{ color: done ? MUTED : "#111", textDecoration: done ? "line-through" : "none" }}
            title={row.title}
          >
            {row.title}
          </p>
          <button
            type="button"
            onClick={() => onOpenDetail(row)}
            aria-label={`Details for ${row.title}`}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke={MUTED} strokeWidth="1.2">
              <path d="M12 8v3.8a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2V4a1.2 1.2 0 0 1 1.2-1.2h3.8" />
              <path d="M9 1.5h3.5V5M12.2 1.8 6.5 7.5" />
            </svg>
          </button>
          {row.escalated && !done && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#fbe8d6", color: "#9a4e08" }}>
              {row.daysOpen}d — still real?
            </span>
          )}
        </div>
        <p className="truncate text-[12px]" style={{ color: done ? MUTED : "#333" }}>
          {secondary}
          {row.qualityFlags.length > 0 && (
            <span style={{ color: "#9a4e08" }}>
              {" · "}
              {row.qualityFlags.map((f) => FLAG_LABEL[f] ?? f).join(" · ")}
            </span>
          )}
        </p>
      </div>

      {/* Due date — never blank */}
      <label className="relative cursor-pointer text-[12px] font-medium" style={{ color: done ? MUTED : "#111" }}>
        {row.dueDateLabel}
        <input
          type="date"
          value={row.dueDate ?? ""}
          onChange={(e) => onPatch(row.id, { dueDate: e.target.value || null })}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={`Due date for ${row.title}`}
        />
      </label>

      {/* State — click the bar to change it */}
      <label className="relative cursor-pointer" title={STATE_LABEL[row.status]}>
        <StateBar row={row} />
        <select
          value={row.status}
          onChange={(e) => onPatch(row.id, { status: e.target.value })}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={`State of ${row.title}`}
        >
          <option value="open">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="deferred">On hold</option>
          <option value="complete">Complete</option>
        </select>
      </label>

      {/* Importance */}
      <label className="relative cursor-pointer">
        <span
          className="flex h-[18px] w-[82px] items-center justify-center rounded-full text-[11px] font-medium"
          style={{ background: done ? TRACK : p.bg, color: done ? "#666" : p.fg }}
        >
          {done ? "Low" : p.label}
        </span>
        <select
          value={row.priority ?? ""}
          onChange={(e) => onPatch(row.id, { priority: e.target.value || null })}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={`Importance of ${row.title}`}
        >
          <option value="">Unset</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>

      {/* ⋯ */}
      <div className="relative flex justify-end">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={`More actions for ${row.title}`}
          aria-expanded={menuOpen}
          className="rounded p-1"
        >
          <svg width="18" height="5" viewBox="0 0 18 5" fill={done ? MUTED : NAVY}>
            <circle cx="2.5" cy="2.5" r="2.5" />
            <circle cx="9" cy="2.5" r="2.5" />
            <circle cx="15.5" cy="2.5" r="2.5" />
          </svg>
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-7 z-20 w-44 rounded-lg bg-white py-1 shadow-lg"
            style={{ border: "1px solid #d8d8d8" }}
            onMouseLeave={() => setMenuOpen(false)}
          >
            {isMine && (
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onPatch(row.id, { relinquish: true }); }}
                className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
              >
                Relinquish
              </button>
            )}
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onOpenDetail(row); }}
              className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
            >
              Details &amp; updates{row.updateCount > 0 ? ` (${row.updateCount})` : ""}
            </button>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onPatch(row.id, { status: "deferred" }); }}
              className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
            >
              Put on hold
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stats ──────────────────────────────────────────────────────────────

function Stats({ data }: { data: BoardChecklistData }) {
  const s = data.stats;
  return (
    <div className="space-y-6 px-1 py-2">
      <section>
        <h3 className="mb-2 text-[13px] font-semibold" style={{ color: NAVY }}>
          Does assignment work?
        </h3>
        <div className="overflow-hidden rounded-xl" style={{ background: ROW }}>
          {s.byAssignment.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
              <span>{r.label}</span>
              <span className="flex items-center gap-4">
                <span style={{ color: MUTED }}>{r.completed} of {r.raised} cleared</span>
                <strong style={{ color: r.pct === 0 ? "#a3282b" : NAVY, minWidth: 44, textAlign: "right" }}>
                  {r.pct}%
                </strong>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold" style={{ color: NAVY }}>
          Raised vs cleared, per meeting
        </h3>
        <div className="overflow-hidden rounded-xl" style={{ background: ROW }}>
          {s.perMeeting.map((m) => (
            <div key={m.meetingDate} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
              <span>{m.meetingDate}</span>
              <span className="flex items-center gap-4" style={{ color: MUTED }}>
                <span>{m.actions} actions</span>
                <span>{m.intentions} intentions</span>
                <strong style={{ color: NAVY }}>{m.cleared} cleared</strong>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold" style={{ color: NAVY }}>
          Is this really even a thing?
        </h3>
        <div className="overflow-hidden rounded-xl" style={{ background: ROW }}>
          {s.ageBands.map((b) => (
            <div key={b.band} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
              <span>{b.band}</span>
              <strong style={{ color: b.band.startsWith("90") && b.count > 0 ? "#a3282b" : NAVY }}>{b.count}</strong>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 text-[13px]" style={{ borderTop: "1px solid #e0e0e0" }}>
            <span>Open across 3+ meetings — needs a decision</span>
            <strong style={{ color: s.escalatedCount > 0 ? "#a3282b" : NAVY }}>{s.escalatedCount}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Widget ─────────────────────────────────────────────────────────────

export function BoardChecklist({ data }: { data: BoardChecklistData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("mine");
  const [detail, setDetail] = useState<ChecklistRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const mine = useMemo(
    () => data.rows.filter((r) => data.viewerId && r.assignees.includes(data.viewerId)),
    [data.rows, data.viewerId]
  );
  const unclaimed = useMemo(() => data.rows.filter((r) => r.tier === "unclaimed"), [data.rows]);

  // When your own list is clear, the unclaimed pile is offered instead —
  // shortest and best-formed first, so a volunteer gets a win.
  const showAdoption = tab === "mine" && mine.length === 0 && unclaimed.length > 0;
  const visible = tab === "mine" ? (showAdoption ? unclaimed : mine) : data.rows;

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/admin/board/action-items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "That didn't save.");
      return;
    }
    startTransition(() => router.refresh());
  }

  const TabButton = ({ id, label }: { id: Tab; label: string }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className="pb-1.5 text-[15px] font-medium transition-colors"
      style={{
        color: tab === id ? NAVY : "#9a9b9b",
        borderBottom: tab === id ? `2px solid ${NAVY}` : "2px solid transparent",
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-[22px] p-5" style={{ background: CARD }}>
      <div className="mb-4 flex items-center gap-6">
        <TabButton id="mine" label={`My tasks (${mine.length})`} />
        <TabButton id="all" label={`All tasks (${data.rows.length})`} />
        <TabButton id="stats" label="Stats" />
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-white px-3 py-2 text-[12px]" style={{ color: "#a3282b" }}>
          {error}
        </div>
      )}

      {tab === "stats" ? (
        <Stats data={data} />
      ) : (
        <div className="space-y-2">
          {showAdoption && (
            <p className="px-1 pb-1 text-[13px]" style={{ color: NAVY }}>
              Your list is clear. Do one of these?
            </p>
          )}
          {visible.length === 0 ? (
            <div className="rounded-2xl py-10 text-center text-[13px]" style={{ background: ROW, color: MUTED }}>
              Nothing outstanding.
            </div>
          ) : (
            visible.map((row) => (
              <Row
                key={row.id}
                row={row}
                data={data}
                onPatch={patch}
                onOpenDetail={setDetail}
                busy={busyId === row.id}
              />
            ))
          )}
        </div>
      )}

      {detail && (
        <DetailPanel
          row={detail}
          onClose={() => setDetail(null)}
          onSaved={() => startTransition(() => router.refresh())}
        />
      )}
    </div>
  );
}

// ── Detail / updates ───────────────────────────────────────────────────

function DetailPanel({
  row,
  onClose,
  onSaved,
}: {
  row: ChecklistRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [updates, setUpdates] = useState<{ id: string; note: string; createdAt: string; author: string | null }[] | null>(null);
  const [saving, setSaving] = useState(false);

  if (updates === null) {
    void fetch(`/api/admin/board/action-items/${row.id}/updates`)
      .then((r) => r.json())
      .then((d) => setUpdates(d.updates ?? []))
      .catch(() => setUpdates([]));
  }

  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    await fetch(`/api/admin/board/action-items/${row.id}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    setNote("");
    setSaving(false);
    setUpdates(null);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-[15px] font-semibold" style={{ color: NAVY }}>{row.title}</h3>
        <p className="mb-4 text-[12px]" style={{ color: MUTED }}>
          Raised {row.raisedOn} · {row.daysOpen} days open · {STATE_LABEL[row.status]}
          {row.assigneeNames.length > 0 && ` · ${row.assigneeNames.join(", ")}`}
        </p>

        {row.description && <p className="mb-4 text-[13px] text-gray-700">{row.description}</p>}

        <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          Progress
        </h4>
        <div className="mb-3 space-y-2">
          {(updates ?? []).length === 0 && (
            <p className="text-[12px]" style={{ color: MUTED }}>No updates yet.</p>
          )}
          {(updates ?? []).map((u) => (
            <div key={u.id} className="rounded-lg px-3 py-2 text-[12px]" style={{ background: ROW }}>
              <p className="text-gray-800">{u.note}</p>
              <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                {u.author ?? "Migrated"} · {u.createdAt.slice(0, 10)}
              </p>
            </div>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Add a progress update…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] focus:border-[#16345a] focus:outline-none"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-[13px] text-gray-600">
            Close
          </button>
          <button
            type="button"
            onClick={addNote}
            disabled={!note.trim() || saving}
            className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            style={{ background: NAVY }}
          >
            {saving ? "Saving…" : "Add update"}
          </button>
        </div>
      </div>
    </div>
  );
}
