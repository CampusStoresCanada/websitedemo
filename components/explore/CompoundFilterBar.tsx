"use client";

import type { ExploreLens, ScaleRange } from "@/lib/explore/types";
import { SCALE_RANGES } from "@/lib/explore/types";

interface CompoundFilterBarProps {
  compoundFilters: Record<string, string | undefined>;
  setCompoundFilters: React.Dispatch<React.SetStateAction<Record<string, string | undefined>>>;
  showFilterMenu: boolean;
  setShowFilterMenu: React.Dispatch<React.SetStateAction<boolean>>;
  uniqueProvinces: [string, number][];
  posCounts: Record<string, number>;
  serviceCounts: Record<string, number>;
  mandateCounts: Record<string, number>;
  lens: ExploreLens;
  setLens: React.Dispatch<React.SetStateAction<ExploreLens>>;
  scaleFilter: ScaleRange | null;
  setScaleFilter: React.Dispatch<React.SetStateAction<ScaleRange | null>>;
  posFilter: string | null;
  setPosFilter: React.Dispatch<React.SetStateAction<string | null>>;
  serviceFilter: string | null;
  setServiceFilter: React.Dispatch<React.SetStateAction<string | null>>;
  mandateFilter: string | null;
  setMandateFilter: React.Dispatch<React.SetStateAction<string | null>>;
  isMember: boolean;
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
  lens,
  setLens,
  scaleFilter,
  setScaleFilter,
  posFilter,
  setPosFilter,
  serviceFilter,
  setServiceFilter,
  mandateFilter,
  setMandateFilter,
  isMember,
}: CompoundFilterBarProps) {
  // Build primary pills from lens + sub-filter
  const primaryPills: { label: string; onRemove: () => void }[] = [];

  const LENS_PILL: Record<string, string> = {
    members: "Members",
    partners: "Partners",
    scale: "By Scale",
    pos_platform: "POS Platform",
    services: "Services",
    operating_model: "Operating Model",
  };

  if (lens) {
    primaryPills.push({
      label: LENS_PILL[lens] ?? lens,
      onRemove: () => {
        setLens(null);
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
      case "pos": return `POS: ${value}`;
      case "service": return `Service: ${value}`;
      case "mandate": return `Model: ${value}`;
      case "scaleRange": {
        const r = SCALE_RANGES.find((s) => s.key === value);
        return `Scale: ${r?.label ?? value}`;
      }
      case "payment": return `Payment: ${value}`;
      case "shopping": return `Shopping: ${value}`;
      default: return `${key}: ${value}`;
    }
  };

  const removeCompound = (key: string) => {
    setCompoundFilters((f) => { const next = { ...f }; delete next[key]; return next; });
  };

  const totalActive = primaryPills.length + compoundPills.length;

  const pillCls = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium";
  const xBtn = "hover:bg-white/20 rounded-full p-0.5 transition-colors";
  const xIcon = (
    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

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
              setLens(null); setScaleFilter(null); setPosFilter(null);
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
          {/* Province — always available */}
          <div className="p-2.5 border-b border-gray-100">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Province</label>
            <select
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:bg-white focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
              value={compoundFilters.province ?? ""}
              onChange={(e) => setCompoundFilters((f) => ({ ...f, province: e.target.value || undefined }))}
            >
              <option value="">All provinces</option>
              {uniqueProvinces.map(([prov, count]) => (
                <option key={prov} value={prov}>{prov} ({count})</option>
              ))}
            </select>
          </div>

          {/* POS */}
          <div className="p-2.5 border-b border-gray-100">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
              POS Platform {!isMember && <span className="text-gray-400">{"\uD83D\uDD12"}</span>}
            </label>
            {isMember ? (
              <select
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:bg-white focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
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
              Service {!isMember && <span className="text-gray-400">{"\uD83D\uDD12"}</span>}
            </label>
            {isMember ? (
              <select
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:bg-white focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
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
              Operating Model {!isMember && <span className="text-gray-400">{"\uD83D\uDD12"}</span>}
            </label>
            {isMember ? (
              <select
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:bg-white focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
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
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:bg-white focus:border-[#EE2A2E] focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]"
              value={lens === "scale" ? (scaleFilter ?? "") : (compoundFilters.scaleRange ?? "")}
              onChange={(e) => {
                const v = e.target.value || null;
                if (lens === "scale") {
                  setScaleFilter(v as ScaleRange | null);
                } else {
                  setCompoundFilters((f) => ({ ...f, scaleRange: (v as string) || undefined }));
                }
              }}
            >
              <option value="">All sizes</option>
              {SCALE_RANGES.map((r) => (
                <option key={r.key} value={r.key}>{r.label} — {r.description}</option>
              ))}
            </select>
          </div>

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
