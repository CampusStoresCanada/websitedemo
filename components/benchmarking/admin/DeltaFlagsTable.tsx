"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { reviewDeltaFlag } from "@/lib/actions/benchmarking-admin";

interface Flag {
  id: string;
  benchmarkingId: string;
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

interface DeltaFlagsTableProps {
  flags: Flag[];
  fiscalYear: number;
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

export default function DeltaFlagsTable({ flags, fiscalYear }: DeltaFlagsTableProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

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
                      <p className="text-xs font-medium text-blue-700 mb-1">
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
