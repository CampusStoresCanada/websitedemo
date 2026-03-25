"use client";

import { useState, useEffect } from "react";
import { parseUTC } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface JobRun {
  id: string;
  job_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  orgs_processed: number;
  orgs_succeeded: number;
  orgs_failed: number;
  error_details: string | null;
}

interface RenewalEvent {
  id: string;
  organization_id: string;
  renewal_year: number;
  event_type: string;
  created_at: string;
  org_name?: string;
}

interface RenewalOverviewProps {
  /** Counts of orgs by renewal-relevant statuses */
  statusCounts: {
    pendingRenewal: number;
    inGrace: number;
    locked: number;
    recentlyOptedOut: number;
  };
  /** Latest job runs by type */
  latestJobRuns: JobRun[];
  /** Recent charge failure events */
  recentChargeFailures: RenewalEvent[];
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string | null): string {
  if (!ts) return "\u2014";
  return parseUTC(ts).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function jobStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          Completed
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          Running
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
          Failed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
          {status}
        </span>
      );
  }
}

const JOB_TYPE_LABELS: Record<string, string> = {
  renewal_reminder: "Renewal Reminders",
  renewal_charge: "Renewal Charges",
  grace_state_transition: "Grace Transitions",
};

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function RenewalOverview({
  statusCounts,
  latestJobRuns,
  recentChargeFailures,
}: RenewalOverviewProps) {
  const [showFailures, setShowFailures] = useState(false);

  return (
    <div className="space-y-5">
      {/* ── Summary Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Pending Renewal"
          value={statusCounts.pendingRenewal}
          color="blue"
        />
        <SummaryCard
          label="In Grace"
          value={statusCounts.inGrace}
          color={statusCounts.inGrace > 0 ? "yellow" : "green"}
        />
        <SummaryCard
          label="Locked"
          value={statusCounts.locked}
          color={statusCounts.locked > 0 ? "red" : "green"}
        />
        <SummaryCard
          label="Opted Out (30d)"
          value={statusCounts.recentlyOptedOut}
          color="gray"
        />
      </div>

      {/* ── Job Run History ────────────────────────────────────── */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">
          Latest Job Runs
        </h4>
        {latestJobRuns.length === 0 ? (
          <p className="text-sm text-gray-500">No job runs recorded yet.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2 font-medium text-gray-700">
                    Job
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">
                    Status
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-700">
                    Started
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700">
                    Processed
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700">
                    Failed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {latestJobRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-900">
                      {JOB_TYPE_LABELS[run.job_type] ?? run.job_type}
                    </td>
                    <td className="px-3 py-2">
                      {jobStatusBadge(run.status)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {formatTimestamp(run.started_at)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {run.orgs_processed}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={
                          run.orgs_failed > 0
                            ? "text-red-600 font-medium"
                            : "text-gray-500"
                        }
                      >
                        {run.orgs_failed}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Recent Charge Failures ─────────────────────────────── */}
      {recentChargeFailures.length > 0 && (
        <div>
          <button
            onClick={() => setShowFailures((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-red-700 hover:text-red-800"
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-xs font-bold text-red-700">
              {recentChargeFailures.length}
            </span>
            Recent Charge Failures
            <svg
              className={`w-4 h-4 transition-transform ${
                showFailures ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {showFailures && (
            <div className="mt-2 border border-red-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-red-50 border-b border-red-200">
                    <th className="text-left px-3 py-2 font-medium text-red-800">
                      Organization
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-red-800">
                      Year
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-red-800">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100">
                  {recentChargeFailures.map((evt) => (
                    <tr key={evt.id}>
                      <td className="px-3 py-2 text-gray-900">
                        {evt.org_name ?? evt.organization_id}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {evt.renewal_year}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {formatTimestamp(evt.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "yellow" | "red" | "green" | "gray";
}) {
  const colorMap = {
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    yellow: "bg-yellow-50 border-yellow-200 text-yellow-900",
    red: "bg-red-50 border-red-200 text-red-900",
    green: "bg-green-50 border-green-200 text-green-900",
    gray: "bg-gray-50 border-gray-200 text-gray-900",
  };

  return (
    <div className={`rounded-lg border p-3 ${colorMap[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium opacity-70 mt-0.5">{label}</p>
    </div>
  );
}
