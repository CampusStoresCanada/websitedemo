"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { transitionConferenceStatus } from "@/lib/actions/conference";
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
import { launchBlockers } from "@/lib/conference/launch-readiness";
import type { ReadinessStatus } from "@/lib/conference/launch-readiness";
import type { ConferenceStatusReadiness } from "@/lib/actions/conference-launch";
import type { Database } from "@/lib/database.types";

type ScheduledTransitionRow =
  Database["public"]["Tables"]["conference_scheduled_transitions"]["Row"];

interface Props {
  conferenceId: string;
  status: ConferenceStatus;
  readiness: ConferenceStatusReadiness;
}

const STATUS_STYLE: Record<ReadinessStatus, { dot: string; text: string; label: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-gray-700", label: "Done" },
  blocked: { dot: "bg-red-500", text: "text-red-700", label: "Blocked" },
  warning: { dot: "bg-amber-500", text: "text-amber-700", label: "Warning" },
  info: { dot: "bg-blue-400", text: "text-blue-700", label: "Note" },
};

const STAGE_BADGE: Record<ReadinessStatus, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  blocked: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  info: "bg-blue-100 text-blue-700",
};

function formatRunAt(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Per-transition readiness gate. Only draft→announced and
 * announced→registration_open are gated at all — everything else in the
 * chain (registration_closed, scheduling, active, completed, archived) is
 * pure administrative progression with nothing to check. Mirrors exactly
 * what performConferenceStatusTransition itself gates on (lib/actions/conference.ts)
 * so this can never show "ready" for something the server will reject.
 */
function gateFor(
  from: ConferenceStatus,
  to: ConferenceStatus,
  readiness: ConferenceStatusReadiness
): { canProceed: boolean; blockers: string[]; showStages: boolean } {
  if (from === "draft" && to === "announced") {
    return { canProceed: readiness.announce.canAnnounce, blockers: readiness.announce.blockers, showStages: false };
  }
  if (from === "announced" && to === "registration_open") {
    return {
      canProceed: readiness.launch.canGoOnSale,
      blockers: launchBlockers(readiness.launch),
      showStages: true,
    };
  }
  return { canProceed: true, blockers: [], showStages: false };
}

/**
 * The single control surface for the conference lifecycle — Draft →
 * Announced → (On Sale: registration_open/registration_closed) →
 * (Conference: scheduling/active/completed) → Archived. Rendered identically
 * from the Overview page and the Status page: one set of functions decides
 * what's visible (VISIBLE_CONFERENCE_STATUSES, lib/constants/conference.ts)
 * and what can be moved next, so there is exactly one place to look for "why
 * can't I do X" and exactly one place that can do it wrong.
 */
export default function ConferenceLifecycle({ conferenceId, status, readiness }: Props) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConferenceStatus | null>(null);

  const [scheduledTransitions, setScheduledTransitions] = useState<ScheduledTransitionRow[]>([]);
  const [showScheduleForm, setShowScheduleForm] = useState<ConferenceStatus | null>(null);
  const [scheduleRunAt, setScheduleRunAt] = useState("");
  const [scheduleConfirmText, setScheduleConfirmText] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const allowedTransitions = CONFERENCE_STATUS_TRANSITIONS[status] ?? [];

  async function refreshScheduledTransitions() {
    const result = await listScheduledConferenceTransitions(conferenceId);
    if (result.success && result.data) {
      setScheduledTransitions(result.data.filter((s) => s.status === "pending"));
    }
  }

  useEffect(() => {
    refreshScheduledTransitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conferenceId]);

  async function handleTransition(newStatus: ConferenceStatus) {
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    const result = await transitionConferenceStatus(conferenceId, newStatus);
    setIsLoading(false);
    setConfirmTarget(null);
    if (result.success) {
      setSuccess(`Status changed to "${CONFERENCE_STATUS_LABELS[newStatus]}"`);
      router.refresh();
    } else {
      setError(result.error ?? "Failed to transition");
    }
  }

  async function handleSchedule(target: ConferenceStatus) {
    if (!scheduleRunAt) return;
    setScheduleLoading(true);
    setScheduleError(null);
    const result = await scheduleConferenceTransition(
      conferenceId,
      target,
      new Date(scheduleRunAt).toISOString(),
      scheduleConfirmText
    );
    setScheduleLoading(false);
    if (result.success) {
      setShowScheduleForm(null);
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
    if (result.success) await refreshScheduledTransitions();
    else setScheduleError(result.error ?? "Failed to cancel schedule");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Current Status</h3>
        <span className="inline-flex items-center px-3 py-1 text-sm font-medium rounded-full bg-gray-100 text-gray-900">
          {CONFERENCE_STATUS_LABELS[status]}
        </span>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">{success}</div>
      )}

      {scheduledTransitions.length > 0 && (
        <ul className="space-y-2">
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

      {allowedTransitions.map((target) => {
        const gate = gateFor(status, target, readiness);
        return (
          <div key={target} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Next: {CONFERENCE_STATUS_LABELS[target]}
              </h3>
              {gate.blockers.length > 0 && (
                <span className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800">
                  {gate.blockers.length} blocker(s)
                </span>
              )}
            </div>

            {gate.showStages && (
              <ol className="mt-3 space-y-3">
                {readiness.launch.stages.map((stage, index) => (
                  <li key={stage.key} className="rounded-md border border-gray-200">
                    <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
                          {index + 1}
                        </span>
                        <span className="text-xs font-semibold text-gray-900">{stage.label}</span>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_BADGE[stage.status]}`}>
                        {STATUS_STYLE[stage.status].label}
                      </span>
                    </div>
                    <ul className="divide-y divide-gray-50">
                      {stage.checks.map((check) => (
                        <li key={check.id} className="px-3 py-2">
                          <p className={`text-xs font-medium ${STATUS_STYLE[check.status].text}`}>{check.label}</p>
                          <p className="text-[11px] text-gray-500">{check.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
            {!gate.showStages && gate.blockers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {gate.blockers.map((b) => (
                  <li key={b} className="text-xs text-red-700">
                    {b}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {confirmTarget === target ? (
                <>
                  <span className="text-sm text-gray-700">
                    Change to &ldquo;{CONFERENCE_STATUS_LABELS[target]}&rdquo;?
                  </span>
                  <button
                    onClick={() => handleTransition(target)}
                    disabled={isLoading}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-accent rounded hover:bg-accent-hover disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmTarget(null)}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmTarget(target)}
                  disabled={isLoading || !gate.canProceed}
                  title={gate.canProceed ? undefined : "Clear the blockers above first."}
                  className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Move to {CONFERENCE_STATUS_LABELS[target]}
                </button>
              )}

              {showScheduleForm === target ? (
                <div className="w-full space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                  {scheduleError && (
                    <div className="p-2 rounded bg-red-50 border border-red-200 text-xs text-red-700">
                      {scheduleError}
                    </div>
                  )}
                  <label className="block text-xs text-gray-600">
                    Run at
                    <input
                      type="datetime-local"
                      value={scheduleRunAt}
                      min={new Date().toISOString().slice(0, 16)}
                      onChange={(e) => setScheduleRunAt(e.target.value)}
                      className="ml-2 px-2 py-1 border border-gray-300 rounded text-xs"
                    />
                  </label>
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
                      onClick={() => handleSchedule(target)}
                      disabled={scheduleLoading || !scheduleRunAt || scheduleConfirmText !== "CONFIRM"}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-accent rounded hover:bg-accent-hover disabled:opacity-50"
                    >
                      Schedule
                    </button>
                    <button
                      onClick={() => {
                        setShowScheduleForm(null);
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
                  onClick={() => setShowScheduleForm(target)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  + Schedule for later
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
