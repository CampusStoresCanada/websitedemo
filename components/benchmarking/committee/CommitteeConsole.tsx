"use client";

import { useState } from "react";
import Link from "next/link";
import { WORKSTREAMS } from "@/lib/benchmarking/committee-workstreams";
import AssignPanel, { fmt } from "./AssignPanel";

interface Holder {
  subjectId: string;
  name: string;
  capability: string;
  reason: string;
  /** null for an ex officio holder — the capability follows the office. */
  endsAt: string | null;
}

export default function CommitteeConsole({
  isLead,
  isAdmin,
  canDelegateAny,
  delegableUntil,
  holders,
  progress,
}: {
  isLead: boolean;
  isAdmin: boolean;
  canDelegateAny: boolean;
  delegableUntil: Record<string, string | null>;
  holders: Holder[];
  progress: {
    reviewDone: number;
    reviewTotal: number;
    openFlags: number;
    recipientsDone: number;
    recipientsTotal: number;
    recipientsEscalated: number;
  };
}) {
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byCapability = (cap: string) =>
    holders.filter((h) => h.capability === cap);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1">
          Benchmarking committee
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {isLead ? "Your committee" : "Committee overview"}
        </h1>
        <p className="text-sm text-gray-600">
          Three pieces of work. You can do any of them yourself, hand them to
          someone else, or both — plenty of people take more than one.
        </p>
      </header>

      {error && (
        <p className="text-sm text-red-600 mb-4 p-3 bg-red-50 rounded">
          {error}
        </p>
      )}

      <div className="space-y-4">
        {WORKSTREAMS.map((w) => {
          const people = byCapability(w.capability);
          const ceiling = delegableUntil[w.capability];
          const canAssign = isAdmin || ceiling != null;

          const progressLabel =
            w.capability === "benchmarking.content_review"
              ? `${progress.reviewDone} of ${progress.reviewTotal} questions answered`
              : w.capability === "benchmarking.qa_verify"
                ? progress.openFlags === 0
                  ? "No flags waiting"
                  : `${progress.openFlags} flag${progress.openFlags === 1 ? "" : "s"} waiting`
                : w.capability === "benchmarking.recipient_confirm"
                  ? progress.recipientsTotal === 0
                    ? "Queue not built yet"
                    : `${progress.recipientsDone} of ${progress.recipientsTotal} stores confirmed` +
                      (progress.recipientsEscalated > 0
                        ? ` · ${progress.recipientsEscalated} with the office`
                        : "")
                  : null;

          return (
            <section
              key={w.capability}
              className="border border-gray-200 rounded-lg bg-white overflow-hidden"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {w.title}
                    </h2>
                    <p className="text-sm text-gray-600 mt-0.5">{w.summary}</p>
                  </div>
                  {people.length > 0 && (
                    <span className="shrink-0 text-[11px] font-medium px-2 py-1 rounded bg-green-50 text-green-700">
                      {people.length} assigned
                    </span>
                  )}
                </div>

                <dl className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">
                      What you do
                    </dt>
                    <dd className="text-gray-700 mt-1">{w.whatYouDo}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">
                      Why it matters
                    </dt>
                    <dd className="text-gray-700 mt-1">{w.whyItMatters}</dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                  <span>⏱ {w.timeCommitment}</span>
                  <span>📅 {w.window}</span>
                </div>

                {/* Am I on track? */}
                {progressLabel && (
                  <div className="mt-4 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                    <p className="text-xs font-medium text-gray-700">
                      {progressLabel}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Done when: {w.doneWhen}
                    </p>
                    {((w.capability === "benchmarking.content_review" &&
                      progress.reviewTotal > 0) ||
                      (w.capability === "benchmarking.recipient_confirm" &&
                        progress.recipientsTotal > 0)) && (
                      <div className="mt-2 h-1.5 w-full rounded bg-gray-200 overflow-hidden">
                        <div
                          className="h-full bg-gray-800"
                          style={{
                            width: `${Math.round(
                              w.capability === "benchmarking.content_review"
                                ? (progress.reviewDone / progress.reviewTotal) *
                                    100
                                : (progress.recipientsDone /
                                    progress.recipientsTotal) *
                                    100,
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {people.length > 0 && (
                  <ul className="mt-4 space-y-1">
                    {people.map((p, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-gray-800">{p.name}</span>
                        <span className="text-xs text-gray-400">
                          {p.endsAt ? `until ${fmt(p.endsAt)}` : "ex officio"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    href={w.href}
                    className="text-sm font-medium px-4 py-2 rounded bg-gray-900 text-white hover:bg-gray-800"
                  >
                    I&rsquo;ll do this
                  </Link>
                  {canAssign && (
                    <button
                      onClick={() =>
                        setAssigning(
                          assigning === w.capability ? null : w.capability,
                        )
                      }
                      className="text-sm font-medium px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      {assigning === w.capability ? "Cancel" : "Assign someone"}
                    </button>
                  )}
                  {!canAssign && !isAdmin && (
                    <span className="text-xs text-gray-400">
                      You can do this yourself, but not hand it out
                    </span>
                  )}
                </div>
              </div>

              {assigning === w.capability && (
                <AssignPanel
                  capability={w.capability}
                  title={w.title}
                  ceiling={ceiling ?? null}
                  onError={setError}
                  onDone={() => setAssigning(null)}
                />
              )}
            </section>
          );
        })}
      </div>

      {!canDelegateAny && !isAdmin && (
        <p className="mt-6 text-sm text-gray-500">
          You hold committee work but not the ability to hand it out. If you
          need to bring someone in, ask the office.
        </p>
      )}
    </div>
  );
}
