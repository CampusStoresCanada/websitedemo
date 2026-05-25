"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateMeetingButton() {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [date, setDate]  = useState("");
  const [type, setType]  = useState<"regular" | "agm" | "special">("regular");
  const [notes, setNotes] = useState("");

  async function handleCreate() {
    if (!date) { setError("Meeting date is required"); return; }
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/board/meetings", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingDate: date,
          meetingType: type,
          notes:       notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create meeting");

      setOpen(false);
      setDate(""); setType("regular"); setNotes("");
      router.push(`/admin/board/meetings/${data.meeting.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90 transition-colors"
      >
        + New Meeting
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-gray-900 mb-4">New Board Meeting</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Meeting date *</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#163D6D] focus:outline-none focus:ring-1 focus:ring-[#163D6D]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Meeting type</label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value as "regular" | "agm" | "special")}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#163D6D] focus:outline-none focus:ring-1 focus:ring-[#163D6D]"
                >
                  <option value="regular">Regular Meeting</option>
                  <option value="agm">AGM</option>
                  <option value="special">Special Meeting</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Any notes for this meeting…"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#163D6D] focus:outline-none focus:ring-1 focus:ring-[#163D6D]"
                />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <p className="text-xs text-gray-400">
                A Notion scratchpad page will be created automatically under 📋 Board Meetings.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => { setOpen(false); setError(null); }}
                disabled={saving}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!date || saving}
                className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Creating…" : "Create Meeting"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
