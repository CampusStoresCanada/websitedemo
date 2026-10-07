"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeBoardMeeting } from "@/lib/actions/board-meeting-event";

interface Props {
  meetingId: string;
  currentStatus: string;
  /** Meeting day, YYYY-MM-DD. A meeting still ahead of us has nothing to close. */
  meetingDate: string;
}

export default function CompleteMeetingButton({ meetingId, currentStatus, meetingDate }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Nothing to close out: already closed, cancelled, or not yet held. The
  // status itself is shown by the badge beside the header, so render nothing
  // rather than a second copy of it.
  if (currentStatus !== "upcoming") return null;
  if (meetingDate > new Date().toISOString().slice(0, 10)) return null;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        Mark Completed
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <span className="text-sm text-gray-600">Close out this meeting?</span>
      <button
        type="button"
        disabled={saving}
        onClick={() =>
          startSave(async () => {
            setError(null);
            const result = await completeBoardMeeting(meetingId);
            if ("error" in result) {
              setError(result.error);
              setConfirming(false);
            } else {
              router.refresh();
            }
          })
        }
        className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50 transition-colors"
      >
        {saving ? "Saving…" : "Yes, it's done"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={saving}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
      >
        Not yet
      </button>
    </div>
  );
}
