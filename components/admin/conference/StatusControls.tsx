"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  transitionConferenceStatus,
  duplicateConference,
  deleteConference,
} from "@/lib/actions/conference";
import {
  CONFERENCE_STATUS_TRANSITIONS,
  CONFERENCE_STATUS_LABELS,
  type ConferenceStatus,
} from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];

interface StatusControlsProps {
  conference: ConferenceRow;
}

export default function StatusControls({ conference }: StatusControlsProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [duplicateYear, setDuplicateYear] = useState(conference.year + 1);
  const [duplicateOutcome, setDuplicateOutcome] = useState<{
    conferenceId: string;
    flaggedEdits: string[];
  } | null>(null);

  const currentStatus = conference.status as ConferenceStatus;
  const allowedTransitions = CONFERENCE_STATUS_TRANSITIONS[currentStatus] ?? [];

  const handleTransition = async (newStatus: ConferenceStatus) => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    const result = await transitionConferenceStatus(conference.id, newStatus);
    setIsLoading(false);
    setConfirmAction(null);

    if (result.success) {
      setSuccess(`Status changed to "${CONFERENCE_STATUS_LABELS[newStatus]}"`);
      router.refresh();
    } else {
      setError(result.error ?? "Failed to transition");
    }
  };

  const handleDuplicate = async () => {
    setIsLoading(true);
    setError(null);
    setDuplicateOutcome(null);
    const result = await duplicateConference(conference.id, duplicateYear);
    setIsLoading(false);
    setConfirmAction(null);

    if (result.success && result.data) {
      setDuplicateOutcome({
        conferenceId: result.data.id,
        flaggedEdits: result.flaggedEdits ?? [],
      });
    } else {
      setError(result.error ?? "Failed to duplicate");
    }
  };

  const handleDelete = async () => {
    setIsLoading(true);
    setError(null);
    const result = await deleteConference(conference.id);
    setIsLoading(false);
    setConfirmAction(null);

    if (result.success) {
      router.push("/admin/conference");
    } else {
      setError(result.error ?? "Failed to delete");
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">{success}</div>
      )}

      {/* Current status */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Current Status</h3>
        <span className="inline-flex items-center px-3 py-1 text-sm font-medium rounded-full bg-gray-100 text-gray-900">
          {CONFERENCE_STATUS_LABELS[currentStatus]}
        </span>
      </div>

      {/* Status transitions */}
      {allowedTransitions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Status Transitions</h3>
          <div className="flex gap-3">
            {allowedTransitions.map((status) => (
              <div key={status}>
                {confirmAction === `transition-${status}` ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">
                      Change to &ldquo;{CONFERENCE_STATUS_LABELS[status]}&rdquo;?
                    </span>
                    <button
                      onClick={() => handleTransition(status)}
                      disabled={isLoading}
                      className="px-3 py-1 text-xs font-medium text-white bg-[#EE2A2E] rounded hover:bg-[#b50001] disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmAction(null)}
                      className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmAction(`transition-${status}`)}
                    disabled={isLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-[#EE2A2E] rounded-md hover:bg-[#D92327] disabled:opacity-50"
                  >
                    Move to {CONFERENCE_STATUS_LABELS[status]}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duplicate */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Duplicate Conference</h3>
        <p className="text-xs text-gray-500 mb-3">
          Copy this conference to create next year&apos;s edition. Products, parameters, and legal
          docs are copied; registrations are not.
        </p>
        {confirmAction === "duplicate" ? (
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-700">New year:</label>
            <input
              type="number"
              value={duplicateYear}
              onChange={(e) => setDuplicateYear(parseInt(e.target.value))}
              className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
            />
            <button
              onClick={handleDuplicate}
              disabled={isLoading}
              className="px-3 py-1 text-xs font-medium text-white bg-[#EE2A2E] rounded hover:bg-[#b50001] disabled:opacity-50"
            >
              Duplicate
            </button>
            <button onClick={() => setConfirmAction(null)} className="px-3 py-1 text-xs text-gray-500">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmAction("duplicate")}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Duplicate Conference
          </button>
        )}
        {duplicateOutcome && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900 mb-2">
              Duplicate created. Required follow-up edits:
            </p>
            <ul className="text-sm text-amber-900 list-disc pl-5">
              {duplicateOutcome.flaggedEdits.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button
              onClick={() => router.push(`/admin/conference/${duplicateOutcome.conferenceId}`)}
              className="mt-3 px-3 py-1.5 text-sm font-medium text-white bg-[#EE2A2E] rounded-md hover:bg-[#b50001]"
            >
              Open Duplicated Conference
            </button>
          </div>
        )}
      </div>

      {/* Delete (draft only) */}
      {currentStatus === "draft" && (
        <div className="bg-white border border-red-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-red-700 mb-3">Danger Zone</h3>
          {confirmAction === "delete" ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-red-700">Permanently delete this conference?</span>
              <button
                onClick={handleDelete}
                disabled={isLoading}
                className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
              >
                Yes, Delete
              </button>
              <button onClick={() => setConfirmAction(null)} className="px-3 py-1 text-xs text-gray-500">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmAction("delete")}
              className="px-4 py-2 text-sm font-medium text-red-700 border border-red-300 rounded-md hover:bg-red-50"
            >
              Delete Conference
            </button>
          )}
        </div>
      )}
    </div>
  );
}
