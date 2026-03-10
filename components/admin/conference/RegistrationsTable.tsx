"use client";

import { useState, useEffect } from "react";
import {
  getAllRegistrations,
  reviewTravelWindowException,
} from "@/lib/actions/conference-registration";
import {
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
  REGISTRATION_STATUS_LABELS,
  type RegistrationStatus,
} from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type RegistrationRow = Database["public"]["Tables"]["conference_registrations"]["Row"];

interface RegistrationsTableProps {
  conferenceId: string;
}

export default function RegistrationsTable({ conferenceId }: RegistrationsTableProps) {
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");

  useEffect(() => {
    loadRegistrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterType]);

  const loadRegistrations = async () => {
    setLoading(true);
    const result = await getAllRegistrations(conferenceId, {
      status: filterStatus || undefined,
      registration_type: filterType || undefined,
    });
    setLoading(false);
    if (result.success) {
      setRegistrations(result.data ?? []);
      setError(null);
    } else {
      setError(result.error ?? "Failed to load");
    }
  };

  const exportCsv = () => {
    if (registrations.length === 0) return;
    const header = [
      "id",
      "conference_id",
      "organization_id",
      "user_id",
      "registration_type",
      "status",
      "created_at",
      "updated_at",
    ];
    const lines = registrations.map((reg) =>
      [
        reg.id,
        reg.conference_id,
        reg.organization_id,
        reg.user_id,
        reg.registration_type,
        reg.status,
        reg.created_at,
        reg.updated_at,
      ]
        .map((value) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `conference-registrations-${conferenceId}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getTravelExceptionStatus = (reg: RegistrationRow): "none" | "pending" | "approved" | "rejected" => {
    const customAnswers = (reg as unknown as { registration_custom_answers?: Record<string, unknown> | null })
      .registration_custom_answers;
    if (!customAnswers || typeof customAnswers !== "object" || Array.isArray(customAnswers)) {
      return "none";
    }
    const raw = (customAnswers as Record<string, unknown>).travel_window_exception;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "none";
    const status = (raw as Record<string, unknown>).status;
    if (status === "pending" || status === "approved" || status === "rejected") {
      return status;
    }
    return "none";
  };

  const handleReviewException = async (
    registrationId: string,
    decision: "approved" | "rejected"
  ) => {
    const note = window.prompt(
      decision === "approved"
        ? "Optional approval note:"
        : "Optional rejection note:"
    ) ?? "";
    setActioningId(registrationId);
    const result = await reviewTravelWindowException(registrationId, decision, note);
    setActioningId(null);
    if (!result.success) {
      setError(result.error ?? "Failed to review travel-window exception.");
      return;
    }
    await loadRegistrations();
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All statuses</option>
          {REGISTRATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REGISTRATION_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All types</option>
          {REGISTRATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          disabled={registrations.length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading registrations...</div>
      ) : registrations.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No registrations found.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Travel Exception</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {registrations.map((reg) => (
                <tr key={reg.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono text-xs">{reg.user_id.slice(0, 8)}...</td>
                  <td className="px-4 py-3 text-sm text-gray-700 capitalize">{reg.registration_type}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      reg.status === "confirmed" ? "bg-green-100 text-green-700" :
                      reg.status === "submitted" ? "bg-blue-100 text-blue-700" :
                      reg.status === "canceled" ? "bg-red-100 text-red-700" :
                      "bg-gray-100 text-gray-700"
                    }`}>
                      {REGISTRATION_STATUS_LABELS[reg.status as RegistrationStatus] ?? reg.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {(() => {
                      const exceptionStatus = getTravelExceptionStatus(reg);
                      if (exceptionStatus === "none") {
                        return <span className="text-gray-400">None</span>;
                      }
                      if (exceptionStatus === "pending") {
                        return (
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                              Pending
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleReviewException(reg.id, "approved")}
                              disabled={actioningId === reg.id}
                              className="rounded border border-emerald-300 px-2 py-0.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleReviewException(reg.id, "rejected")}
                              disabled={actioningId === reg.id}
                              className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        );
                      }
                      if (exceptionStatus === "approved") {
                        return (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                            Approved
                          </span>
                        );
                      }
                      return (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                          Rejected
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(reg.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
