"use client";

import { useState, useEffect } from "react";
import { parseUTC } from "@/lib/utils";
import { getAllRegistrations, type AdminRegistrationRow } from "@/lib/actions/conference-registration";
import {
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
  REGISTRATION_STATUS_LABELS,
  type RegistrationStatus,
} from "@/lib/constants/conference";

interface RegistrationsTableProps {
  conferenceId: string;
}

/**
 * Legacy registrations (`conference_registrations`), as a list.
 *
 * ⚠️ Nothing has written this table since registrations moved to seats; it had
 * 0 rows on 2026-10-26. Its exports, travel import and travel-exception review
 * were removed then: the live roster's exports are the War Room's Data tab
 * (WAR_ROOM_OPERATE_PLAN §5), and there is no travel import until a conference
 * collects travel (Stephen, 2026-10-26).
 */
export default function RegistrationsTable({ conferenceId }: RegistrationsTableProps) {
  const [registrations, setRegistrations] = useState<AdminRegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCreatedFrom, setFilterCreatedFrom] = useState("");
  const [filterCreatedTo, setFilterCreatedTo] = useState("");

  useEffect(() => {
    let live = true;
    void getAllRegistrations(conferenceId, {
      status: filterStatus || undefined,
      registration_type: filterType || undefined,
      created_at_from: filterCreatedFrom || undefined,
      created_at_to: filterCreatedTo || undefined,
    }).then((result) => {
      if (!live) return;
      setLoading(false);
      if (result.success) {
        setRegistrations(result.data ?? []);
        setError(null);
      } else {
        setError(result.error ?? "Failed to load");
      }
    });
    return () => {
      live = false;
    };
  }, [conferenceId, filterStatus, filterType, filterCreatedFrom, filterCreatedTo]);

  const getUserLabel = (reg: AdminRegistrationRow): string => {
    const profileName = reg.user_display_name?.trim();
    if (profileName) return profileName;
    const raw = reg as unknown as Record<string, unknown>;
    const displayName = typeof raw.display_name === "string" ? raw.display_name.trim() : "";
    if (displayName) return displayName;
    const contactEmail = typeof raw.contact_email === "string" ? raw.contact_email.trim() : "";
    if (contactEmail) return contactEmail;
    return reg.user_id ? `${reg.user_id.slice(0, 8)}...` : "Unknown user";
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Exports of the people attending are in the{" "}
        <a href={`/admin/conference/${conferenceId}/war-room?tab=data`} className="font-medium text-accent hover:underline">
          War Room&apos;s Data tab
        </a>
        .
      </p>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
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
        <input
          type="date"
          value={filterCreatedFrom}
          onChange={(e) => setFilterCreatedFrom(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          aria-label="Created from date"
          title="Created from"
        />
        <input
          type="date"
          value={filterCreatedTo}
          onChange={(e) => setFilterCreatedTo(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          aria-label="Created to date"
          title="Created to"
        />
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {registrations.map((reg) => (
                <tr key={reg.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">{getUserLabel(reg)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 capitalize">{reg.registration_type}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      reg.status === "confirmed" ? "bg-green-100 text-green-700" :
                      reg.status === "submitted" ? "bg-blue-100 text-accent" :
                      reg.status === "canceled" ? "bg-red-100 text-red-700" :
                      "bg-gray-100 text-gray-700"
                    }`}>
                      {REGISTRATION_STATUS_LABELS[reg.status as RegistrationStatus] ?? reg.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {parseUTC(reg.created_at).toLocaleDateString()}
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
