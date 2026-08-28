"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { reviewDeltaFlag } from "@/lib/actions/benchmarking-admin";
import { writeNote } from "@/lib/actions/benchmarking-notes";

interface Flag {
  id: string;
  benchmarkingId: string;
  organizationId: string;
  organizationName: string;
  fieldName: string;
  previousValue: number | null;
  currentValue: number | null;
  pctChange: number | null;
  absChange: number | null;
  respondentAction: string | null;
  respondentExplanation: string | null;
  committeeStatus: string;
  committeeNotes: string | null;
  reviewedAt: string | null;
}

type Filter = "all" | "pending" | "approved" | "rejected";

interface StoreContact {
  id: string;
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

interface StoreContactCard {
  organizationId: string;
  organizationName: string;
  respondentContactId: string | null;
  contacts: StoreContact[];
}

interface DeltaFlagsTableProps {
  flags: Flag[];
  fiscalYear: number;
  surveyId: string;
  contactsByOrg: Record<string, StoreContactCard>;
}

function formatFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(val: number | null): string {
  if (val === null || val === undefined) return "—";
  // If it looks like currency (> 100), format with $ sign
  if (Math.abs(val) >= 100) {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    }).format(val);
  }
  return val.toLocaleString("en-CA");
}

export default function DeltaFlagsTable({
  flags,
  fiscalYear,
  surveyId,
  contactsByOrg,
}: DeltaFlagsTableProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  // The published explanation is a different thing from the committee's private
  // note, so it gets its own box and its own state.
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [sendingNote, setSendingNote] = useState<string | null>(null);
  const [noteResult, setNoteResult] = useState<Record<string, string>>({});

  /**
   * Write the explanation the members will eventually read.
   *
   * Deliberately separate from accept/follow-up/exclude, and never required by
   * them. A reviewer usually cannot explain a figure until they have phoned the
   * store, so a flag has to be able to sit in follow-up and gain its note days
   * later — forcing the note at review time would only produce guesses.
   */
  const sendExplanation = async (flag: Flag, submit: boolean) => {
    const text = (explanations[flag.id] ?? "").trim();
    if (!text) return;
    setSendingNote(flag.id);
    const res = await writeNote({
      surveyId,
      organizationId: flag.organizationId,
      fieldName: flag.fieldName,
      note: text,
      deltaFlagId: flag.id,
      submit,
    });
    setSendingNote(null);
    setNoteResult((p) => ({
      ...p,
      [flag.id]: res.success
        ? submit
          ? "Sent to the committee lead."
          : "Saved as a draft."
        : res.error ?? "Could not save that.",
    }));
    if (res.success) setExplanations((p) => ({ ...p, [flag.id]: "" }));
  };

  const filtered = flags.filter((f) => {
    if (filter === "all") return true;
    return f.committeeStatus === filter;
  });

  const counts = {
    all: flags.length,
    pending: flags.filter((f) => f.committeeStatus === "pending").length,
    approved: flags.filter((f) => f.committeeStatus === "approved").length,
    rejected: flags.filter((f) => f.committeeStatus === "rejected").length,
  };

  const handleReview = async (flagId: string, decision: "approved" | "rejected") => {
    setSaving(flagId);
    const result = await reviewDeltaFlag(flagId, decision, notes[flagId] ?? "");
    if (result.success) {
      setExpandedId(null);
      router.refresh();
    }
    setSaving(null);
  };

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
        {(["pending", "approved", "rejected", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === f
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="ml-1.5 text-gray-400">{counts[f]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center shadow-sm">
          <p className="text-sm text-gray-500">
            {filter === "pending"
              ? "No pending flags to review. All clear!"
              : `No ${filter} flags found.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((flag) => (
            <div
              key={flag.id}
              className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
            >
              {/* Summary row */}
              <button
                onClick={() =>
                  setExpandedId(expandedId === flag.id ? null : flag.id)
                }
                className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-gray-900">
                      {flag.organizationName}
                    </span>
                    <span className="text-xs text-gray-400">&middot;</span>
                    <span className="text-sm text-gray-600">
                      {formatFieldName(flag.fieldName)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>
                      {formatValue(flag.previousValue)} → {formatValue(flag.currentValue)}
                    </span>
                    {flag.pctChange !== null && (
                      <span
                        className={`font-medium ${
                          Math.abs(flag.pctChange) > 50
                            ? "text-red-600"
                            : "text-amber-600"
                        }`}
                      >
                        {flag.pctChange > 0 ? "+" : ""}
                        {flag.pctChange.toFixed(0)}%
                      </span>
                    )}
                    {flag.respondentAction && (
                      <span className="text-gray-400">
                        Respondent: {flag.respondentAction}
                      </span>
                    )}
                  </div>
                </div>

                <span
                  className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    flag.committeeStatus === "approved"
                      ? "bg-green-100 text-green-700"
                      : flag.committeeStatus === "rejected"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {flag.committeeStatus}
                </span>

                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    expandedId === flag.id ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Expanded detail */}
              {expandedId === flag.id && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                  {/* Respondent explanation */}
                  {flag.respondentExplanation && (
                    <div className="mb-3 p-3 bg-blue-50 rounded-lg">
                      <p className="text-xs font-medium text-[#D92327] mb-1">
                        Respondent Explanation
                      </p>
                      <p className="text-sm text-blue-900">
                        {flag.respondentExplanation}
                      </p>
                    </div>
                  )}

                  {/* Existing committee notes */}
                  {flag.committeeNotes && flag.committeeStatus !== "pending" && (
                    <div className="mb-3 p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-500 mb-1">
                        Committee Notes
                      </p>
                      <p className="text-sm text-gray-700">{flag.committeeNotes}</p>
                    </div>
                  )}

                  {/* Who to ring. A flag is usually settled in a two-minute
                      call, and the person who filed the survey is listed first
                      because they are the one who knows why the number moved. */}
                  {(() => {
                    const card = contactsByOrg[flag.organizationId];
                    if (!card || card.contacts.length === 0) {
                      return (
                        <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                          Nobody on file for {flag.organizationName}. This one has to go
                          back to the office before it can be chased.
                        </div>
                      );
                    }
                    return (
                      <div className="mb-3 rounded-lg bg-gray-50 p-3">
                        <p className="mb-1 text-xs font-medium text-gray-500">
                          Who to ask at {card.organizationName}
                        </p>
                        <ul className="space-y-1">
                          {card.contacts.slice(0, 3).map((c) => (
                            <li key={c.id} className="text-sm text-gray-800">
                              <span className="font-medium">{c.name}</span>
                              {c.roleTitle && (
                                <span className="text-gray-500"> · {c.roleTitle}</span>
                              )}
                              {c.id === card.respondentContactId && (
                                <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] uppercase text-gray-700">
                                  filed this
                                </span>
                              )}
                              <span className="block text-xs">
                                {c.email && (
                                  <a href={`mailto:${c.email}`} className="text-[#163D6D] underline">
                                    {c.email}
                                  </a>
                                )}
                                {c.email && c.phone && " · "}
                                {c.phone && (
                                  <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`} className="text-[#163D6D] underline">
                                    {c.phone}
                                  </a>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}

                  {/* The explanation members will read, if the store agrees. */}
                  <div className="mb-3 rounded-lg border border-gray-200 p-3">
                    <p className="text-xs font-medium text-gray-700">
                      Explain this figure to other members
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Only published if {flag.organizationName} agrees to the wording. Write
                      it after you have spoken to them — a flag can sit here for days.
                    </p>
                    <textarea
                      value={explanations[flag.id] ?? ""}
                      onChange={(e) =>
                        setExplanations((prev) => ({ ...prev, [flag.id]: e.target.value }))
                      }
                      rows={2}
                      placeholder="e.g. Second location opened in September, so the floor space and sales both step up mid-year."
                      className="mt-2 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={sendingNote === flag.id || !(explanations[flag.id] ?? "").trim()}
                        onClick={() => sendExplanation(flag, true)}
                        className="rounded-lg bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                      >
                        Send to the lead
                      </button>
                      <button
                        type="button"
                        disabled={sendingNote === flag.id || !(explanations[flag.id] ?? "").trim()}
                        onClick={() => sendExplanation(flag, false)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-40"
                      >
                        Save a draft
                      </button>
                      {noteResult[flag.id] && (
                        <span className="text-xs text-gray-600">{noteResult[flag.id]}</span>
                      )}
                    </div>
                  </div>

                  {/* Review actions (only for pending) */}
                  {flag.committeeStatus === "pending" && (
                    <div>
                      <textarea
                        value={notes[flag.id] ?? ""}
                        onChange={(e) =>
                          setNotes((prev) => ({ ...prev, [flag.id]: e.target.value }))
                        }
                        placeholder="Committee notes (optional)..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-3 resize-none"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleReview(flag.id, "approved")}
                          disabled={saving === flag.id}
                          className="px-4 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {saving === flag.id ? "..." : "Approve"}
                        </button>
                        <button
                          onClick={() => handleReview(flag.id, "rejected")}
                          disabled={saving === flag.id}
                          className="px-4 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {saving === flag.id ? "..." : "Reject"}
                        </button>
                        <Link
                          href={`/benchmarking/admin/submissions/${flag.benchmarkingId}`}
                          className="px-4 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          View Submission
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
