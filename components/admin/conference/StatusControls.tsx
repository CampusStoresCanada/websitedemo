"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { duplicateConference, deleteConference } from "@/lib/actions/conference";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];

interface StatusControlsProps {
  conference: ConferenceRow;
}

/**
 * Conference-management utilities that sit alongside the lifecycle (see
 * ConferenceLifecycle, which owns status transitions and scheduling — moving
 * that logic here too is exactly the duplicate-control problem this split
 * avoids) but aren't part of it: duplicating into next year's edition, and
 * deleting a still-draft one.
 */
export default function StatusControls({ conference }: StatusControlsProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [duplicateYear, setDuplicateYear] = useState(conference.year + 1);
  const [duplicateOutcome, setDuplicateOutcome] = useState<{
    conferenceId: string;
    flaggedEdits: string[];
  } | null>(null);

  const currentStatus = conference.status;

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
              className="px-3 py-1 text-xs font-medium text-white bg-accent rounded hover:bg-accent-hover disabled:opacity-50"
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
              className="mt-3 px-3 py-1.5 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-hover"
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
