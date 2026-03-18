"use client";

import { useState } from "react";
import Link from "next/link";

interface Submission {
  id: string;
  organizationName: string;
  organizationSlug: string;
  status: string;
  submittedAt: string | null;
  updatedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  flagCount: number;
}

type Filter = "all" | "draft" | "submitted" | "verified";

interface SubmissionsTableProps {
  submissions: Submission[];
  fiscalYear: number;
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  draft: { label: "In Progress", color: "bg-amber-100 text-amber-700" },
  submitted: { label: "Submitted", color: "bg-green-100 text-green-700" },
};

export default function SubmissionsTable({ submissions, fiscalYear }: SubmissionsTableProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBy, setSortBy] = useState<"name" | "status" | "date" | "flags">("name");

  const filtered = submissions.filter((s) => {
    if (filter === "all") return true;
    if (filter === "verified") return s.verifiedBy !== null;
    return s.status === filter;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.organizationName.localeCompare(b.organizationName);
      case "status":
        return a.status.localeCompare(b.status);
      case "date":
        return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      case "flags":
        return b.flagCount - a.flagCount;
      default:
        return 0;
    }
  });

  const counts = {
    all: submissions.length,
    draft: submissions.filter((s) => s.status === "draft").length,
    submitted: submissions.filter((s) => s.status === "submitted").length,
    verified: submissions.filter((s) => s.verifiedBy !== null).length,
  };

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
        {(["all", "draft", "submitted", "verified"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === f
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {f === "all" ? "All" : f === "draft" ? "Drafts" : f === "submitted" ? "Submitted" : "Verified"}
            <span className="ml-1.5 text-gray-400">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {[
                { key: "name", label: "Organization" },
                { key: "status", label: "Status" },
                { key: "date", label: "Last Updated" },
                { key: "flags", label: "Flags" },
              ].map((col) => (
                <th
                  key={col.key}
                  onClick={() => setSortBy(col.key as typeof sortBy)}
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                >
                  {col.label}
                  {sortBy === col.key && (
                    <span className="ml-1 text-[#EE2A2E]">&#9662;</span>
                  )}
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  No submissions found.
                </td>
              </tr>
            ) : (
              sorted.map((s) => {
                const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.draft;
                return (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {s.organizationName}
                        </span>
                        {s.verifiedBy && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-[#D92327]">
                            Verified
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {s.updatedAt
                        ? new Date(s.updatedAt).toLocaleDateString("en-CA", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {s.flagCount > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          {s.flagCount}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/benchmarking/admin/submissions/${s.id}`}
                        className="text-xs text-[#EE2A2E] hover:underline font-medium"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
