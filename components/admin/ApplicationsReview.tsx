"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveApplication, rejectApplication } from "@/lib/actions/applications";
import type { Json } from "@/lib/database.types";

interface Application {
  id: string;
  status: string;
  application_type: string;
  applicant_name: string | null;
  applicant_email: string | null;
  application_data: Json;
  verified_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string | null;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending_verification: {
    label: "Pending Verification",
    className: "bg-yellow-100 text-yellow-800",
  },
  pending_review: {
    label: "Pending Review",
    className: "bg-blue-100 text-blue-800",
  },
  approved: {
    label: "Approved",
    className: "bg-green-100 text-green-800",
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-100 text-red-800",
  },
};

export function ApplicationsReview({
  initialApplications,
}: {
  initialApplications: Application[];
}) {
  const router = useRouter();
  const [applications, setApplications] = useState(initialApplications);
  const [filterType, setFilterType] = useState<"all" | "member" | "partner">("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filtered = applications.filter((app) => {
    if (filterType !== "all" && app.application_type !== filterType) return false;
    if (filterStatus !== "all" && app.status !== filterStatus) return false;
    return true;
  });

  const pendingCount = applications.filter(
    (a) => a.status === "pending_review"
  ).length;

  async function handleApprove(id: string) {
    setError(null);
    setActionLoading(id);

    const result = await approveApplication(id);

    setActionLoading(null);

    if (!result.success) {
      setError(result.error || "Failed to approve");
      return;
    }

    // Update local state
    setApplications((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "approved" } : a))
    );
    setExpandedId(null);
    router.refresh();
  }

  async function handleReject(id: string) {
    if (!rejectReason.trim()) {
      setError("Please provide a reason for rejection.");
      return;
    }

    setError(null);
    setActionLoading(id);

    const result = await rejectApplication(id, rejectReason.trim());

    setActionLoading(null);

    if (!result.success) {
      setError(result.error || "Failed to reject");
      return;
    }

    setApplications((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, status: "rejected", rejection_reason: rejectReason.trim() }
          : a
      )
    );
    setRejectingId(null);
    setRejectReason("");
    setExpandedId(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Type:</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E]"
          >
            <option value="all">All</option>
            <option value="member">Members</option>
            <option value="partner">Partners</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Status:</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/20 focus:border-[#EE2A2E]"
          >
            <option value="all">All</option>
            <option value="pending_verification">Pending Verification</option>
            <option value="pending_review">Pending Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        {pendingCount > 0 && (
          <span className="text-sm text-[#D92327] bg-blue-50 px-2.5 py-1 rounded-full font-medium">
            {pendingCount} awaiting review
          </span>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Applications list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500">
          No applications match the current filters.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Applicant
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Type
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Organization
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">
                  Date
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((app) => {
                const data = (app.application_data as Record<string, unknown>) || {};
                const orgName =
                  (data.organization_name as string) ||
                  (data.company_name as string) ||
                  "\u2014";
                const isExpanded = expandedId === app.id;
                const badge = STATUS_BADGES[app.status] || {
                  label: app.status,
                  className: "bg-gray-100 text-gray-700",
                };

                return (
                  <tr
                    key={app.id}
                    className="group"
                  >
                    <td className="px-4 py-3" colSpan={isExpanded ? 6 : 1}>
                      {isExpanded ? (
                        <ExpandedView
                          app={app}
                          orgName={orgName}
                          badge={badge}
                          actionLoading={actionLoading}
                          rejectingId={rejectingId}
                          rejectReason={rejectReason}
                          onApprove={() => handleApprove(app.id)}
                          onStartReject={() => setRejectingId(app.id)}
                          onCancelReject={() => {
                            setRejectingId(null);
                            setRejectReason("");
                          }}
                          onReject={() => handleReject(app.id)}
                          onRejectReasonChange={setRejectReason}
                          onCollapse={() => setExpandedId(null)}
                        />
                      ) : (
                        <div>
                          <p className="font-medium text-gray-900">
                            {app.applicant_name || "\u2014"}
                          </p>
                          <p className="text-xs text-gray-500">
                            {app.applicant_email}
                          </p>
                        </div>
                      )}
                    </td>
                    {!isExpanded && (
                      <>
                        <td className="px-4 py-3 capitalize text-gray-700">
                          {app.application_type}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{orgName}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {app.created_at
                            ? new Date(app.created_at).toLocaleDateString(
                                "en-CA"
                              )
                            : "\u2014"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setExpandedId(app.id)}
                            className="text-xs text-[#EE2A2E] hover:text-[#D92327] font-medium"
                          >
                            View
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------
// Expanded detail view for a single application
// -----------------------------------------------------------------

function ExpandedView({
  app,
  orgName,
  badge,
  actionLoading,
  rejectingId,
  rejectReason,
  onApprove,
  onStartReject,
  onCancelReject,
  onReject,
  onRejectReasonChange,
  onCollapse,
}: {
  app: Application;
  orgName: string;
  badge: { label: string; className: string };
  actionLoading: string | null;
  rejectingId: string | null;
  rejectReason: string;
  onApprove: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onReject: () => void;
  onRejectReasonChange: (v: string) => void;
  onCollapse: () => void;
}) {
  const data = (app.application_data as Record<string, unknown>) || {};
  const isLoading = actionLoading === app.id;
  const isRejecting = rejectingId === app.id;
  const canAct = app.status === "pending_review";

  const fields = Object.entries(data).map(([key, value]) => ({
    label: key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    value: Array.isArray(value) ? value.join(", ") : String(value ?? "\u2014"),
  }));

  return (
    <div className="py-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {app.applicant_name || "Unknown Applicant"}
          </h3>
          <p className="text-sm text-gray-500">{app.applicant_email}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="capitalize text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
              {app.application_type}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
        </div>
        <button
          onClick={onCollapse}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ✕ Close
        </button>
      </div>

      {/* Organization */}
      <div className="p-3 bg-gray-50 rounded-lg">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          Organization
        </p>
        <p className="font-medium text-gray-900">{orgName}</p>
      </div>

      {/* Application data */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {fields.map((f) => (
          <div key={f.label}>
            <p className="text-xs font-medium text-gray-500">{f.label}</p>
            <p className="text-sm text-gray-900">{f.value}</p>
          </div>
        ))}
      </div>

      {/* Timestamps */}
      <div className="flex items-center gap-6 text-xs text-gray-500">
        <span>
          Submitted:{" "}
          {app.created_at
            ? new Date(app.created_at).toLocaleString("en-CA")
            : "\u2014"}
        </span>
        {app.verified_at && (
          <span>
            Verified:{" "}
            {new Date(app.verified_at).toLocaleString("en-CA")}
          </span>
        )}
        {app.reviewed_at && (
          <span>
            Reviewed:{" "}
            {new Date(app.reviewed_at).toLocaleString("en-CA")}
          </span>
        )}
      </div>

      {/* Rejection reason if rejected */}
      {app.status === "rejected" && app.rejection_reason && (
        <div className="p-3 bg-red-50 rounded-lg border border-red-200">
          <p className="text-xs font-medium text-red-700 mb-0.5">
            Rejection Reason
          </p>
          <p className="text-sm text-red-800">{app.rejection_reason}</p>
        </div>
      )}

      {/* Actions for pending_review */}
      {canAct && (
        <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
          {isRejecting ? (
            <div className="flex-1 space-y-2">
              <textarea
                rows={2}
                value={rejectReason}
                onChange={(e) => onRejectReasonChange(e.target.value)}
                placeholder="Reason for rejection (required)..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={onReject}
                  disabled={isLoading}
                  className="px-4 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isLoading ? "Rejecting\u2026" : "Confirm Rejection"}
                </button>
                <button
                  onClick={onCancelReject}
                  className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={onApprove}
                disabled={isLoading}
                className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {isLoading ? "Approving\u2026" : "Approve"}
              </button>
              <button
                onClick={onStartReject}
                disabled={isLoading}
                className="px-5 py-2 bg-white text-red-600 text-sm font-medium rounded-lg border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                Reject
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
