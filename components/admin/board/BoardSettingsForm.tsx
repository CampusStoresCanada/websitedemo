"use client";

import { useState, useTransition } from "react";

interface Props {
  reminderDays: number;
}

export default function BoardSettingsForm({ reminderDays: initial }: Props) {
  const [days,   setDays]   = useState(initial);
  const [saved,  setSaved]  = useState(false);
  const [saving, startSave] = useTransition();

  async function handleSave() {
    startSave(async () => {
      await fetch("/api/admin/board/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_item_reminder_days: days }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* Action item reminders */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Action Item Reminders</h2>
        <p className="text-xs text-gray-400 mb-4">
          How many days before an action item&apos;s due date the Butler Ghost sends a reminder DM.
          A second DM is always sent on the Monday before the next board meeting for any open items.
        </p>

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
            Remind
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10) || 3)}
            className="w-20 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-center focus:border-[#163D6D] focus:outline-none focus:ring-1 focus:ring-[#163D6D]"
          />
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
            days before due date
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-[#163D6D] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">Saved ✓</span>
          )}
        </div>
      </div>
    </div>
  );
}
