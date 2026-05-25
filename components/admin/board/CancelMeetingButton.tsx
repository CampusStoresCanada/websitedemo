"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelBoardMeeting } from "@/lib/actions/board-meeting-event";

interface Props {
  meetingId: string;
  currentStatus: string;
}

export default function CancelMeetingButton({ meetingId, currentStatus }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, startCancel] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (currentStatus === "cancelled") {
    return (
      <span className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600">
        Meeting Cancelled
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
      >
        Cancel Meeting
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <span className="text-sm text-gray-600">Are you sure?</span>
      <button
        type="button"
        disabled={cancelling}
        onClick={() =>
          startCancel(async () => {
            setError(null);
            const result = await cancelBoardMeeting(meetingId);
            if ("error" in result) {
              setError(result.error);
              setConfirming(false);
            } else {
              router.refresh();
            }
          })
        }
        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
      >
        {cancelling ? "Cancelling…" : "Yes, cancel it"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={cancelling}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
      >
        Keep
      </button>
    </div>
  );
}
