"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelRegistration } from "@/lib/actions/event-registration";

export default function CancelRsvpButton({
  eventId,
  status,
}: {
  eventId: string;
  status: "registered" | "waitlisted" | "promoted";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [cancelled, setCancelled]   = useState(false);

  if (cancelled) {
    return (
      <span className="inline-block px-2.5 py-1 rounded text-[11px] font-medium bg-gray-100 text-gray-500">
        Cancelled
      </span>
    );
  }

  const handleCancel = () => {
    setError(null);
    startTransition(async () => {
      const result = await cancelRegistration(eventId);
      if (result.success) {
        setCancelled(true);
        router.refresh();
      } else {
        setError(result.error);
        setConfirm(false);
      }
    });
  };

  if (confirm) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium disabled:opacity-50 transition-colors"
        >
          {isPending ? "Cancelling…" : "Confirm"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 transition-colors"
        >
          Keep
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-500 hover:border-red-200 hover:text-red-600 transition-colors"
    >
      {status === "waitlisted" ? "Leave waitlist" : "Cancel"}
    </button>
  );
}
