"use client";

import { useState } from "react";
import { resetBetaSubmission } from "@/lib/actions/benchmarking-beta";
import { RESET_PHRASE } from "@/lib/benchmarking/beta-reset";
import BusyButton from "./BusyButton";

/**
 * Start again, for the people asked to break this.
 *
 * A beta tester's answers count as a real submission, which is the point: they
 * use the survey the way a member will rather than poking a sandbox. That also
 * means this button destroys something real, so it asks them to type the words
 * rather than hunt for a confirm dialog they will click through.
 *
 * ⛔ Deliberately at the FOOT of the page and deliberately plain. It is a tool,
 * not a call to action, and a red button at the top of a survey is a red button
 * somebody presses by accident on their way to question one.
 */
export default function BetaResetPanel({ benchmarkingId }: { benchmarkingId: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  if (done !== null) {
    return (
      <div className="mt-10 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-900">Answers wiped.</p>
        <p className="mt-1 text-xs text-gray-600">
          {done} added rows removed and every figure cleared. Your locations, key dates,
          people and logos are untouched, because those belong to your store rather than
          to this year&apos;s survey.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white"
        >
          Start again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-gray-200 pt-6">
      <h3 className="text-sm font-medium text-gray-900">Beta testing</h3>
      <p className="mt-1 max-w-2xl text-xs text-gray-600">
        You are appointed as a beta tester, so what you file here counts as your store&apos;s
        real submission. If you would rather wipe it and attack it again from empty, you
        can. Your locations, key dates, people and logos survive: they belong to your store
        rather than to this year&apos;s survey.
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-red-400 hover:text-red-700"
        >
          Wipe my answers and start again
        </button>
      ) : (
        <div className="mt-3 max-w-md rounded-lg border-l-4 border-red-500 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-900">
            This clears every figure you have entered
          </p>
          <p className="mt-1 text-xs text-red-900">
            Including your categories, income lines, expenses, team and competitors. It
            cannot be undone. Type <span className="font-mono font-semibold">{RESET_PHRASE}</span>{" "}
            to confirm.
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Type the confirmation phrase"
            className="mt-2 w-full rounded border border-red-300 px-2 py-1.5 text-sm"
          />
          <div className="mt-2 flex items-center gap-3">
            <BusyButton
              busyLabel="Wiping…"
              disabled={typed.trim().toUpperCase() !== RESET_PHRASE}
              onClick={async () => {
                const res = await resetBetaSubmission({
                  benchmarkingId,
                  confirmation: typed,
                });
                if (!res.success) {
                  setError(res.error ?? "Could not wipe the answers.");
                  return;
                }
                setDone(res.cleared ?? 0);
              }}
              className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white"
            >
              Wipe my answers
            </BusyButton>
            <button
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              className="text-xs text-gray-600 underline"
            >
              Cancel
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-800">{error}</p>}
        </div>
      )}
    </div>
  );
}
