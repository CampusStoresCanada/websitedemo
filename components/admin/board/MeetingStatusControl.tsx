"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelBoardMeeting,
  completeBoardMeeting,
  reopenBoardMeeting,
} from "@/lib/actions/board-meeting-event";

interface Props {
  meetingId: string;
  status: string;
  /** Meeting day, YYYY-MM-DD. A meeting still ahead of us has nothing to close out. */
  meetingDate: string;
  /** Status is a super-admin change; everyone else sees the badge only. */
  canEdit: boolean;
}

const BADGE: Record<string, string> = {
  upcoming: "bg-blue-100 text-blue-700",
  completed: "bg-gray-100 text-gray-500",
  cancelled: "bg-red-100 text-red-600",
};

type Choice = {
  key: "completed" | "cancelled" | "upcoming";
  label: string;
  /** Shown before acting. Cancelling also cancels the linked calendar event. */
  confirm: string;
  danger?: boolean;
  run: (id: string) => Promise<{ success: true } | { error: string }>;
};

export default function MeetingStatusControl({ meetingId, status, meetingDate, canEdit }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const held = new Date().toISOString().slice(0, 10) >= meetingDate;

  const choices: Choice[] = [];
  if (status === "upcoming") {
    if (held) {
      choices.push({
        key: "completed",
        label: "Completed",
        confirm: "Close out this meeting?",
        run: completeBoardMeeting,
      });
    }
    choices.push({
      key: "cancelled",
      label: "Cancelled",
      confirm: "Cancel this meeting and its calendar event?",
      danger: true,
      run: cancelBoardMeeting,
    });
  } else if (status === "completed") {
    choices.push({
      key: "upcoming",
      label: "Upcoming",
      confirm: "Reopen this meeting?",
      run: reopenBoardMeeting,
    });
  }

  const badge = `inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
    BADGE[status] ?? "bg-gray-100 text-gray-600"
  }`;

  // Nothing to change: a plain badge, exactly as it read before.
  if (!canEdit || choices.length === 0) {
    return <span className={badge}>{status}</span>;
  }

  return (
    <div ref={wrapRef} className="relative inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change meeting status"
        className={`${badge} cursor-pointer transition-opacity hover:opacity-80 disabled:opacity-50`}
      >
        {pending ? "saving…" : status}
        <span aria-hidden className="text-[0.6rem] leading-none">▾</span>
      </button>

      {error && <span className="text-xs text-red-600">{error}</span>}

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          <p className="px-3 py-1 text-[0.65rem] font-medium uppercase tracking-wide text-gray-400">
            Change status to
          </p>
          {choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(choice.confirm)) return;
                setOpen(false);
                startTransition(async () => {
                  setError(null);
                  const result = await choice.run(meetingId);
                  if ("error" in result) setError(result.error);
                  else router.refresh();
                });
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 disabled:opacity-50 ${
                choice.danger ? "text-red-600" : "text-gray-700"
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
