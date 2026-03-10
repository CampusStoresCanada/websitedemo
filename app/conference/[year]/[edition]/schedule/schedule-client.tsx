"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  commitSwap,
  requestSwap,
  requestSwapCapIncrease,
} from "@/lib/actions/conference-swaps";
import type { SwapAlternative } from "@/lib/scheduler/types";

interface MeetingRow {
  scheduleId: string;
  meetingSlotId: string;
  exhibitorRegistrationId: string;
  exhibitorOrganizationId: string;
  exhibitorName: string;
  dayNumber: number;
  slotNumber: number;
  startTime: string;
  endTime: string;
  suiteNumber: number | null;
}

interface SwapState {
  requestId: string;
  alternatives: SwapAlternative[];
}

interface CapState {
  effectiveCap: number;
  consumed: number;
  remaining: number;
}

export default function ScheduleClient({
  conferenceId,
  delegateRegistrationId,
  meetings,
}: {
  conferenceId: string;
  delegateRegistrationId: string;
  meetings: MeetingRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openScheduleId, setOpenScheduleId] = useState<string | null>(null);
  const [swapStateByScheduleId, setSwapStateByScheduleId] = useState<Record<string, SwapState>>(
    {}
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [lastCapState, setLastCapState] = useState<CapState | null>(null);
  const [showCapIncrease, setShowCapIncrease] = useState(false);
  const [pendingCommit, setPendingCommit] = useState<{
    fromScheduleId: string;
    toScheduleId: string;
    toExhibitorName: string;
  } | null>(null);

  const meetingByScheduleId = useMemo(
    () => new Map(meetings.map((meeting) => [meeting.scheduleId, meeting] as const)),
    [meetings]
  );

  async function handleGenerateOptions(scheduleId: string) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await requestSwap(conferenceId, delegateRegistrationId, scheduleId);
      if (!result.success) {
        setError(result.error);
        setShowCapIncrease(result.code === "SWAP_CAP_REACHED");
        return;
      }
      setShowCapIncrease(false);
      setLastCapState({
        effectiveCap: result.data.capStatus.effectiveCap,
        consumed: result.data.capStatus.consumed,
        remaining: result.data.capStatus.remaining,
      });

      setSwapStateByScheduleId((current) => ({
        ...current,
        [scheduleId]: {
          requestId: result.data.requestId,
          alternatives: result.data.alternatives,
        },
      }));
      setOpenScheduleId(scheduleId);
      setInfo(
        `Found ${result.data.alternatives.length} option(s). Score is primary; "why lower" is for transparency.`
      );
    });
  }

  async function handleCommitSwap(scheduleId: string, replacementScheduleId: string) {
    setError(null);
    setInfo(null);
    const swapState = swapStateByScheduleId[scheduleId];
    if (!swapState) return;

    startTransition(async () => {
      const result = await commitSwap(swapState.requestId, replacementScheduleId);
      if (!result.success) {
        setError(result.error);
        return;
      }

      setInfo("Swap committed. Your schedule has been updated.");
      setPendingCommit(null);
      router.refresh();
    });
  }

  async function handleCapIncreaseRequest() {
    setError(null);
    setInfo(null);
    const reason = window.prompt("Why do you need additional swaps?");
    if (!reason || !reason.trim()) return;

    startTransition(async () => {
      const result = await requestSwapCapIncrease(
        conferenceId,
        delegateRegistrationId,
        1,
        reason.trim()
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      setShowCapIncrease(false);
      setInfo("Cap increase request submitted to admin.");
    });
  }

  if (meetings.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 p-8 text-center">
        <h2 className="text-lg font-semibold text-gray-900">No meetings scheduled yet</h2>
        <p className="mt-2 text-sm text-gray-600">
          Once the active schedule is published, your meetings will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {info}
        </div>
      ) : null}
      {lastCapState ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Swaps remaining:{" "}
          <span className="font-semibold">
            {lastCapState.remaining} of {lastCapState.effectiveCap}
          </span>{" "}
          used {lastCapState.consumed}.
        </div>
      ) : null}
      {showCapIncrease ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Swap cap reached.{" "}
          <button
            type="button"
            onClick={() => void handleCapIncreaseRequest()}
            className="font-semibold underline"
          >
            Request +1 swap
          </button>
        </div>
      ) : null}

      {meetings.map((meeting) => {
        const swapState = swapStateByScheduleId[meeting.scheduleId];
        const isOpen = openScheduleId === meeting.scheduleId;
        return (
          <div key={meeting.scheduleId} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{meeting.exhibitorName}</h3>
                <p className="text-sm text-gray-600">
                  Day {meeting.dayNumber}, Slot {meeting.slotNumber} ({meeting.startTime} -{" "}
                  {meeting.endTime})
                  {meeting.suiteNumber ? ` • Suite ${meeting.suiteNumber}` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => void handleGenerateOptions(meeting.scheduleId)}
                className="rounded-md bg-[#D60001] px-3 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
              >
                See potential swaps
              </button>
            </div>

            {isOpen && swapState ? (
              <div className="mt-4 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                {swapState.alternatives.length === 0 ? (
                  <p className="text-sm text-gray-700">
                    No valid alternatives found that preserve constraints.
                  </p>
                ) : (
                  swapState.alternatives.map((alternative) => {
                    const altMeeting = meetingByScheduleId.get(alternative.scheduleId);
                    return (
                      <div
                        key={alternative.scheduleId}
                        className="rounded-md border border-gray-200 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {altMeeting?.exhibitorName ?? "Alternative exhibitor"}
                            </p>
                            <p className="text-xs text-gray-600">
                              Score:{" "}
                              <span className="font-semibold text-gray-900">
                                {Math.round(alternative.score)}
                              </span>{" "}
                              ({alternative.scoreDeltaFromOriginal >= 0 ? "+" : ""}
                              {Math.round(alternative.scoreDeltaFromOriginal)} vs current)
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                              {altMeeting
                                ? `Day ${altMeeting.dayNumber}, Slot ${altMeeting.slotNumber} (${altMeeting.startTime} - ${altMeeting.endTime})`
                                : "Meeting time pending"}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              setPendingCommit({
                                fromScheduleId: meeting.scheduleId,
                                toScheduleId: alternative.scheduleId,
                                toExhibitorName:
                                  altMeeting?.exhibitorName ?? "Alternative exhibitor",
                              })
                            }
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800 hover:border-gray-400 disabled:opacity-50"
                          >
                            Swap to this option
                          </button>
                        </div>
                        {alternative.whyLower.length > 0 ? (
                          <p className="mt-2 text-xs text-gray-500">
                            Why lower: {alternative.whyLower.slice(0, 3).join("; ")}
                          </p>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      {pendingCommit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Confirm swap</h3>
            <p className="mt-2 text-sm text-gray-700">
              Swap your current meeting for{" "}
              <span className="font-semibold">{pendingCommit.toExhibitorName}</span>?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCommit(null)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-gray-400"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  void handleCommitSwap(
                    pendingCommit.fromScheduleId,
                    pendingCommit.toScheduleId
                  )
                }
                className="rounded-md bg-[#D60001] px-3 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
              >
                Confirm swap
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
