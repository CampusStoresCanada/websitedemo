"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import type { HomeMapOrg } from "@/lib/homepage";
import { getPartnerOrgProfile, getMemberOrgProfile, type PartnerOrgProfile, type MemberOrgProfile } from "@/lib/actions/partner-context";
import { CertificationBadges } from "@/components/ui/CertificationBadges";

// ---------------------------------------------------------------------------
// Category colour mapping
// ---------------------------------------------------------------------------

const CATEGORY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  // NACS-aligned vendor categories
  "Apparel":                   { bg: "bg-purple-50",  text: "text-purple-700",  border: "border-purple-200"  },
  "Accessories & Furnishings": { bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-200"  },
  "Spirit & Gifts":            { bg: "bg-pink-50",    text: "text-pink-700",    border: "border-pink-200"    },
  "Sporting Goods":            { bg: "bg-sky-50",     text: "text-sky-700",     border: "border-sky-200"     },
  "Gifts & Stationery":        { bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200"    },
  "School & Office Supplies":  { bg: "bg-yellow-50",  text: "text-yellow-700",  border: "border-yellow-200"  },
  "Campus Living":             { bg: "bg-lime-50",    text: "text-lime-700",    border: "border-lime-200"    },
  "Technology & Electronics":  { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200"    },
  "Graduation & Regalia":      { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200"   },
  "Food & Beverage":           { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200"  },
  "Health & Beauty":           { bg: "bg-teal-50",    text: "text-teal-700",    border: "border-teal-200"    },
  "Campus Services":           { bg: "bg-cyan-50",    text: "text-cyan-700",    border: "border-cyan-200"    },
  "Course Materials":          { bg: "bg-green-50",   text: "text-green-700",   border: "border-green-200"   },
  "Tradebooks":                { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  // Legacy values (keep until existing partner data is migrated)
  "Technology":                { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200"    },
  "Food Services":             { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200"  },
  "Textbooks":                 { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "Gifts & Collectibles":      { bg: "bg-pink-50",    text: "text-pink-700",    border: "border-pink-200"    },
  "Health & Wellness":         { bg: "bg-teal-50",    text: "text-teal-700",    border: "border-teal-200"    },
  "School Supplies":           { bg: "bg-yellow-50",  text: "text-yellow-700",  border: "border-yellow-200"  },
  "Print & Copy Services":     { bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-200"  },
};

const DEFAULT_CATEGORY_STYLE = { bg: "bg-gray-100", text: "text-gray-600", border: "border-gray-200" };

function getCategoryStyle(category: string) {
  return CATEGORY_STYLES[category] ?? DEFAULT_CATEGORY_STYLE;
}

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatMonth(iso: string): string {
  // Accepts "YYYY-MM-DD" or "MMMM" text like "September"
  if (iso.includes("-")) {
    const parts = iso.split("-");
    const m = parseInt(parts[1] ?? "0") - 1;
    return MONTH_ABBR[m] ?? iso;
  }
  // Already a month name — abbreviate if long
  return iso.slice(0, 3);
}

function formatBuyingWindow(start: string, end: string): string {
  return `${formatMonth(start)} – ${formatMonth(end)}`;
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortKey =
  | "relevance"
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
  | "fulltimeEmployees"
  | "hasCatalogue"
  | "fitScore"
  | "buyingWindow"
  | "procurementCategories"
  | "preferredCertifications";
type SortDir = "asc" | "desc";

/** Compute how many fit signals a member org has for a given partner profile. */
function computeFitScore(org: HomeMapOrg, partner: PartnerOrgProfile | null): number {
  let score = 0;
  if (!partner) return score;
  // Category match
  if (partner.primaryCategory && org.procurementCategories.includes(partner.primaryCategory)) score++;
  // Preference alignment — any of the partner's certifications appear in the store's preferred certs
  if (
    partner.certifications.length > 0 &&
    org.preferredCertifications.some((c) => partner.certifications.includes(c))
  ) score++;
  // Has buying cycle data
  if (org.buyingWindow) score++;
  // In territory — org province matches any province in partner's sourcing areas (fallback: any data = 0)
  // Province signal: presence of province data at all (can't know partner territory without that data)
  if (org.province) score += 0; // neutral — everyone has province, not a signal
  return score;
}

/** Compute how well a partner matches a member's procurement profile. */
function computePartnerFitScore(org: HomeMapOrg, member: MemberOrgProfile | null): number {
  let score = 0;
  if (!member) return score;
  // Partner's primary category is in the member's carried categories
  if (org.primaryCategory && member.categories.includes(org.primaryCategory)) score++;
  // Partner holds a certification the member prefers
  if (
    member.preferredCertifications.length > 0 &&
    org.certifications.some((c) => member.preferredCertifications.includes(c))
  ) score++;
  return score;
}

function getSortValue(org: HomeMapOrg, key: SortKey, searchRanking?: Map<string, number>, partnerProfile?: PartnerOrgProfile | null, memberProfile?: MemberOrgProfile | null): string | number | null {
  switch (key) {
    case "relevance":
      // Higher score = smaller value so it sorts first ascending
      return -(searchRanking?.get(org.id) ?? 0);
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
    case "hasCatalogue":
      return org.catalogueUrl ? 0 : 1; // 0 = has catalogue (sorts first asc)
    case "fitScore":
      // For partner-viewing-members: negate member fit score
      // For member-viewing-partners: negate partner fit score
      if (partnerProfile !== undefined) return -(computeFitScore(org, partnerProfile ?? null));
      return -(computePartnerFitScore(org, memberProfile ?? null));
    case "buyingWindow":
      return org.buyingWindow?.rfpStart ?? org.buyingWindow?.fiscalYearStart ?? null;
    case "procurementCategories":
      return org.procurementCategories.length > 0 ? org.procurementCategories[0].toLowerCase() : null;
    case "preferredCertifications":
      return org.preferredCertifications.length > 0 ? org.preferredCertifications[0].toLowerCase() : null;
  }
}

function compareOrgs(a: HomeMapOrg, b: HomeMapOrg, key: SortKey, dir: SortDir, searchRanking?: Map<string, number>, partnerProfile?: PartnerOrgProfile | null, memberProfile?: MemberOrgProfile | null): number {
  const va = getSortValue(a, key, searchRanking, partnerProfile, memberProfile);
  const vb = getSortValue(b, key, searchRanking, partnerProfile, memberProfile);
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
  organizations: HomeMapOrg[];
  onOrgClick?: (org: HomeMapOrg) => void;
  /** When provided, table defaults to relevance sort and uses these scores */
  searchRanking?: Map<string, number>;
}

export default function DirectoryTable({
  organizations,
  onOrgClick,
  searchRanking,
}: DirectoryTableProps) {
  const { user, permissionState } = useAuth();
  const isMember = !!user && hasPermission(permissionState, "member");
  // A logged-in partner (or any non-member) viewing a member-populated list
  // should see a vendor-relevant column set rather than blurred operational data.
  const isPartnerViewing = !!user && !isMember;

  // --- Partner profile for fit scoring (partner viewing members) ---
  const [partnerProfile, setPartnerProfile] = useState<PartnerOrgProfile | null>(null);
  useEffect(() => {
    if (!isPartnerViewing) return;
    getPartnerOrgProfile().then((p) => setPartnerProfile(p));
  }, [isPartnerViewing]);

  // --- Member procurement profile for fit scoring (member viewing partners) ---
  const [memberProfile, setMemberProfile] = useState<MemberOrgProfile | null>(null);
  useEffect(() => {
    if (!isMember) return;
    getMemberOrgProfile().then((p) => setMemberProfile(p));
  }, [isMember]);

  // --- Catalogue gate modal (logged-out users) ---
  const [gatedCatalogueUrl, setGatedCatalogueUrl] = useState<string | null>(null);
  // Distinguish new visitor (no cookie) from returning user (has session cookie)
  const [isReturningVisitor, setIsReturningVisitor] = useState(false);
  useEffect(() => {
    setIsReturningVisitor(document.cookie.includes("csc_had_session=1"));
  }, []);
  const gateModalRef = useRef<HTMLDivElement>(null);
  // Close on outside click
  useEffect(() => {
    if (!gatedCatalogueUrl) return;
    const handler = (e: MouseEvent) => {
      if (gateModalRef.current && !gateModalRef.current.contains(e.target as Node)) {
        setGatedCatalogueUrl(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [gatedCatalogueUrl]);
  // Close on Escape
  useEffect(() => {
    if (!gatedCatalogueUrl) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setGatedCatalogueUrl(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [gatedCatalogueUrl]);

  // --- Table state ---
  // Partners viewing members default to fit score; members viewing partners also default to fit score
  const defaultSort: SortKey =
    isPartnerViewing || isMember ? "fitScore" : searchRanking ? "relevance" : "name";
  const [sortKey, setSortKey] = useState<SortKey>(defaultSort);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Switch to relevance sort when a search ranking arrives, back to default when cleared
  useEffect(() => {
    if (searchRanking) {
      setSortKey("relevance");
      setSortDir("asc");
      setVisibleCount(PAGE_SIZE);
    } else {
      setSortKey(isPartnerViewing || isMember ? "fitScore" : "name");
      setSortDir("asc");
      setVisibleCount(PAGE_SIZE);
    }
  }, [searchRanking, isPartnerViewing, isMember]);

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
  const showMemberCols = hasMembers && isMember;
  // Non-member (partner/public) viewing a list that contains member orgs:
  // show a vendor-relevant subset instead of blurred operational columns
  const showPartnerMemberCols = hasMembers && isPartnerViewing;
  // Member viewing a partner-only list: personalised vendor view
  const showMemberPartnerCols = hasPartners && !hasMembers && isMember;
  const showPartnerCols = hasPartners && !hasMembers && hasCategoryData;
  const showPartnerRichCols = hasPartners && !hasMembers && !isMember; // description + catalogue (public / partner self-view)
  const showTypeBadge = hasMembers && hasPartners && isMember;

  // --- Sort ---
  const sortedOrgs = useMemo(() => {
    // Pass whichever profile is relevant; getSortValue uses presence of partnerProfile arg to decide
    return [...organizations].sort((a, b) =>
      isPartnerViewing
        ? compareOrgs(a, b, sortKey, sortDir, searchRanking, partnerProfile, undefined)
        : compareOrgs(a, b, sortKey, sortDir, searchRanking, undefined, memberProfile)
    );
  }, [organizations, sortKey, sortDir, searchRanking, partnerProfile, memberProfile, isPartnerViewing]);

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
    <>
    <div className="relative">
      {/* ============================================================= */}
      {/* Nudge banner — member viewing partners with no procurement data */}
      {/* ============================================================= */}
      {showMemberPartnerCols && memberProfile !== null && !memberProfile.hasCategoryData && (
        <div className="mb-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
          <span>
            Your store&apos;s product categories aren&apos;t on file yet — partners can&apos;t be ranked by fit until they are.{" "}
            <a
              href={memberProfile.orgSlug ? `/org/${memberProfile.orgSlug}#contacts_section` : "/me"}
              className="font-medium underline underline-offset-2 hover:text-amber-900"
            >
              {memberProfile.isOrgAdmin
                ? "Go to your store profile and set up procurement →"
                : "Click your name in your store's Staffing section to set your buying categories →"}
            </a>
          </span>
        </div>
      )}

      {/* ============================================================= */}
      {/* Table                                                          */}
      {/* ============================================================= */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {renderSortHeader({ label: "Organization", sortKeyVal: "name", className: "min-w-[180px]" })}
                {/* Member viewing partners: personalised procurement view */}
                {showMemberPartnerCols ? (
                  <>
                    {renderSortHeader({ label: "Category", sortKeyVal: "primaryCategory" })}
                    {renderSortHeader({ label: "Certifications", sortKeyVal: "preferredCertifications" })}
                    {renderSortHeader({ label: "Province", sortKeyVal: "province" })}
                  </>
                ) : showPartnerRichCols ? (
                  /* Public / partner self-view: full rich partner profile */
                  <>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider min-w-[180px]">
                      Tagline
                    </th>
                    <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider min-w-[280px]">
                      About
                    </th>
                    {renderSortHeader({ label: "Catalogue", sortKeyVal: "hasCatalogue", className: "w-28" })}
                    {renderSortHeader({ label: "Category", sortKeyVal: "primaryCategory" })}
                  </>
                ) : !showPartnerMemberCols ? (
                  /* Member / mixed view (member is viewing): location + type */
                  <>
                    {renderSortHeader({ label: "City", sortKeyVal: "city" })}
                    {renderSortHeader({ label: "Province", sortKeyVal: "province" })}
                    {showTypeBadge && renderSortHeader({ label: "Type", sortKeyVal: "type" })}
                    {showTypeBadge && renderSortHeader({ label: "Org Type", sortKeyVal: "organizationType" })}
                  </>
                ) : null}
                {showMemberCols && (
                  <>
                    {renderSortHeader({ label: "Enrollment", sortKeyVal: "enrollmentFte" })}
                    {renderSortHeader({ label: "Institution Type", sortKeyVal: "institutionType" })}
                    {renderSortHeader({ label: "POS", sortKeyVal: "posSystem" })}
                    {renderSortHeader({ label: "Model", sortKeyVal: "operationsMandate" })}
                    {renderSortHeader({ label: "Services", sortKeyVal: "servicesCount" })}
                    {renderSortHeader({ label: "Locations", sortKeyVal: "numLocations" })}
                    {renderSortHeader({ label: "Staff", sortKeyVal: "fulltimeEmployees" })}
                  </>
                )}
                {showPartnerMemberCols && (
                  <>
                    {renderSortHeader({ label: "What They Carry", sortKeyVal: "procurementCategories" })}
                    {renderSortHeader({ label: "Preferences", sortKeyVal: "preferredCertifications" })}
                    {renderSortHeader({ label: "Buying Window", sortKeyVal: "buyingWindow" })}
                    {renderSortHeader({ label: "Province", sortKeyVal: "province" })}
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
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                              {org.name}
                            </p>
                            {org.sponsorTier && (
                              <span
                                className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                style={{
                                  color: org.sponsorTier.color,
                                  backgroundColor: `${org.sponsorTier.color}1a`,
                                  border: `1px solid ${org.sponsorTier.color}40`,
                                }}
                              >
                                {org.sponsorTier.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    {showMemberPartnerCols ? (
                      /* Member viewing partners: category match + certs + province */
                      <>
                        {/* Category — highlighted ring if it matches member's carried categories */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          {org.primaryCategory ? (() => {
                            const s = getCategoryStyle(org.primaryCategory);
                            const isMatch = memberProfile?.categories.includes(org.primaryCategory) ?? false;
                            return (
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.bg} ${s.text} ${isMatch ? "ring-2 ring-offset-1 ring-green-400 border-transparent" : s.border}`}>
                                {org.primaryCategory}
                              </span>
                            );
                          })() : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        {/* Partner certifications — highlighted if they match member preferences */}
                        <td className="px-3 py-3">
                          {org.certifications.length > 0 ? (
                            <CertificationBadges
                              certifications={org.certifications}
                              showCancoll={isMember}
                              highlightSet={new Set(memberProfile?.preferredCertifications ?? [])}
                              size="sm"
                            />
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        {/* Province */}
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {org.province ?? "—"}
                        </td>
                      </>
                    ) : showPartnerRichCols ? (
                      /* Public / partner self-view: full rich partner profile */
                      <>
                        {/* Tagline */}
                        <td className="px-3 py-3 max-w-[200px]">
                          {org.highlightProductName ? (
                            <p className="text-xs text-gray-700 font-medium line-clamp-2">
                              {org.highlightProductName}
                            </p>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        {/* About / description */}
                        <td className="px-3 py-3 max-w-[300px]">
                          {org.companyDescription ? (
                            <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                              {org.companyDescription}
                            </p>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        {/* Catalogue */}
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          {org.catalogueUrl ? (
                            user ? (
                              // Logged in — link goes straight through
                              <a
                                href={org.catalogueUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#D92327] transition-colors whitespace-nowrap"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                                Catalogue
                              </a>
                            ) : (
                              // Logged out — intercept and show join/login gate
                              <button
                                onClick={() => setGatedCatalogueUrl(org.catalogueUrl!)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#D92327] transition-colors whitespace-nowrap"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                                Catalogue
                              </button>
                            )
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        {/* Category — coloured pill */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          {org.primaryCategory ? (() => {
                            const s = getCategoryStyle(org.primaryCategory);
                            return (
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.bg} ${s.text} ${s.border}`}>
                                {org.primaryCategory}
                              </span>
                            );
                          })() : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </>
                    ) : !showPartnerMemberCols ? (
                      /* Member / mixed view: location + type (member is viewing) */
                      <>
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
                                  : "bg-blue-50 text-[#D92327] border border-blue-100"
                              }`}
                            >
                              {org.type === "Vendor Partner" ? "Partner" : org.type ?? "—"}
                            </span>
                          </td>
                        )}
                        {showTypeBadge && (
                          <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                            {org.organizationType ?? "—"}
                          </td>
                        )}
                      </>
                    ) : null}
                    {/* Full operational data — members only */}
                    {showMemberCols && (
                      <>
                        <td className="px-3 py-3 text-sm text-gray-900 tabular-nums whitespace-nowrap">
                          {org.enrollmentFte != null ? org.enrollmentFte.toLocaleString() : "—"}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {org.institutionType ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {org.posSystem ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {org.operationsMandate ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {org.servicesOffered && org.servicesOffered.length > 0
                            ? `${org.servicesOffered.length}`
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-900 tabular-nums whitespace-nowrap">
                          {org.numLocations ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-900 tabular-nums whitespace-nowrap">
                          {org.fulltimeEmployees ?? "—"}
                        </td>
                      </>
                    )}
                    {/* Partner-tailored member view — procurement fit columns, no blurred cells */}
                    {showPartnerMemberCols && (
                      <>
                        {/* What They Carry — highlight partner's own category */}
                        <td className="px-3 py-3 max-w-[240px]">
                          {org.procurementCategories.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {org.procurementCategories.map((cat) => {
                                const isMatch = !!partnerProfile?.primaryCategory && cat === partnerProfile.primaryCategory;
                                const s = getCategoryStyle(cat);
                                return (
                                  <span
                                    key={cat}
                                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                      isMatch
                                        ? `${s.bg} ${s.text} ${s.border} ring-1 ring-offset-1 ring-current`
                                        : `${s.bg} ${s.text} ${s.border}`
                                    }`}
                                  >
                                    {cat}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-300">—</span>
                          )}
                        </td>
                        {/* Vendor preferences — certification logos with hover tooltips */}
                        <td className="px-3 py-3">
                          {org.preferredCertifications.length > 0 ? (
                            <CertificationBadges
                              certifications={org.preferredCertifications}
                              size="sm"
                            />
                          ) : (
                            <span className="text-sm text-gray-300">—</span>
                          )}
                        </td>
                        {/* Buying window */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          {org.buyingWindow ? (
                            <div className="text-xs text-gray-700">
                              {org.buyingWindow.rfpStart && org.buyingWindow.rfpEnd ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-blue-700 font-medium">
                                  {formatBuyingWindow(org.buyingWindow.rfpStart, org.buyingWindow.rfpEnd)}
                                </span>
                              ) : org.buyingWindow.rfpStart ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-blue-700 font-medium">
                                  From {formatMonth(org.buyingWindow.rfpStart)}
                                </span>
                              ) : org.buyingWindow.fiscalYearStart ? (
                                <span className="text-gray-500">
                                  FY starts {formatMonth(org.buyingWindow.fiscalYearStart)}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-300">—</span>
                          )}
                        </td>
                        {/* Province */}
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {org.province ?? "—"}
                        </td>
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

    {/* ── Catalogue gate modal (logged-out users) ── */}
    {gatedCatalogueUrl && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <div
          ref={gateModalRef}
          className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl p-8 text-center"
        >
          {/* Close */}
          <button
            onClick={() => setGatedCatalogueUrl(null)}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Icon */}
          <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-7 h-7 text-[#EE2A2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>

          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            {isReturningVisitor ? "Welcome back" : "Members only"}
          </h2>
          <p className="text-sm text-gray-500 mb-7 leading-relaxed">
            {isReturningVisitor
              ? "Sign in to access partner catalogues and the full CSC directory."
              : "Partner catalogues are available to CSC member stores. Join to connect with vendors and access exclusive resources."}
          </p>

          <div className="flex flex-col gap-3">
            {isReturningVisitor ? (
              <>
                <a
                  href="/login"
                  className="w-full inline-flex items-center justify-center rounded-xl bg-[#1A1A1A] px-5 py-3 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
                >
                  Sign In
                </a>
                <a
                  href="/signup"
                  className="w-full inline-flex items-center justify-center rounded-xl border border-gray-200 px-5 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Join CSC
                </a>
              </>
            ) : (
              <>
                <a
                  href="/signup"
                  className="w-full inline-flex items-center justify-center rounded-xl bg-[#EE2A2E] px-5 py-3 text-sm font-medium text-white hover:bg-[#D92327] transition-colors"
                >
                  Join CSC
                </a>
                <a
                  href="/login"
                  className="w-full inline-flex items-center justify-center rounded-xl border border-gray-200 px-5 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Sign In
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
