"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { commitSwap, requestSwap, requestSwapCapIncrease } from "@/lib/actions/conference-swaps";
import type { SwapAlternative } from "@/lib/scheduler/types";

/**
 * Change one meeting, from the agenda it appears on.
 *
 * The delegate-facing swap controls used to live on their own route, which
 * looked up the viewer in `conference_registrations` and so could never find
 * anyone. Here they sit under the meeting they act on, which is the only place
 * someone is thinking about it.
 *
 * Asking for options is a SERVER round trip, not a preloaded list: the
 * alternatives depend on what is free at that moment, and a list rendered at
 * page load would offer slots that filled while somebody read it.
 */
export default function MeetingSwapControl({
  conferenceId,
  delegateSeatId,
  scheduleId,
  exhibitorName,
  remaining,
}: {
  conferenceId: string;
  delegateSeatId: string;
  scheduleId: string;
  exhibitorName: string;
  remaining: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<SwapAlternative[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capReached, setCapReached] = useState(false);
  const [reason, setReason] = useState("");
  const [asked, setAsked] = useState(false);
  const [left, setLeft] = useState(remaining);

  function findOptions() {
    setError(null);
    setOpen(true);
    startTransition(async () => {
      const res = await requestSwap(conferenceId, delegateSeatId, scheduleId);
      if (!res.success) {
        setError(res.error);
        setCapReached(res.code === "SWAP_CAP_REACHED");
        return;
      }
      setRequestId(res.data.requestId);
      setAlternatives(res.data.alternatives);
      setLeft(res.data.capStatus.remaining);
    });
  }

  function choose(replacementScheduleId: string) {
    if (!requestId) return;
    setError(null);
    startTransition(async () => {
      const res = await commitSwap(requestId, replacementScheduleId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setAlternatives(null);
      // The agenda is server-rendered, so the new meeting arrives on refresh
      // rather than being patched in here. One source for what is scheduled.
      router.refresh();
    });
  }

  function askForMore() {
    if (!reason.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await requestSwapCapIncrease(conferenceId, delegateSeatId, 1, reason.trim());
      if (!res.success) {
        setError(res.error);
        return;
      }
      setAsked(true);
      setCapReached(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={findOptions}
        className="text-xs font-medium text-[#163D6D] hover:underline"
      >
        Swap
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-gray-900">
          Replace your meeting with {exhibitorName}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Close
        </button>
      </div>

      {pending && !alternatives && (
        <p className="mt-2 text-sm text-gray-600">Looking for meetings you could take instead.</p>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {capReached && !asked && (
        <div className="mt-2 space-y-2">
          <label htmlFor={`swap-reason-${scheduleId}`} className="block text-xs text-gray-600">
            Tell conference staff why you need another swap, and they will decide.
          </label>
          <textarea
            id={`swap-reason-${scheduleId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={askForMore}
            disabled={pending || !reason.trim()}
            className="rounded-md bg-[#163D6D] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Ask for another swap
          </button>
        </div>
      )}

      {asked && (
        <p className="mt-2 text-sm text-gray-700">
          Your request went to conference staff. You will hear back from them.
        </p>
      )}

      {alternatives && alternatives.length === 0 && (
        <p className="mt-2 text-sm text-gray-700">
          There is nothing free to move you into right now. That can change as other people
          make their own swaps, so it is worth looking again later.
        </p>
      )}

      {alternatives && alternatives.length > 0 && (
        <>
          <ul className="mt-2 space-y-2">
            {alternatives.map((alt) => (
              <li
                key={alt.scheduleId}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {alt.exhibitorName ?? "Another exhibitor"}
                  </p>
                  {/* Why this one is on the list, in the reader's terms. The
                      score decided the ORDER; it is not an argument to a person
                      about who to meet, so it does not appear here. */}
                  {alt.reasons.length > 0 && (
                    <p className="text-xs text-gray-600">{alt.reasons.join(". ")}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => choose(alt.scheduleId)}
                  disabled={pending}
                  className="rounded-md border border-[#163D6D] px-3 py-1 text-xs font-medium text-[#163D6D] hover:bg-[#163D6D] hover:text-white disabled:opacity-50"
                >
                  Take this one
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            {left === 1 ? "One swap left after this." : `${left} swaps left after this.`}
          </p>
        </>
      )}
    </div>
  );
}
