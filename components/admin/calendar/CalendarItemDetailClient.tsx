"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CalendarItem, CalendarItemNote, CalendarStatus, CalendarSeverity } from "@/lib/calendar/types";

type NoteWithActor = CalendarItemNote & {
  actor: { id: string; display_name: string | null } | null;
};

type Props = {
  item: CalendarItem;
  notes: NoteWithActor[];
};

export default function CalendarItemDetailClient({ item, notes }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [noteText, setNoteText] = useState("");
  const [noteErr, setNoteErr]   = useState<string | null>(null);
  const [updateErr, setUpdateErr] = useState<string | null>(null);
  const [confirmErr, setConfirmErr]   = useState<string | null>(null);
  const [confirming, setConfirming]   = useState(false);
  const [confirmed, setConfirmed]     = useState<string | null>(item.confirmed_at);

  // Editable fields (manual items only for status; all items for severity).
  const [status,   setStatus]   = useState<CalendarStatus>(item.status);
  const [severity, setSeverity] = useState<CalendarSeverity>(item.severity);
  const [dirty, setDirty]       = useState(false);

  const isManual = item.source_mode === "manual";

  async function saveUpdates() {
    setUpdateErr(null);
    const payload: Record<string, string> = { severity };
    if (isManual) payload.status = status;

    const res = await fetch(`/api/admin/calendar/items/${item.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      setUpdateErr(error ?? "Save failed.");
      return;
    }
    setDirty(false);
    startTransition(() => router.refresh());
  }

  async function confirmRun() {
    setConfirmErr(null);
    setConfirming(true);
    const res = await fetch(`/api/admin/calendar/items/${item.id}/confirm`, { method: "POST" });
    setConfirming(false);
    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      setConfirmErr(error ?? "Confirmation failed.");
      return;
    }
    const { confirmed_at } = (await res.json()) as { confirmed_at: string };
    setConfirmed(confirmed_at);
    startTransition(() => router.refresh());
  }

  async function submitNote(e: React.FormEvent) {
    e.preventDefault();
    setNoteErr(null);
    if (!noteText.trim()) return;

    const res = await fetch(`/api/admin/calendar/items/${item.id}/notes`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ note: noteText.trim() }),
    });

    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      setNoteErr(error ?? "Failed to add note.");
      return;
    }
    setNoteText("");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      {/* Editable fields */}
      <section className="rounded-xl border border-gray-200 bg-white px-4 py-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Update {isManual ? "item" : "severity / acknowledge"}
        </h2>

        <div className="grid grid-cols-2 gap-4 mb-3">
          {isManual && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value as CalendarStatus); setDirty(true); }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Severity override</label>
            <select
              value={severity}
              onChange={(e) => { setSeverity(e.target.value as CalendarSeverity); setDirty(true); }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="normal">Normal</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        {!isManual && (
          <p className="text-xs text-gray-400 mb-3">
            This is a projected item — status is read-only. You can override severity or add notes.
          </p>
        )}

        {updateErr && <p className="text-xs text-red-600 mb-2">{updateErr}</p>}

        <button
          onClick={saveUpdates}
          disabled={!dirty || pending}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </section>

      {/* Deadhand confirmation panel */}
      {item.requires_confirmation && (
        <section className={`rounded-xl border px-4 py-4 ${
          confirmed
            ? "border-green-200 bg-green-50"
            : item.status === "blocked"
            ? "border-red-300 bg-red-50"
            : "border-yellow-200 bg-yellow-50"
        }`}>
          <h2 className="text-sm font-semibold mb-1">
            {confirmed ? "✓ Human confirmation received" : "⚠ Requires admin confirmation"}
          </h2>

          {confirmed ? (
            <p className="text-xs text-green-700">
              Confirmed{" "}
              {new Date(confirmed).toLocaleString("en-CA", {
                month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit",
                timeZone: "America/Toronto",
              })}{" ET. "}
              This run is authorized to execute.
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-700 mb-3">
                {item.status === "blocked"
                  ? "This run fires within 24 hours. Without confirmation it will be silently skipped and an ops alert will be created."
                  : "This automated financial action requires explicit admin sign-off before it will execute. Review the details and confirm when ready."}
              </p>
              {confirmErr && <p className="text-xs text-red-600 mb-2">{confirmErr}</p>}
              <button
                onClick={confirmRun}
                disabled={confirming}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                  item.status === "blocked"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-yellow-600 hover:bg-yellow-700"
                } disabled:opacity-40`}
              >
                {confirming ? "Confirming…" : "I have reviewed this — confirm run"}
              </button>
            </>
          )}
        </section>
      )}

      {/* Notes */}
      <section className="rounded-xl border border-gray-200 bg-white px-4 py-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Notes {notes.length > 0 && <span className="ml-1 text-gray-400">({notes.length})</span>}
        </h2>

        {notes.length === 0 && (
          <p className="text-xs text-gray-400 mb-3">No notes yet.</p>
        )}

        {notes.length > 0 && (
          <ul className="space-y-3 mb-4">
            {notes.map((n) => {
              const actorName = n.actor?.display_name ?? "Admin";
              const ts = new Date(n.created_at).toLocaleString("en-CA", {
                month:    "short",
                day:      "numeric",
                hour:     "2-digit",
                minute:   "2-digit",
                timeZone: "America/Toronto",
              });
              return (
                <li key={n.id} className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-sm text-gray-800 whitespace-pre-line">{n.note}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {actorName} · {ts}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={submitNote} className="flex items-start gap-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            placeholder="Add a note or update…"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <button
            type="submit"
            disabled={!noteText.trim() || pending}
            className="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Add
          </button>
        </form>
        {noteErr && <p className="mt-1 text-xs text-red-600">{noteErr}</p>}
      </section>
    </div>
  );
}
