"use client";

import React from "react";
import type { ExploreLens, ScaleRange, CompoundFilters } from "@/lib/explore/types";
import { SCALE_RANGES } from "@/lib/explore/types";
import { CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";

interface CompoundFilterBarProps {
  compoundFilters: CompoundFilters;
  setCompoundFilters: React.Dispatch<React.SetStateAction<CompoundFilters>>;
  showFilterMenu: boolean;
  setShowFilterMenu: React.Dispatch<React.SetStateAction<boolean>>;
  uniqueProvinces: [string, number][];
  posCounts: Record<string, number>;
  serviceCounts: Record<string, number>;
  mandateCounts: Record<string, number>;
  partnerCategoryCounts?: Record<string, number>;
  certificationCounts?: Record<string, number>;
  /** How many partners in the current cohort hold a booth — drives the Exhibiting filter row. */
  exhibitingCount?: number;
  canViewCancoll?: boolean;
  checkedCategories?: Set<string>;
  setCheckedCategories?: React.Dispatch<React.SetStateAction<Set<string>>>;
  checkedSubcategories?: Set<string>;
  setCheckedSubcategories?: React.Dispatch<React.SetStateAction<Set<string>>>;
  partnerSubcategoryCounts?: Record<string, Record<string, number>>;
  lens: ExploreLens;
  setLens: React.Dispatch<React.SetStateAction<ExploreLens>>;
  defaultLens?: ExploreLens;
  scaleFilter: ScaleRange | null;
  setScaleFilter: React.Dispatch<React.SetStateAction<ScaleRange | null>>;
  posFilter: string | null;
  setPosFilter: React.Dispatch<React.SetStateAction<string | null>>;
  serviceFilter: string | null;
  setServiceFilter: React.Dispatch<React.SetStateAction<string | null>>;
  mandateFilter: string | null;
  setMandateFilter: React.Dispatch<React.SetStateAction<string | null>>;
  isMember: boolean;
  focus?: "all" | "members" | "partners";
}

/** Lens bar — shows active lenses + refinement pills */
export function CompoundFilterBar({
  compoundFilters,
  setCompoundFilters,
  showFilterMenu,
  setShowFilterMenu,
  uniqueProvinces,
  posCounts,
  serviceCounts,
  mandateCounts,
  partnerCategoryCounts,
  certificationCounts,
  exhibitingCount = 0,
  canViewCancoll = false,
  checkedCategories,
  setCheckedCategories,
  checkedSubcategories,
  setCheckedSubcategories,
  partnerSubcategoryCounts,
  lens,
  setLens,
  defaultLens,
  scaleFilter,
  setScaleFilter,
  posFilter,
  setPosFilter,
  serviceFilter,
  setServiceFilter,
  mandateFilter,
  setMandateFilter,
  isMember,
  focus,
}: CompoundFilterBarProps) {
  const isPartnerFocus = focus === "partners";

  // Build primary pills from lens + sub-filter
  const primaryPills: { label: string; onRemove: () => void }[] = [];

  const LENS_PILL: Record<string, string> = {
    members: "Members",
    partners: "Partners",
    partner_category: "By Category",
    scale: "By Scale",
    pos_platform: "POS Platform",
    services: "Services",
    operating_model: "Operating Model",
  };

  // Only show the lens pill on pages where the user chose it — not on focused
  // pages (/partners, /members) where the lens is forced by initialState.
  if (lens && lens !== defaultLens) {
    primaryPills.push({
      label: LENS_PILL[lens] ?? lens,
      onRemove: () => {
        setLens(defaultLens ?? null);
        setScaleFilter(null);
        setPosFilter(null);
        setServiceFilter(null);
        setMandateFilter(null);
        setCompoundFilters({});
      },
    });
  }

  // Sub-filter pill
  if (lens === "scale" && scaleFilter) {
    const r = SCALE_RANGES.find((s) => s.key === scaleFilter);
    primaryPills.push({ label: `Scale: ${r?.label ?? scaleFilter}`, onRemove: () => setScaleFilter(null) });
  } else if (lens === "pos_platform" && posFilter) {
    primaryPills.push({ label: `POS: ${posFilter}`, onRemove: () => setPosFilter(null) });
  } else if (lens === "services" && serviceFilter) {
    primaryPills.push({ label: `Service: ${serviceFilter}`, onRemove: () => setServiceFilter(null) });
  } else if (lens === "operating_model" && mandateFilter) {
    primaryPills.push({ label: `Model: ${mandateFilter}`, onRemove: () => setMandateFilter(null) });
  }

  // Compound filter pills
  const compoundPills = Object.entries(compoundFilters).filter(([, v]) => v != null);

  const compoundLabelFor = (key: string, value: string) => {
    switch (key) {
      case "province": return `Province: ${value}`;
      case "category": return `Category: ${value}`;
      case "pos": return `POS: ${value}`;
      case "service": return `Service: ${value}`;
      case "mandate": return `Model: ${value}`;
      case "scaleRange": {
        const r = SCALE_RANGES.find((s) => s.key === value);
        return `Scale: ${r?.label ?? value}`;
      }
      case "payment": return `Payment: ${value}`;
      case "shopping": return `Shopping: ${value}`;
      case "certification": return `Certification: ${value}`;
      case "cancoll": return "CANCOLL Members";
      case "exhibiting": return "Exhibiting";
      default: return `${key}: ${value}`;
    }
  };

  const removeCompound = (key: string) => {
    setCompoundFilters((f) => { const next = { ...f }; delete next[key as keyof typeof next]; return next; });
  };

  const totalActive = primaryPills.length + compoundPills.length;

  // Fire once when a filter is first applied — used by onboarding callout
  const hasActiveCompound = compoundPills.length > 0 || (checkedCategories?.size ?? 0) > 0 || (checkedSubcategories?.size ?? 0) > 0;
  const filterFiredRef = React.useRef(false);
  if (hasActiveCompound && !filterFiredRef.current && typeof window !== "undefined") {
    filterFiredRef.current = true;
    window.dispatchEvent(new CustomEvent("csc:filter-applied"));
  }
  if (!hasActiveCompound) filterFiredRef.current = false; // reset when cleared

  const pillCls = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium";
  const xBtn = "hover:bg-white/20 rounded-full p-0.5 transition-colors";
  const xIcon = (
    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

  const selectCls = "w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:bg-white focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]";

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {/* Primary lens + sub-filter pills (red) */}
        {primaryPills.map((pill) => (
          <span key={pill.label} className={`${pillCls} bg-[#EE2A2E] text-white`}>
            {pill.label}
            <button type="button" onClick={pill.onRemove} className={xBtn}>{xIcon}</button>
          </span>
        ))}

        {/* Compound filter pills (dark) */}
        {compoundPills.map(([key, value]) => (
          <span key={key} className={`${pillCls} bg-gray-900 text-white`}>
            {compoundLabelFor(key, value!)}
            <button type="button" onClick={() => removeCompound(key)} className={xBtn}>{xIcon}</button>
          </span>
        ))}

        {/* Add refinement button */}
        <button
          type="button"
          data-onboarding="refine-button"
          onClick={() => setShowFilterMenu(!showFilterMenu)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Refine
        </button>

        {totalActive > 1 && (
          <button
            type="button"
            onClick={() => {
              setLens(defaultLens ?? null); setScaleFilter(null); setPosFilter(null);
              setServiceFilter(null); setMandateFilter(null); setCompoundFilters({});
            }}
            className="text-[10px] text-gray-400 hover:text-gray-600 px-1"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Refinement menu dropdown */}
      {showFilterMenu && (
        <div className="relative z-10 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          {isPartnerFocus ? (
            /* Partner focus: Category first, then Province */
            <>
              {partnerCategoryCounts && Object.keys(partnerCategoryCounts).length > 0 && checkedCategories && setCheckedCategories && (
                <div className="p-2.5 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Category</label>
                    {checkedCategories.size > 0 && (
                      <button
                        type="button"
                        onClick={() => { setCheckedCategories(new Set()); setCheckedSubcategories?.(new Set()); }}
                        className="text-[10px] text-[#EE2A2E] hover:text-[#D92327]"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="space-y-0.5 max-h-52 overflow-y-auto">
                    {Object.entries(partnerCategoryCounts)
                      .sort(([, a], [, b]) => b - a)
                      .map(([cat, count]) => {
                        const isChecked = checkedCategories.has(cat);
                        const subsForCat = partnerSubcategoryCounts?.[cat] ?? {};
                        const hasSubs = Object.keys(subsForCat).length > 0;
                        return (
                          <div key={cat}>
                            <label className="flex items-center gap-2 py-1 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setCheckedCategories((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(cat)) {
                                      next.delete(cat);
                                      const catSubs = CATEGORY_SUBCATEGORIES[cat] ?? [];
                                      setCheckedSubcategories?.((prevSubs) => {
                                        const ns = new Set(prevSubs);
                                        for (const s of catSubs) ns.delete(s);
                                        return ns;
                                      });
                                    } else {
                                      next.add(cat);
                                    }
                                    return next;
                                  });
                                }}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer flex-shrink-0"
                              />
                              <span className={`flex-1 text-xs transition-colors ${isChecked ? "text-[#1A1A1A] font-medium" : "text-gray-600"}`}>{cat}</span>
                              <span className="text-[10px] text-gray-400 tabular-nums">{count}</span>
                            </label>
                            {isChecked && hasSubs && setCheckedSubcategories && checkedSubcategories && (
                              <div className="ml-5 space-y-0.5 mb-1">
                                {Object.entries(subsForCat)
                                  .sort(([, a], [, b]) => b - a)
                                  .map(([sub, subCount]) => {
                                    const subChecked = checkedSubcategories.has(sub);
                                    return (
                                      <label key={sub} className="flex items-center gap-2 py-0.5 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={subChecked}
                                          onChange={() => {
                                            setCheckedSubcategories((prev) => {
                                              const next = new Set(prev);
                                              next.has(sub) ? next.delete(sub) : next.add(sub);
                                              return next;
                                            });
                                          }}
                                          className="h-3 w-3 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer flex-shrink-0"
                                        />
                                        <span className={`flex-1 text-[11px] ${subChecked ? "text-[#1A1A1A] font-medium" : "text-gray-500"}`}>{sub}</span>
                                        <span className="text-[10px] text-gray-400">{subCount}</span>
                                      </label>
                                    );
                                  })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
              <div className="p-2.5 border-b border-gray-100">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Province / Region</label>
                <select
                  className={selectCls}
                  value={compoundFilters.province ?? ""}
                  onChange={(e) => setCompoundFilters((f) => ({ ...f, province: e.target.value || undefined }))}
                >
                  <option value="">All regions</option>
                  {uniqueProvinces.map(([prov, count]) => (
                    <option key={prov} value={prov}>{prov} ({count})</option>
                  ))}
                  <option value="__international__">Outside Canada</option>
                </select>
              </div>
              {certificationCounts && Object.keys(certificationCounts).length > 0 && (
                <div className="p-2.5 border-b border-gray-100">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Certification</label>
                  <div className="space-y-0.5">
                    {Object.entries(certificationCounts)
                      .filter(([cert]) => cert !== "CANCOLL" || canViewCancoll)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([cert, count]) => (
                        <label key={cert} className="flex items-center gap-2 py-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={compoundFilters.certification === cert}
                            onChange={(e) => setCompoundFilters((f) => ({ ...f, certification: e.target.checked ? cert : undefined }))}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer flex-shrink-0"
                          />
                          <span className="flex-1 text-xs text-gray-600">{cert}</span>
                          <span className="text-[10px] text-gray-400 tabular-nums">{count}</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}
              {/* Exhibiting — derived from booth ownership, not a stored field,
                  so it sits apart from the Certification list above. */}
              {exhibitingCount > 0 && (
                <div className="p-2.5 border-b border-gray-100">
                  <label className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={compoundFilters.exhibiting === "true"}
                      onChange={(e) =>
                        setCompoundFilters((f) => ({ ...f, exhibiting: e.target.checked ? "true" : undefined }))
                      }
                      className="h-3.5 w-3.5 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer flex-shrink-0"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/certifications/exhibitor-2027.svg" alt="" className="h-4 w-4 rounded-full flex-shrink-0" />
                    <span className="flex-1 text-xs text-gray-600">Exhibiting at the conference</span>
                    <span className="text-[10px] text-gray-400 tabular-nums">{exhibitingCount}</span>
                  </label>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Province — always available for member focus */}
              <div className="p-2.5 border-b border-gray-100">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Province</label>
                <select
                  className={selectCls}
                  value={compoundFilters.province ?? ""}
                  onChange={(e) => setCompoundFilters((f) => ({ ...f, province: e.target.value || undefined }))}
                >
                  <option value="">All provinces</option>
                  {uniqueProvinces.map(([prov, count]) => (
                    <option key={prov} value={prov}>{prov} ({count})</option>
                  ))}
                </select>
              </div>
              {canViewCancoll && (
                <div className="p-2.5 border-b border-gray-100">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
                      checked={compoundFilters.cancoll === "true"}
                      onChange={(e) =>
                        setCompoundFilters((f) => ({ ...f, cancoll: e.target.checked ? "true" : undefined }))
                      }
                    />
                    <span className="text-xs text-gray-700">CANCOLL members only</span>
                  </label>
                </div>
              )}
            </>
          )}

          {!isPartnerFocus ? (
            <>
              {/* POS */}
              <div className="p-2.5 border-b border-gray-100">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                  POS Platform {!isMember && <span className="text-gray-400">&#x1F512;</span>}
                </label>
                {isMember ? (
                  <select
                    className={selectCls}
                    value={lens === "pos_platform" ? (posFilter ?? "") : (compoundFilters.pos ?? "")}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      if (lens === "pos_platform") {
                        setPosFilter(v);
                      } else {
                        setCompoundFilters((f) => ({ ...f, pos: v || undefined }));
                      }
                    }}
                  >
                    <option value="">All platforms</option>
                    {Object.entries(posCounts).sort(([, a], [, b]) => b - a).map(([sys, count]) => (
                      <option key={sys} value={sys}>{sys} ({count})</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[10px] text-gray-400 italic">Sign in as member to view POS data</p>
                )}
              </div>

              {/* Services */}
              <div className="p-2.5 border-b border-gray-100">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                  Service {!isMember && <span className="text-gray-400">&#x1F512;</span>}
                </label>
                {isMember ? (
                  <select
                    className={selectCls}
                    value={lens === "services" ? (serviceFilter ?? "") : (compoundFilters.service ?? "")}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      if (lens === "services") {
                        setServiceFilter(v);
                      } else {
                        setCompoundFilters((f) => ({ ...f, service: v || undefined }));
                      }
                    }}
                  >
                    <option value="">All services</option>
                    {Object.entries(serviceCounts).sort(([, a], [, b]) => b - a).map(([svc, count]) => (
                      <option key={svc} value={svc}>{svc} ({count})</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[10px] text-gray-400 italic">Sign in as member to view service data</p>
                )}
              </div>

              {/* Operating Model */}
              <div className="p-2.5 border-b border-gray-100">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                  Operating Model {!isMember && <span className="text-gray-400">&#x1F512;</span>}
                </label>
                {isMember ? (
                  <select
                    className={selectCls}
                    value={lens === "operating_model" ? (mandateFilter ?? "") : (compoundFilters.mandate ?? "")}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      if (lens === "operating_model") {
                        setMandateFilter(v);
                      } else {
                        setCompoundFilters((f) => ({ ...f, mandate: v || undefined }));
                      }
                    }}
                  >
                    <option value="">All models</option>
                    {Object.entries(mandateCounts).sort(([, a], [, b]) => b - a).map(([m, count]) => (
                      <option key={m} value={m}>{m} ({count})</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[10px] text-gray-400 italic">Sign in as member to view model data</p>
                )}
              </div>

              {/* Scale */}
              <div className="p-2.5 border-b border-gray-100">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Enrollment Scale</label>
                <select
                  className={selectCls}
                  value={lens === "scale" ? (scaleFilter ?? "") : (compoundFilters.scaleRange ?? "")}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    if (lens === "scale") {
                      setScaleFilter(v as ScaleRange | null);
                    } else {
                      setCompoundFilters((f) => ({ ...f, scaleRange: (v as ScaleRange) || undefined }));
                    }
                  }}
                >
                  <option value="">All sizes</option>
                  {SCALE_RANGES.map((r) => (
                    <option key={r.key} value={r.key}>{r.label} — {r.description}</option>
                  ))}
                </select>
              </div>
            </> ) : null}

          <div className="px-2.5 py-2 bg-gray-50 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setShowFilterMenu(false)}
              className="w-full text-[10px] font-medium text-gray-600 hover:text-gray-900 py-1"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
