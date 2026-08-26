"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { respondentDecide } from "@/lib/actions/benchmarking-notes";

/**
 * A store being asked whether it is happy for its business to be described to
 * its peers.
 *
 * The copy is the substance here. This is not a task to be completed — it is a
 * member deciding whether a sentence about their store may be published, and
 * the honest options are yes, no, and not answering. Silence never publishes on
 * its own, so nothing here nags: no red badge, no counter, no "action
 * required". If they read it and close the tab, that is a legitimate answer and
 * the note stays private.
 *
 * Objecting is given equal weight to agreeing, deliberately. A control where
 * "yes" is a button and "no" is a link people have to hunt for is a control
 * that has decided the answer.
 */

export interface RespondentNote {
  id: string;
  fieldLabel: string;
  note: string;
}

export default function RespondentNotes({ notes }: { notes: RespondentNote[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, "agreed" | "objected">>({});
  const [error, setError] = useState<string | null>(null);

  if (notes.length === 0) return null;

  async function decide(id: string, decision: "agreed" | "objected") {
    setBusy(id);
    setError(null);
    const res = await respondentDecide(id, decision);
    setBusy(null);
    if (!res.success) {
      setError(res.error ?? "Could not save that.");
      return;
    }
    setDone((p) => ({ ...p, [id]: decision }));
    router.refresh();
  }

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">
        A note about your figures
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        {notes.length === 1 ? "A reviewer has" : "Reviewers have"} written{" "}
        {notes.length === 1 ? "this" : "these"} to explain{" "}
        {notes.length === 1 ? "a figure" : "figures"} to other members. Nothing is
        published unless you say it can be. If you would rather it did not run, say so —
        that is a normal answer and no explanation is needed.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}

      <ul className="mt-4 space-y-3">
        {notes.map((n) => {
          const decided = done[n.id];
          return (
            <li key={n.id} className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {n.fieldLabel}
              </p>
              <p className="mt-1 text-sm text-gray-900">{n.note}</p>

              {decided ? (
                <p className="mt-3 text-sm text-gray-600">
                  {decided === "agreed"
                    ? "Thank you — this will run with your figures."
                    : "Noted. This will not be published."}
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === n.id}
                    onClick={() => decide(n.id, "agreed")}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                  >
                    That&rsquo;s fair — publish it
                  </button>
                  <button
                    type="button"
                    disabled={busy === n.id}
                    onClick={() => decide(n.id, "objected")}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                  >
                    I&rsquo;d rather you didn&rsquo;t
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-gray-500">
        Not sure? Leaving it is fine. Nothing runs without a yes.
      </p>
    </section>
  );
}
