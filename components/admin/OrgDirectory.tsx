"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { parseUTC } from "@/lib/utils";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  city: string | null;
  province: string | null;
  country: string;
  membership_status: string | null;
  membership_expires_at: string | null;
  fte: number | null;
  payment_status: string | null;
  created_at: string;
  onboarding_completed_at: string | null;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-100 text-green-800" },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-800" },
  applied: { label: "Applied", className: "bg-yellow-100 text-yellow-800" },
  grace: { label: "Grace Period", className: "bg-orange-100 text-orange-800" },
  locked: { label: "Locked", className: "bg-red-100 text-red-800" },
  reactivated: { label: "Reactivated", className: "bg-teal-100 text-teal-800" },
  canceled: { label: "Canceled", className: "bg-gray-100 text-gray-600" },
};

const TYPE_LABELS: Record<string, string> = {
  member: "Member",
  partner: "Partner",
  vendor: "Vendor",
};

export default function OrgDirectory({
  initialOrgs,
}: {
  initialOrgs: OrgRow[];
}) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortField, setSortField] = useState<"name" | "membership_status" | "created_at">("name");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    let list = initialOrgs;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.slug.toLowerCase().includes(q) ||
          o.city?.toLowerCase().includes(q) ||
          o.province?.toLowerCase().includes(q)
      );
    }
    if (filterType !== "all") {
      list = list.filter((o) => o.type === filterType);
    }
    if (filterStatus !== "all") {
      list = list.filter((o) => o.membership_status === filterStatus);
    }
    list = [...list].sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return list;
  }, [initialOrgs, search, filterType, filterStatus, sortField, sortAsc]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of initialOrgs) {
      const s = o.membership_status ?? "unknown";
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [initialOrgs]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of initialOrgs) {
      counts[o.type] = (counts[o.type] ?? 0) + 1;
    }
    return counts;
  }, [initialOrgs]);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  const sortArrow = (field: typeof sortField) =>
    sortField === field ? (sortAsc ? " \u2191" : " \u2193") : "";

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-2xl font-bold text-gray-900">{initialOrgs.length}</p>
          <p className="text-xs text-gray-500">Total Orgs</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-2xl font-bold text-green-700">{statusCounts["active"] ?? 0}</p>
          <p className="text-xs text-gray-500">Active</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-2xl font-bold text-orange-600">
            {(statusCounts["grace"] ?? 0) + (statusCounts["locked"] ?? 0)}
          </p>
          <p className="text-xs text-gray-500">Grace / Locked</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-2xl font-bold text-blue-700">{statusCounts["approved"] ?? 0}</p>
          <p className="text-xs text-gray-500">Approved (Onboarding)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search name, city, province..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="all">All Types ({initialOrgs.length})</option>
          {Object.entries(typeCounts).map(([type, count]) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type] ?? type} ({count})
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="all">All Statuses</option>
          {Object.entries(statusCounts).map(([status, count]) => (
            <option key={status} value={status}>
              {STATUS_BADGES[status]?.label ?? status} ({count})
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500 ml-auto">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th
                className="px-4 py-2.5 text-left font-medium text-gray-600 cursor-pointer select-none"
                onClick={() => toggleSort("name")}
              >
                Organization{sortArrow("name")}
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Type</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Location</th>
              <th
                className="px-4 py-2.5 text-left font-medium text-gray-600 cursor-pointer select-none"
                onClick={() => toggleSort("membership_status")}
              >
                Status{sortArrow("membership_status")}
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">FTE</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Expires</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Payment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((org) => {
              const badge = STATUS_BADGES[org.membership_status ?? ""] ?? {
                label: org.membership_status ?? "—",
                className: "bg-gray-100 text-gray-600",
              };
              return (
                <tr key={org.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/org/${org.slug}/admin`}
                      className="font-medium text-gray-900 hover:text-[#EE2A2E]"
                    >
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {TYPE_LABELS[org.type] ?? org.type}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {[org.city, org.province].filter(Boolean).join(", ") || org.country}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">
                    {org.fte != null ? org.fte.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">
                    {org.membership_expires_at
                      ? parseUTC(org.membership_expires_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {org.payment_status ?? "—"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No organizations match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
