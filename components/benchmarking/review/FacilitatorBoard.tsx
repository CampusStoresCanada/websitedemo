"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  resolveFieldReview,
  applyFieldReview,
} from "@/lib/actions/benchmarking-review";

interface Row {
  id: string;
  reviewerName: string;
  status: string;
  comment: string | null;
  proposedExample: string | null;
  proposedExampleCredit: string | null;
  proposedHelpText: string | null;
  resolution: string;
  resolutionNote: string | null;
}

interface Group {
  fieldName: string;
  label: string;
  section: string;
  reviewerNote: string | null;
  currentHelpText: string | null;
  currentExample: string | null;
  disagreement: boolean;
  concerns: number;
  openRows: number;
  proposals: number;
  rows: Row[];
}

const STATUS_LABEL: Record<string, string> = {
  ok: "Reads fine",
  ambiguous: "Could be misread",
  needs_example: "Needs an example",
  pending: "Not answered",
};

export default function FacilitatorBoard({
  surveyTitle,
  fiscalYear,
  reviewerCount,
  groups,
}: {
  surveyTitle: string;
  fiscalYear: number;
  reviewerCount: number;
  groups: Group[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (
    id: string,
    fn: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    setBusy(id);
    setError(null);
    const result = await fn();
    if (result.success) router.refresh();
    else setError(result.error ?? "Failed");
    setBusy(null);
  };

  const contested = groups.filter((g) => g.disagreement).length;
  const sessionList = groups.filter((g) =>
    g.rows.some((r) => r.resolution === "for_session"),
  ).length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Question Review</h1>
      <p className="text-sm text-gray-500 mb-6">
        {surveyTitle} &middot; FY{fiscalYear} &middot; {reviewerCount} reviewer
        {reviewerCount === 1 ? "" : "s"}
      </p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Fields with feedback" value={groups.length} />
        <Stat
          label="Reviewers disagree"
          value={contested}
          hint="Top of the list"
        />
        <Stat label="Parked for the session" value={sessionList} />
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4 p-3 bg-red-50 rounded">
          {error}
        </p>
      )}

      {groups.length === 0 && (
        <div className="p-8 text-center bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-500">
            No reviews submitted yet. Once content reviewers start working
            through the questions, their feedback lands here — most contested
            first.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {groups.map((g) => (
          <div
            key={g.fieldName}
            className={`border rounded-lg bg-white ${
              g.disagreement ? "border-amber-300" : "border-gray-200"
            }`}
          >
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                    {g.section}
                  </p>
                  <h2 className="text-base font-semibold text-gray-900">
                    {g.label}
                  </h2>
                  <code className="text-[11px] text-gray-400">
                    {g.fieldName}
                  </code>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {g.disagreement && (
                    <span className="text-[11px] font-medium px-2 py-1 rounded bg-amber-100 text-amber-800">
                      Split verdict
                    </span>
                  )}
                  {g.proposals > 0 && (
                    <span className="text-[11px] font-medium px-2 py-1 rounded bg-slate-100 text-slate-700">
                      {g.proposals} proposal{g.proposals === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>

              {g.currentHelpText && (
                <p className="mt-3 text-xs text-gray-500">
                  <span className="font-medium text-gray-600">Current: </span>
                  {g.currentHelpText}
                </p>
              )}
              {g.currentExample && (
                <p className="mt-1 text-xs text-slate-600">
                  <span className="font-medium">Current example: </span>
                  {g.currentExample}
                </p>
              )}
            </div>

            <div className="divide-y divide-gray-100">
              {g.rows.map((r) => (
                <div key={r.id} className="p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {r.reviewerName}
                      </span>
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded ${
                          r.status === "ok"
                            ? "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </div>
                    {r.resolution !== "open" && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                        {r.resolution === "for_session"
                          ? "For the session"
                          : r.resolution}
                      </span>
                    )}
                  </div>

                  {r.comment && (
                    <p className="text-sm text-gray-700 mb-2">{r.comment}</p>
                  )}

                  {r.proposedExample && (
                    <div className="mb-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Proposed example
                        {r.proposedExampleCredit
                          ? ` · ${r.proposedExampleCredit}`
                          : " · unattributed"}
                      </p>
                      <p className="mt-1 text-xs text-slate-700">
                        {r.proposedExample}
                      </p>
                    </div>
                  )}

                  {r.proposedHelpText && (
                    <div className="mb-2 rounded border border-blue-200 bg-blue-50 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                        Proposed rewrite
                      </p>
                      <p className="mt-1 text-xs text-blue-900">
                        {r.proposedHelpText}
                      </p>
                    </div>
                  )}

                  {r.resolution === "open" && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {(r.proposedExample || r.proposedHelpText) && (
                        <button
                          onClick={() =>
                            act(r.id, () => applyFieldReview(r.id))
                          }
                          disabled={busy === r.id}
                          className="text-xs font-medium px-3 py-1.5 rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
                        >
                          {busy === r.id ? "…" : "Apply to survey"}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          act(r.id, () =>
                            resolveFieldReview(r.id, "for_session"),
                          )
                        }
                        disabled={busy === r.id}
                        className="text-xs font-medium px-3 py-1.5 rounded border border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                      >
                        Park for the session
                      </button>
                      <button
                        onClick={() =>
                          act(r.id, () => resolveFieldReview(r.id, "declined"))
                        }
                        disabled={busy === r.id}
                        className="text-xs font-medium px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}
