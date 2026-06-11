"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createEventForMeeting } from "@/lib/actions/board-meeting-event";

interface Props {
  meetingId: string;
  eventId:   string | null;
  eventSlug: string | null;
  isSA:      boolean;
}

export default function LinkEventButton({ meetingId, eventId, eventSlug, isSA }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Already linked — show navigation links
  if (eventId && eventSlug) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1 text-green-600 font-medium">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Event linked
        </span>
        <Link
          href={`/admin/events/${eventId}`}
          className="text-xs text-[#163D6D] underline underline-offset-2 hover:opacity-70"
        >
          Admin ↗
        </Link>
        <Link
          href={`/events/${eventSlug}`}
          className="text-xs text-[#163D6D] underline underline-offset-2 hover:opacity-70"
        >
          Public ↗
        </Link>
      </span>
    );
  }

  // Not linked — super_admin can create one
  if (!isSA) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        No linked event
      </span>
    );
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createEventForMeeting(meetingId);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <span className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        No linked event
      </span>
      <button
        type="button"
        onClick={handleCreate}
        disabled={isPending}
        className="text-xs rounded border border-[#163D6D] text-[#163D6D] px-2 py-0.5 hover:bg-[#163D6D]/5 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Creating…" : "Create event"}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
}
