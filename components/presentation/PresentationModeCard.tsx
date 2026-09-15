"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePresentationMode } from "@/lib/actions/presentation-mode";
import {
  PRESENTATION_LABELS,
  PRESENTATION_LEVELS,
  type PresentationLevel,
} from "@/lib/presentation/mode";

/**
 * The way in. Turning it off again lives on the indicator bar, which is
 * reachable from any page — the admin area closes the moment this is on, so a
 * control that only existed here would be a door that locks behind you.
 */
export default function PresentationModeCard() {
  const [choice, setChoice] = useState<PresentationLevel>("member");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await updatePresentationMode(choice);
      if (!res.success) {
        setError(res.error ?? "Could not turn presentation mode on");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="mb-1 text-sm font-semibold text-amber-900">
        Presentation mode
      </h3>
      <p className="mb-3 text-xs text-amber-800">
        Before a screen share. Renders the whole site as the audience you pick,
        with staff-only data withheld server-side — it is never sent to your
        browser, so it cannot leak. Your edit permissions are untouched. The
        admin area closes while it is on.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="presentation-level">
          Audience
        </label>
        <select
          id="presentation-level"
          value={choice}
          onChange={(e) => setChoice(e.target.value as PresentationLevel)}
          disabled={pending}
          className="rounded border border-amber-300 bg-white px-2 py-1 text-sm text-gray-800"
        >
          {PRESENTATION_LEVELS.map((l) => (
            <option key={l} value={l}>
              Show me as: {PRESENTATION_LABELS[l]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={start}
          disabled={pending}
          className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {pending ? "Turning on…" : "Turn on"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
