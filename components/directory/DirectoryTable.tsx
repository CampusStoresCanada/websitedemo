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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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

  // --- Infinite scroll window ---
  const effectiveVisibleCount = Math.min(visibleCount, sortedOrgs.length);
  const pageOrgs = useMemo(
    () => sortedOrgs.slice(0, effectiveVisibleCount),
    [sortedOrgs, effectiveVisibleCount]
  );
  const hasMore = pageOrgs.length < sortedOrgs.length;

  const loadMore = useCallback(() => {
    setVisibleCount((current) => Math.min(current + PAGE_SIZE, sortedOrgs.length));
  }, [sortedOrgs.length]);

  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinelEl || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      {
        root: null,
        rootMargin: "200px 0px",
        threshold: 0,
      }
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [sentinelEl, hasMore, loadMore]);

  // --- Sort toggle ---
  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
      setVisibleCount(PAGE_SIZE);
    },
    [sortKey]
  );

  // --- Column header renderer ---
  const renderSortHeader = ({
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

  // --- Blurred cell renderer for non-members ---
  const renderBlurredCell = () => (
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
                {renderSortHeader({ label: "Organization", sortKeyVal: "name", className: "min-w-[200px]" })}
                {renderSortHeader({ label: "City", sortKeyVal: "city" })}
                {renderSortHeader({ label: "Province", sortKeyVal: "province" })}
                {showTypeBadge && renderSortHeader({ label: "Type", sortKeyVal: "type" })}
                {showPartnerCols && renderSortHeader({ label: "Category", sortKeyVal: "primaryCategory" })}
                {showTypeBadge && renderSortHeader({ label: "Org Type", sortKeyVal: "organizationType" })}
                {showMemberCols && (
                  <>
                    {renderSortHeader({ label: "Enrollment", sortKeyVal: "enrollmentFte" })}
                    {renderSortHeader({ label: "Institution Type", sortKeyVal: "institutionType" })}
                    {renderSortHeader({ label: "POS", sortKeyVal: "posSystem", locked: !isMember })}
                    {renderSortHeader({ label: "Model", sortKeyVal: "operationsMandate", locked: !isMember })}
                    {renderSortHeader({ label: "Services", sortKeyVal: "servicesCount", locked: !isMember })}
                    {renderSortHeader({ label: "Locations", sortKeyVal: "numLocations", locked: !isMember })}
                    {renderSortHeader({ label: "Staff", sortKeyVal: "fulltimeEmployees", locked: !isMember })}
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
                          renderBlurredCell()
                        )}
                        {isMember ? (
                          <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                            {org.operationsMandate ?? "—"}
                          </td>
                        ) : (
                          renderBlurredCell()
                        )}
                        {isMember ? (
                          <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                            {org.servicesOffered && org.servicesOffered.length > 0
                              ? `${org.servicesOffered.length}`
                              : "—"}
                          </td>
                        ) : (
                          renderBlurredCell()
                        )}
                        {isMember ? (
                          <td className="px-3 py-3 text-sm text-gray-900 tabular-nums whitespace-nowrap">
                            {org.numLocations ?? "—"}
                          </td>
                        ) : (
                          renderBlurredCell()
                        )}
                        {isMember ? (
                          <td className="px-3 py-3 text-sm text-gray-900 tabular-nums whitespace-nowrap">
                            {org.fulltimeEmployees ?? "—"}
                          </td>
                        ) : (
                          renderBlurredCell()
                        )}
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Infinite-scroll footer */}
        {sortedOrgs.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500 text-center">
              Showing {pageOrgs.length} of {sortedOrgs.length}
            </p>
            {hasMore ? (
              <div className="mt-2 flex items-center justify-center">
                <div ref={setSentinelEl} className="h-6 w-full max-w-[240px]" />
              </div>
            ) : null}
          </div>
        )}
      </div>

    </div>
  );
}
