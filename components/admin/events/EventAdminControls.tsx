"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveEvent, transitionEventStatus, deleteEvent } from "@/lib/actions/events";
import type { EventStatus } from "@/lib/events/types";
import { EVENT_STATUS_TRANSITIONS, EVENT_STATUS_LABELS } from "@/lib/events/types";

interface EventAdminControlsProps {
  eventId: string;
  currentStatus: EventStatus;
  showApprove?: boolean;
}

export default function EventAdminControls({
  eventId,
  currentStatus,
  showApprove = false,
}: EventAdminControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const allowedTransitions = EVENT_STATUS_TRANSITIONS[currentStatus] ?? [];

  const handleApprove = () => {
    if (confirmAction !== "approve") {
      setConfirmAction("approve");
      return;
    }
    setError(null);
    setConfirmAction(null);
    startTransition(async () => {
      const result = await approveEvent(eventId);
      if (result.success) {
        setSuccess("Event approved and published.");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  const handleTransition = (newStatus: EventStatus) => {
    if (confirmAction !== newStatus) {
      setConfirmAction(newStatus);
      return;
    }
    setError(null);
    setConfirmAction(null);
    startTransition(async () => {
      const result = await transitionEventStatus(eventId, newStatus);
      if (result.success) {
        setSuccess(`Event moved to ${EVENT_STATUS_LABELS[newStatus]}.`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  const handleDelete = () => {
    if (confirmAction !== "delete") {
      setConfirmAction("delete");
      return;
    }
    setError(null);
    setConfirmAction(null);
    startTransition(async () => {
      const result = await deleteEvent(eventId);
      if (result.success) {
        router.push("/admin/events");
      } else {
        setError(result.error);
      }
    });
  };

  if (showApprove) {
    return (
      <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-800">This event is awaiting your approval.</p>
            <p className="text-xs text-amber-600 mt-0.5">Review the details before approving to publish it.</p>
          </div>
        </div>

        {confirmAction === "approve" ? (
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {isPending ? "Approving…" : "Confirm Approve & Publish"}
            </button>
            <button
              onClick={() => setConfirmAction(null)}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-white transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              Approve & Publish
            </button>
            <button
              onClick={() => handleTransition("cancelled")}
              disabled={isPending}
              className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
            >
              Reject
            </button>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status transitions */}
      {allowedTransitions.length > 0 && (
        <div className="p-4 rounded-xl border border-gray-200 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Status Actions</p>
          <div className="flex flex-wrap gap-2">
            {allowedTransitions.map((newStatus) => {
              if (newStatus === "cancelled") return null; // handled in delete zone
              const isConfirming = confirmAction === newStatus;
              return isConfirming ? (
                <div key={newStatus} className="flex gap-2">
                  <button
                    onClick={() => handleTransition(newStatus)}
                    disabled={isPending}
                    className="px-3 py-1.5 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                  >
                    {isPending ? "Updating…" : `Confirm: ${EVENT_STATUS_LABELS[newStatus]}`}
                  </button>
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  key={newStatus}
                  onClick={() => handleTransition(newStatus)}
                  disabled={isPending}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Move to {EVENT_STATUS_LABELS[newStatus]}
                </button>
              );
            })}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
        </div>
      )}

      {/* Danger zone */}
      {(allowedTransitions.includes("cancelled") || currentStatus === "draft" || currentStatus === "pending_review") && (
        <div className="p-4 rounded-xl border border-red-200 space-y-3">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Danger Zone</p>
          <div className="flex flex-wrap gap-2">
            {allowedTransitions.includes("cancelled") && (
              confirmAction === "cancelled" ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleTransition("cancelled")}
                    disabled={isPending}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                  >
                    {isPending ? "Cancelling…" : "Confirm Cancel Event"}
                  </button>
                  <button onClick={() => setConfirmAction(null)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors">
                    Back
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmAction("cancelled")}
                  disabled={isPending}
                  className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  Cancel Event
                </button>
              )
            )}

            {(currentStatus === "draft" || currentStatus === "pending_review") && (
              confirmAction === "delete" ? (
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={isPending}
                    className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                  >
                    {isPending ? "Deleting…" : "Confirm Delete"}
                  </button>
                  <button onClick={() => setConfirmAction(null)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors">
                    Back
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  Delete Event
                </button>
              )
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
