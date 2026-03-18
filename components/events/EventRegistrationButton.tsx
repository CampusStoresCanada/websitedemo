"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerForEvent, cancelRegistration } from "@/lib/actions/event-registration";

interface EventRegistrationButtonProps {
  eventId: string;
  eventTitle: string;
  status: "registered" | "waitlisted" | "cancelled" | null;
  spotsRemaining: number | null;
  isAuthenticated: boolean;
  isMembersOnly: boolean;
  isVirtual?: boolean;
  meetLink?: string | null;
}

export default function EventRegistrationButton({
  eventId,
  eventTitle,
  status,
  spotsRemaining,
  isAuthenticated,
  isMembersOnly,
  isVirtual,
  meetLink,
}: EventRegistrationButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState(status);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!isAuthenticated) {
    return (
      <div className="space-y-2">
        <a
          href="/login"
          className="block w-full text-center px-6 py-3 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] text-white font-semibold transition-colors"
        >
          Sign in to Register
        </a>
        {isMembersOnly && (
          <p className="text-sm text-center text-gray-500">Members only event</p>
        )}
      </div>
    );
  }

  const handleRegister = () => {
    setError(null);
    startTransition(async () => {
      const result = await registerForEvent(eventId);
      if (result.success) {
        setOptimisticStatus(result.result === "waitlisted" ? "waitlisted" : "registered");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  const handleCancel = () => {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    setError(null);
    setConfirmCancel(false);
    startTransition(async () => {
      const result = await cancelRegistration(eventId);
      if (result.success) {
        setOptimisticStatus("cancelled");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  if (optimisticStatus === "registered" || optimisticStatus === "promoted" as any) {
    return (
      <div className="space-y-2">
        {/* Join button — shown for virtual events with a meet link */}
        {isVirtual && meetLink && (
          <a
            href={meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-6 py-3 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] text-white font-semibold transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Join the Event
          </a>
        )}

        {/* Registered badge */}
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 border border-green-200">
          <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-green-800 font-medium text-sm">You're registered</span>
        </div>

        {confirmCancel ? (
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {isPending ? "Cancelling…" : "Confirm Cancel"}
            </button>
            <button
              onClick={() => setConfirmCancel(false)}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmCancel(true)}
            className="w-full px-4 py-2 rounded-lg border border-gray-200 text-gray-500 text-sm hover:border-red-200 hover:text-red-600 transition-colors"
          >
            Cancel registration
          </button>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (optimisticStatus === "waitlisted") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200">
          <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-amber-800 font-medium text-sm">You're on the waitlist</span>
        </div>
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="w-full px-4 py-2 rounded-lg border border-gray-200 text-gray-500 text-sm hover:border-red-200 hover:text-red-600 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Removing…" : "Leave waitlist"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // Not registered
  const isFull = spotsRemaining === 0;

  return (
    <div className="space-y-2">
      <button
        onClick={handleRegister}
        disabled={isPending}
        className="w-full px-6 py-3 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] disabled:bg-gray-300 text-white font-semibold transition-colors"
      >
        {isPending
          ? isFull
            ? "Joining waitlist…"
            : "Registering…"
          : isFull
          ? "Join Waitlist"
          : "Register"}
      </button>
      {isFull && (
        <p className="text-sm text-center text-gray-500">This event is full — you'll be added to the waitlist</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
