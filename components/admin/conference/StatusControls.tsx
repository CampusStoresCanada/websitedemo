"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  transitionConferenceStatus,
  duplicateConference,
  deleteConference,
} from "@/lib/actions/conference";
import {
  scheduleConferenceTransition,
  cancelScheduledConferenceTransition,
  listScheduledConferenceTransitions,
} from "@/lib/actions/conference-schedule";
import {
  CONFERENCE_STATUS_TRANSITIONS,
  CONFERENCE_STATUS_LABELS,
  type ConferenceStatus,
} from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];
type ScheduledTransitionRow =
  Database["public"]["Tables"]["conference_scheduled_transitions"]["Row"];

interface StatusControlsProps {
  conference: ConferenceRow;
}

function formatRunAt(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
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

  const [scheduledTransitions, setScheduledTransitions] = useState<ScheduledTransitionRow[]>([]);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleTargetStatus, setScheduleTargetStatus] = useState<ConferenceStatus | "">("");
  const [scheduleRunAt, setScheduleRunAt] = useState("");
  const [scheduleConfirmText, setScheduleConfirmText] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const currentStatus = conference.status as ConferenceStatus;
  const allowedTransitions = CONFERENCE_STATUS_TRANSITIONS[currentStatus] ?? [];

  async function refreshScheduledTransitions() {
    const result = await listScheduledConferenceTransitions(conference.id);
    if (result.success && result.data) {
      setScheduledTransitions(result.data.filter((s) => s.status === "pending"));
    }
  }

  useEffect(() => {
    refreshScheduledTransitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conference.id]);

  async function handleSchedule() {
    if (!scheduleTargetStatus || !scheduleRunAt) return;
    setScheduleLoading(true);
    setScheduleError(null);
    const result = await scheduleConferenceTransition(
      conference.id,
      scheduleTargetStatus,
      new Date(scheduleRunAt).toISOString(),
      scheduleConfirmText
    );
    setScheduleLoading(false);

    if (result.success) {
      setShowScheduleForm(false);
      setScheduleTargetStatus("");
      setScheduleRunAt("");
      setScheduleConfirmText("");
      await refreshScheduledTransitions();
    } else {
      setScheduleError(result.error ?? "Failed to schedule transition");
    }
  }

  async function handleCancelSchedule(id: string) {
    setScheduleLoading(true);
    const result = await cancelScheduledConferenceTransition(id);
    setScheduleLoading(false);
    if (result.success) {
      await refreshScheduledTransitions();
    } else {
      setScheduleError(result.error ?? "Failed to cancel schedule");
    }
  }

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
                      className="px-3 py-1 text-xs font-medium text-white bg-accent rounded hover:bg-accent-hover disabled:opacity-50"
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
                    className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-hover disabled:opacity-50"
                  >
                    Move to {CONFERENCE_STATUS_LABELS[status]}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scheduled transitions — approve now, fires automatically later */}
      {(allowedTransitions.length > 0 || scheduledTransitions.length > 0) && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Schedule a Future Transition</h3>
          <p className="text-xs text-gray-500 mb-3">
            Super admin only. Approve a transition now with a target date/time — it fires
            automatically then, no one needs to click a button on the day.
          </p>

          {scheduleError && (
            <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {scheduleError}
            </div>
          )}

          {scheduledTransitions.length > 0 && (
            <ul className="mb-3 space-y-2">
              {scheduledTransitions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs"
                >
                  <span className="text-amber-900">
                    Moves to <strong>{CONFERENCE_STATUS_LABELS[s.target_status as ConferenceStatus] ?? s.target_status}</strong>{" "}
                    on {formatRunAt(s.run_at)}
                  </span>
                  <button
                    onClick={() => handleCancelSchedule(s.id)}
                    disabled={scheduleLoading}
                    className="px-2 py-1 text-xs font-medium text-amber-900 border border-amber-300 rounded hover:bg-amber-100 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          )}

          {allowedTransitions.length > 0 && (
            showScheduleForm ? (
              <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-gray-600">
                    Move to
                    <select
                      value={scheduleTargetStatus}
                      onChange={(e) => setScheduleTargetStatus(e.target.value as ConferenceStatus)}
                      className="ml-2 px-2 py-1 border border-gray-300 rounded text-xs bg-white"
                    >
                      <option value="">(choose)</option>
                      {allowedTransitions.map((status) => (
                        <option key={status} value={status}>
                          {CONFERENCE_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-gray-600">
                    at
                    <input
                      type="datetime-local"
                      value={scheduleRunAt}
                      min={new Date().toISOString().slice(0, 16)}
                      onChange={(e) => setScheduleRunAt(e.target.value)}
                      className="ml-2 px-2 py-1 border border-gray-300 rounded text-xs"
                    />
                  </label>
                </div>
                <label className="block text-xs text-gray-600">
                  Type &ldquo;CONFIRM&rdquo; to schedule this
                  <input
                    type="text"
                    value={scheduleConfirmText}
                    onChange={(e) => setScheduleConfirmText(e.target.value)}
                    placeholder='Type "CONFIRM" to proceed'
                    className="mt-1 block w-full px-2 py-1 border border-gray-300 rounded text-xs"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSchedule}
                    disabled={
                      scheduleLoading ||
                      !scheduleTargetStatus ||
                      !scheduleRunAt ||
                      scheduleConfirmText !== "CONFIRM"
                    }
                    className="px-3 py-1.5 text-xs font-medium text-white bg-accent rounded hover:bg-accent-hover disabled:opacity-50"
                  >
                    Schedule
                  </button>
                  <button
                    onClick={() => {
                      setShowScheduleForm(false);
                      setScheduleError(null);
                      setScheduleConfirmText("");
                    }}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowScheduleForm(true)}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                + Schedule a transition
              </button>
            )
          )}
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
