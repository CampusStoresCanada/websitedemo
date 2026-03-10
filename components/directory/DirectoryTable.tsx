"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import type { HomeMapOrg } from "@/lib/homepage";

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortKey =
  | "name"
  | "city"
  | "province"
  | "enrollmentFte"
  | "type"
  | "organizationType"
  | "institutionType"
  | "primaryCategory"
  | "posSystem"
  | "operationsMandate"
  | "servicesCount"
  | "numLocations"
  | "fulltimeEmployees";
type SortDir = "asc" | "desc";

function getSortValue(org: HomeMapOrg, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return org.name.toLowerCase();
    case "city":
      return org.city?.toLowerCase() ?? null;
    case "province":
      return org.province?.toLowerCase() ?? null;
    case "enrollmentFte":
      return org.enrollmentFte ?? null;
    case "type":
      return org.type?.toLowerCase() ?? null;
    case "organizationType":
      return org.organizationType?.toLowerCase() ?? null;
    case "institutionType":
      return org.institutionType?.toLowerCase() ?? null;
    case "primaryCategory":
      return org.primaryCategory?.toLowerCase() ?? null;
    case "posSystem":
      return org.posSystem?.toLowerCase() ?? null;
    case "operationsMandate":
      return org.operationsMandate?.toLowerCase() ?? null;
    case "servicesCount":
      return org.servicesOffered?.length ?? 0;
    case "numLocations":
      return org.numLocations ?? null;
    case "fulltimeEmployees":
      return org.fulltimeEmployees ?? null;
  }
}

function compareOrgs(a: HomeMapOrg, b: HomeMapOrg, key: SortKey, dir: SortDir): number {
  const va = getSortValue(a, key);
  const vb = getSortValue(b, key);
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const cmp = va < vb ? -1 : va > vb ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Component — pure data grid, receives already-filtered orgs
// ---------------------------------------------------------------------------

interface DirectoryTableProps {
  /** Already-filtered organizations from the parent */
  organizations: HomeMapOrg[];
  /** Called when user clicks a row — parent handles detail panel */
  onOrgClick?: (org: HomeMapOrg) => void;
}

export default function DirectoryTable({
  organizations,
  onOrgClick,
}: DirectoryTableProps) {
  const { user, permissionState } = useAuth();
  const isMember = !!user && hasPermission(permissionState, "member");

  // --- Table state ---
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  // --- Detect composition ---
  const hasMembers = useMemo(
    () => organizations.some((o) => o.type === "Member"),
    [organizations]
  );
  const hasPartners = useMemo(
    () => organizations.some((o) => o.type !== "Member"),
    [organizations]
  );
  const hasCategoryData = useMemo(
    () => organizations.some((o) => !!o.primaryCategory),
    [organizations]
  );
  const showMemberCols = hasMembers;
  const showPartnerCols = hasPartners && !hasMembers && hasCategoryData;
  const showTypeBadge = hasMembers && hasPartners;

  // --- Sort ---
  const sortedOrgs = useMemo(() => {
    return [...organizations].sort((a, b) => compareOrgs(a, b, sortKey, sortDir));
  }, [organizations, sortKey, sortDir]);

  // --- Pagination ---
  const totalPages = Math.max(1, Math.ceil(sortedOrgs.length / PAGE_SIZE));
  const pageOrgs = useMemo(
    () => sortedOrgs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [sortedOrgs, page]
  );

  // Reset page when orgs change (i.e. parent filters changed)
  useEffect(() => {
    setPage(0);
  }, [organizations]);

  // --- Sort toggle ---
  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  // --- Column header component ---
  const SortHeader = ({
    label,
    sortKeyVal,
    locked,
    className,
  }: {
    label: string;
    sortKeyVal: SortKey;
    locked?: boolean;
    className?: string;
  }) => (
    <th
      className={`px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-gray-900 transition-colors select-none ${className ?? ""}`}
      onClick={() => !locked && toggleSort(sortKeyVal)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {locked && (
          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        )}
        {!locked && sortKey === sortKeyVal && (
          <svg
            className={`w-3 h-3 transition-transform ${sortDir === "desc" ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        )}
      </span>
    </th>
  );

  // --- Blurred cell for non-members ---
  const BlurredCell = () => (
    <td className="px-3 py-3">
      <span className="inline-block rounded bg-gray-200 w-16 h-4 blur-[3px]" />
    </td>
  );

  return (
    <div className="relative">
      {/* ============================================================= */}
      {/* Table                                                          */}
      {/* ============================================================= */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <SortHeader label="Organization" sortKeyVal="name" className="min-w-[200px]" />
                <SortHeader label="City" sortKeyVal="city" />
                <SortHeader label="Province" sortKeyVal="province" />
                {showTypeBadge && <SortHeader label="Type" sortKeyVal="type" />}
                {showPartnerCols && <SortHeader label="Category" sortKeyVal="primaryCategory" />}
                {showTypeBadge && <SortHeader label="Org Type" sortKeyVal="organizationType" />}
                {showMemberCols && (
                  <>
                    <SortHeader label="Enrollment" sortKeyVal="enrollmentFte" />
                    <SortHeader label="Institution Type" sortKeyVal="institutionType" />
                    <SortHeader label="POS" sortKeyVal="posSystem" locked={!isMember} />
                    <SortHeader label="Model" sortKeyVal="operationsMandate" locked={!isMember} />
                    <SortHeader label="Services" sortKeyVal="servicesCount" locked={!isMember} />
                    <SortHeader label="Locations" sortKeyVal="numLocations" locked={!isMember} />
                    <SortHeader label="Staff" sortKeyVal="fulltimeEmployees" locked={!isMember} />
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageOrgs.length === 0 ? (
                <tr>
                  <td colSpan={20} className="px-6 py-12 text-center text-sm text-gray-500">
                    No organizations match your current filters.
                  </td>
                </tr>
              ) : (
                pageOrgs.map((org) => (
                  <tr
                    key={org.id}
                    onClick={() => onOrgClick?.(org)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    {/* Name with logo */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        {org.logoUrl ? (
                          <img
                            src={org.logoUrl}
                            alt=""
                            className="w-8 h-8 rounded-lg object-contain bg-gray-50 border border-gray-100 flex-shrink-0"
                          />
                        ) : (
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              org.type === "Member" ? "bg-red-50" : "bg-blue-50"
                            }`}
                          >
                            <span
                              className={`text-[10px] font-bold ${
                                org.type === "Member" ? "text-red-400" : "text-blue-400"
                              }`}
                            >
                              {org.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                            {org.name}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {org.city ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {org.province ?? "—"}
                    </td>
                    {showTypeBadge && (
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            org.type === "Member"
                              ? "bg-red-50 text-red-700 border border-red-100"
                              : "bg-blue-50 text-blue-700 border border-blue-100"
                          }`}
                        >
                          {org.type === "Vendor Partner" ? "Partner" : org.type ?? "—"}
                        </span>
                      </td>
                    )}
                    {showPartnerCols && (
                      <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {org.primaryCategory ?? "—"}
                      </td>
                    )}
                    {showTypeBadge && (
                      <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {org.organizationType ?? "—"}
                      </td>
                    )}
                    {showMemberCols && (
                      <>
                        <td className="px-3 py-3 text-sm text-gray-900 tabular-nums whitespace-nowrap">
                          {org.enrollmentFte != null
                            ? org.enrollmentFte.toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {org.institutionType ?? "—"}
                        </td>
                        {isMember ? (
                          <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                            {org.posSystem ?? "—"}
                          </td>
                        ) : (
                          <BlurredCell />
                        )}
                        {isMember ? (
                          <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                            {org.operationsMandate ?? "—"}
                          </td>
                        ) : (
                          <BlurredCell />
                        )}
                        {isMember ? (
                          <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                            {org.servicesOffered && org.servicesOffered.length > 0
                              ? `${org.servicesOffered.length}`
                              : "—"}
                          </td>
                        ) : (
                          <BlurredCell />
                        )}
                        {isMember ? (
                          <td className="px-3 py-3 text-sm text-gray-900 tabular-nums whitespace-nowrap">
                            {org.numLocations ?? "—"}
                          </td>
                        ) : (
                          <BlurredCell />
                        )}
                        {isMember ? (
                          <td className="px-3 py-3 text-sm text-gray-900 tabular-nums whitespace-nowrap">
                            {org.fulltimeEmployees ?? "—"}
                          </td>
                        ) : (
                          <BlurredCell />
                        )}
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedOrgs.length)} of{" "}
              {sortedOrgs.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i)
                .filter(
                  (i) =>
                    i === 0 ||
                    i === totalPages - 1 ||
                    Math.abs(i - page) <= 1
                )
                .map((i, idx, arr) => {
                  const prev = arr[idx - 1];
                  const gap = prev != null && i - prev > 1;
                  return (
                    <span key={i} className="inline-flex items-center gap-0.5">
                      {gap && <span className="px-1 text-gray-400 text-xs">…</span>}
                      <button
                        type="button"
                        onClick={() => setPage(i)}
                        className={[
                          "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                          i === page
                            ? "bg-[#D60001] text-white"
                            : "border border-gray-300 text-gray-700 hover:bg-white",
                        ].join(" ")}
                      >
                        {i + 1}
                      </button>
                    </span>
                  );
                })}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
