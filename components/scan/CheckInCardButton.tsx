"use client";

import { useState, useTransition } from "react";
import { checkMeInAtBooth, checkMeInToEvent, confirmMeetingAsExhibitor } from "@/lib/actions/check-in-cards";

/**
 * The one tap behind a check-in card (the scan page itself records nothing).
 */
export function CheckInCardButton({
  action,
  id,
  label,
  doneText,
  personIds,
}: {
  action: "booth" | "exhibitor" | "event";
  id: string;
  label: string;
  doneText: string;
  personIds?: string[];
}) {
  const [state, setState] = useState<{ done: boolean; error: string | null }>({ done: false, error: null });
  const [pending, startTransition] = useTransition();

  if (state.done) {
    return <p className="rounded-lg bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-800">✓ {doneText}</p>;
  }
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res =
              action === "booth"
                ? await checkMeInAtBooth(id)
                : action === "exhibitor"
                  ? await confirmMeetingAsExhibitor(id, personIds)
                  : await checkMeInToEvent(id);
            setState(res.success ? { done: true, error: null } : { done: false, error: res.error });
          })
        }
        className="min-h-12 w-full rounded-lg bg-slate-900 px-4 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? "…" : label}
      </button>
      {state.error ? <p className="mt-2 text-sm text-red-700">{state.error}</p> : null}
    </div>
  );
}
