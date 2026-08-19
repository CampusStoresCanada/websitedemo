"use client";

import { useState, useRef, useEffect } from "react";
import type { Organization } from "@/lib/types/db";
import type { VisibleOrganization, VisibleContact } from "@/lib/visibility/data";
import type { ProcurementInfo, ProcurementVisibility, CategoryBuyer, KeyDate } from "@/lib/types/procurement";
import {
  VENDOR_CATEGORIES,
  CATEGORY_SUBCATEGORIES,
  STORE_SERVICES,
  CANADIAN_PROVINCES,
  CERTIFICATION_NAMES,
  hasProcurementInfo,
  hasBuyingCycleContent,
  normalizeKeyDates,
  buyingCycleNotes,
} from "@/lib/types/procurement";
import { CERTIFICATION_BY_NAME, CANCOLL_CERT } from "@/lib/certifications";
import { updateProcurementInfo } from "@/lib/actions/procurement";
import { useAuth } from "@/components/providers/AuthProvider";

interface EditableProcurementSectionProps {
  organization: VisibleOrganization;
  contacts: VisibleContact[];
  /** When true, opens directly into edit mode (no extra click required) */
  autoEdit?: boolean;
  /** Lifted state from parent — when provided, overrides internal state */
  externalData?: ProcurementInfo;
  onExternalSave?: (data: ProcurementInfo) => void;
}

export default function EditableProcurementSection({
  organization,
  contacts,
  autoEdit = false,
  externalData,
  onExternalSave,
}: EditableProcurementSectionProps) {
  const { organizations, permissionState } = useAuth();
  const [isEditing, setIsEditing] = useState(autoEdit);
  const [internalData, setInternalData] = useState<ProcurementInfo | undefined>(
    (organization as Organization & { procurement_info?: ProcurementInfo }).procurement_info ||
      undefined
  );

  // Use external state when provided (lifted from parent), otherwise own state
  const procurementInfo = externalData !== undefined ? externalData : internalData;
  const setProcurementInfo = (data: ProcurementInfo) => {
    setInternalData(data);
    onExternalSave?.(data);
  };

  const isOrgAdmin = organizations.some(
    (uo) => uo.organization.id === organization.id && uo.role === "org_admin"
  );
  const isGlobalAdmin = permissionState === "admin" || permissionState === "super_admin";
  const canEdit = isOrgAdmin || isGlobalAdmin;

  const hasData = hasProcurementInfo(procurementInfo);

  if (isEditing) {
    return (
      <EditMode
        organizationId={organization.id}
        initialData={procurementInfo}
        contacts={contacts}
        onSave={(newData) => {
          setProcurementInfo(newData);
          setIsEditing(false);
        }}
        onCancel={() => setIsEditing(false)}
      />
    );
  }

  return (
    <div className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-semibold text-[#1A1A1A]">Procurement Information</h2>
          {canEdit && (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-[#1A1A1A] hover:bg-gray-100 rounded-md transition-colors"
            >
              <PencilIcon />
              Edit
            </button>
          )}
        </div>

        {!hasData ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">Procurement details have not been added yet.</p>
            {canEdit && (
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#EE2A2E] text-white font-medium rounded-md hover:bg-[#D92327] transition-colors"
              >
                <PlusIcon />
                Add Procurement Info
              </button>
            )}
          </div>
        ) : (
          <ViewMode procurementInfo={procurementInfo!} contacts={contacts} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View Mode
// ---------------------------------------------------------------------------

function ViewMode({
  procurementInfo,
  contacts,
}: {
  procurementInfo: ProcurementInfo;
  contacts: VisibleContact[];
}) {
  const {
    category_buyers = [],
    preferred_certifications = [],
    sourcing_provinces = [],
    store_services = [],
    buying_cycle,
  } = procurementInfo;
  const contactById = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const keyDates = normalizeKeyDates(buying_cycle?.key_dates);
  const cycleNotes = buyingCycleNotes(buying_cycle);

  return (
    <div className="space-y-10">
      {category_buyers.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
            What We Carry & Who Buys It
          </h3>
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
            {category_buyers.map((entry) => {
              const buyers = entry.contact_ids.map((id) => contactById[id]).filter(Boolean) as VisibleContact[];
              return (
                <div key={entry.category} className="px-4 py-3 bg-white">
                  <p className="font-medium text-[#1A1A1A] text-sm mb-2">{entry.category}</p>
                  {buyers.length > 0 ? (
                    <div className="space-y-2 ml-2">
                      {buyers.map((b) => {
                        const buyerSubs = entry.contact_subcategories?.[b.id] ?? [];
                        return (
                          <div key={b.id}>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-full text-xs text-gray-700">
                              {b.name as string}
                              {b.role_title && <span className="text-gray-400">· {b.role_title as string}</span>}
                            </span>
                            {buyerSubs.length > 0 && (
                              <div className="mt-1 ml-2 flex flex-wrap gap-1">
                                {buyerSubs.map((sub) => (
                                  <span key={sub} className="px-2 py-0.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-500">{sub}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic ml-2">No buyer assigned</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {store_services.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Store Services</h3>
          <div className="flex flex-wrap gap-2">
            {store_services.map((svc) => (
              <span key={svc} className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full">{svc}</span>
            ))}
          </div>
        </div>
      )}

      {preferred_certifications.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Vendor Preferences</h3>
          <div className="flex flex-wrap gap-2">
            {preferred_certifications.map((cert) => (
              <span key={cert} className="px-3 py-1 bg-green-50 text-green-700 text-sm rounded-full border border-green-100">{cert}</span>
            ))}
          </div>
        </div>
      )}

      {sourcing_provinces.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Sourcing Preferences</h3>
          <div className="flex flex-wrap gap-2">
            {sourcing_provinces.map((prov) => (
              <span key={prov} className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-100">{prov}</span>
            ))}
          </div>
        </div>
      )}

      {hasBuyingCycleContent(buying_cycle) && buying_cycle && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Buying Cycle</h3>
          <div className="bg-gray-50 rounded-xl p-5 space-y-3">
            {buying_cycle.fiscal_year_start && (
              <div>
                <span className="text-xs uppercase text-gray-400">Fiscal Year Starts</span>
                <p className="font-medium text-[#1A1A1A]">{buying_cycle.fiscal_year_start}</p>
              </div>
            )}
            {keyDates.length > 0 && (
              <div>
                <span className="text-xs uppercase text-gray-400">Key Dates</span>
                <div className="mt-1 space-y-1">
                  {keyDates.map((kd, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="font-medium text-[#1A1A1A]">{kd.title}</span>
                      <span className="text-gray-500">{formatDate(kd.date)}</span>
                      {kd.recurring && <span className="text-xs text-gray-400 italic">annually</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {cycleNotes && (
              <div>
                <span className="text-xs uppercase text-gray-400">Notes</span>
                <p className="text-sm text-[#1A1A1A] whitespace-pre-line">{cycleNotes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ---------------------------------------------------------------------------
// Edit Mode
// ---------------------------------------------------------------------------

function EditMode({
  organizationId,
  initialData,
  contacts,
  onSave,
  onCancel,
}: {
  organizationId: string;
  initialData?: ProcurementInfo;
  contacts: VisibleContact[];
  onSave: (data: ProcurementInfo) => void;
  onCancel: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [checkedCategories, setCheckedCategories] = useState<Set<string>>(
    () => new Set((initialData?.category_buyers ?? []).map((b) => b.category))
  );
  const [buyerMap, setBuyerMap] = useState<Record<string, Set<string>>>(() => {
    const map: Record<string, Set<string>> = {};
    for (const entry of initialData?.category_buyers ?? []) {
      map[entry.category] = new Set(entry.contact_ids);
    }
    return map;
  });
  // Per-buyer subcategories: category → contact_id → subcategories
  const [buyerSubMap, setBuyerSubMap] = useState<Record<string, Record<string, Set<string>>>>(() => {
    const map: Record<string, Record<string, Set<string>>> = {};
    for (const entry of initialData?.category_buyers ?? []) {
      if (entry.contact_subcategories) {
        map[entry.category] = {};
        for (const [cid, subs] of Object.entries(entry.contact_subcategories)) {
          map[entry.category][cid] = new Set(subs);
        }
      }
    }
    return map;
  });

  const [preferredCerts, setPreferredCerts] = useState<Set<string>>(
    () => new Set(initialData?.preferred_certifications ?? [])
  );
  const [sourcingProvinces, setSourcingProvinces] = useState<Set<string>>(
    () => new Set(initialData?.sourcing_provinces ?? [])
  );
  const [storeServices, setStoreServices] = useState<Set<string>>(
    () => new Set(initialData?.store_services ?? [])
  );

  const [visibility, setVisibility] = useState<ProcurementVisibility>({
    show_categories:     initialData?.show_categories     ?? true,
    show_store_services: initialData?.show_store_services ?? true,
    show_certifications: initialData?.show_certifications ?? true,
    show_provinces:      initialData?.show_provinces      ?? true,
    show_buying_cycle:   initialData?.show_buying_cycle   ?? true,
  });

  const toggleVis = (key: keyof ProcurementVisibility) =>
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));

  const [fiscalYearStart, setFiscalYearStart] = useState(initialData?.buying_cycle?.fiscal_year_start ?? "");
  const [keyDates, setKeyDates] = useState<KeyDate[]>(
    normalizeKeyDates(initialData?.buying_cycle?.key_dates)
  );
  const [cycleNotes, setCycleNotes] = useState(buyingCycleNotes(initialData?.buying_cycle));

  // ── Category helpers ──
  const toggleCategory = (cat: string) => {
    setCheckedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
        setBuyerMap((bm) => { const nb = { ...bm }; delete nb[cat]; return nb; });
        setBuyerSubMap((bsm) => { const ns = { ...bsm }; delete ns[cat]; return ns; });
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const toggleBuyer = (cat: string, contactId: string) => {
    setBuyerMap((prev) => {
      const existing = new Set(prev[cat] ?? []);
      if (existing.has(contactId)) {
        existing.delete(contactId);
        setBuyerSubMap((bsm) => {
          const catMap = { ...(bsm[cat] ?? {}) };
          delete catMap[contactId];
          return { ...bsm, [cat]: catMap };
        });
      } else {
        existing.add(contactId);
        // Auto-select all subcategories — deselect individually to narrow
        const subs = CATEGORY_SUBCATEGORIES[cat];
        if (subs?.length) {
          setBuyerSubMap((bsm) => ({
            ...bsm,
            [cat]: { ...(bsm[cat] ?? {}), [contactId]: new Set(subs) },
          }));
        }
      }
      return { ...prev, [cat]: existing };
    });
  };

  const toggleBuyerSubcategory = (cat: string, contactId: string, sub: string) => {
    setBuyerSubMap((prev) => {
      const catMap = { ...(prev[cat] ?? {}) };
      const subs = new Set(catMap[contactId] ?? []);
      subs.has(sub) ? subs.delete(sub) : subs.add(sub);
      catMap[contactId] = subs;
      return { ...prev, [cat]: catMap };
    });
  };

  // ── Key dates helpers ──
  const addKeyDate = () => setKeyDates((prev) => [...prev, { title: "", date: "", recurring: false }]);
  const removeKeyDate = (i: number) => setKeyDates((prev) => prev.filter((_, idx) => idx !== i));
  const updateKeyDate = (i: number, patch: Partial<KeyDate>) =>
    setKeyDates((prev) => prev.map((kd, idx) => (idx === i ? { ...kd, ...patch } : kd)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const category_buyers: CategoryBuyer[] = [...checkedCategories].map((cat) => {
      const contactSubcategories = buyerSubMap[cat]
        ? Object.fromEntries(
            Object.entries(buyerSubMap[cat])
              .filter(([, subs]) => subs.size > 0)
              .map(([cid, subs]) => [cid, [...subs]])
          )
        : undefined;
      return {
        category: cat,
        contact_ids: [...(buyerMap[cat] ?? [])],
        contact_subcategories: contactSubcategories && Object.keys(contactSubcategories).length > 0
          ? contactSubcategories
          : undefined,
      };
    });

    const validKeyDates = keyDates.filter((kd) => kd.title.trim() && kd.date);
    const buying_cycle = {
      fiscal_year_start: fiscalYearStart || undefined,
      key_dates: validKeyDates.length > 0 ? validKeyDates : undefined,
      // Always written as a string — saving here is also what retires a legacy
      // free-text key_dates, since key_dates now only ever holds KeyDate[].
      key_dates_notes: cycleNotes.trim() || undefined,
    };

    const newData: ProcurementInfo = {
      category_buyers: category_buyers.length > 0 ? category_buyers : undefined,
      preferred_certifications: preferredCerts.size > 0 ? [...preferredCerts] : undefined,
      sourcing_provinces: sourcingProvinces.size > 0 ? [...sourcingProvinces] : undefined,
      store_services: storeServices.size > 0 ? [...storeServices] : undefined,
      buying_cycle: Object.values(buying_cycle).some(Boolean) ? buying_cycle : undefined,
      ...visibility,
    };

    try {
      const result = await updateProcurementInfo(organizationId, newData);
      if (result.success) {
        onSave(newData);
      } else {
        setError(result.error ?? "Failed to save");
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]";
  const checkCls = "h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer";

  return (
    <div className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-semibold text-[#1A1A1A]">Edit Procurement Information</h2>
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-10">

          {/* ── Categories + subcategories + buyers ── */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-[#1A1A1A]">What We Carry</h3>
              <VisToggle
                label="What We Carry"
                visible={visibility.show_categories ?? true}
                onToggle={() => toggleVis("show_categories")}
              />
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Check each category your store carries, then click a buyer to assign them. All subcategories are selected by default — deselect any they don't cover.
            </p>
            <div className="space-y-2">
              {VENDOR_CATEGORIES.map((cat) => {
                const checked = checkedCategories.has(cat);
                const subs = CATEGORY_SUBCATEGORIES[cat];
                return (
                  <div key={cat} className="border border-gray-200 rounded-xl overflow-hidden">
                    <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors">
                      <input type="checkbox" className={checkCls} checked={checked} onChange={() => toggleCategory(cat)} />
                      <span className="font-medium text-[#1A1A1A] text-sm">{cat}</span>
                    </label>

                    {checked && (
                      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                        <div className="flex items-center gap-2 mb-3">
                          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Buyer(s) & Their Subcategories</p>
                          <span className="text-[10px] text-gray-400 italic normal-case">
                            Hidden contacts are tracked but won't appear to partners.
                          </span>
                        </div>
                        {contacts.length > 0 ? (
                          <div className="space-y-3">
                            {contacts.map((contact) => {
                              const selected = buyerMap[cat]?.has(contact.id) ?? false;
                              const isHidden = contact.hidden ?? false;
                              return (
                                <div key={contact.id}>
                                  {/* Buyer toggle chip */}
                                  <button
                                    type="button"
                                    onClick={() => toggleBuyer(cat, contact.id)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                      selected
                                        ? "bg-[#EE2A2E] text-white"
                                        : "bg-white border border-gray-300 text-gray-600 hover:border-gray-400"
                                    }`}
                                  >
                                    {contact.name as string}
                                    {contact.role_title && (
                                      <span className={selected ? "text-white/70" : "text-gray-400"}>
                                        · {contact.role_title as string}
                                      </span>
                                    )}
                                    {isHidden && (
                                      <span
                                        title="Hidden in Staffing — tracked internally but not visible to partners"
                                        className={`ml-0.5 ${selected ? "text-white/60" : "text-amber-500"}`}
                                      >
                                        <svg className="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                                        </svg>
                                      </span>
                                    )}
                                  </button>

                                  {/* Subcategory chips for this buyer — only when selected and subs exist */}
                                  {selected && subs && subs.length > 0 && (
                                    <div className="mt-1.5 ml-3 flex flex-wrap gap-1.5">
                                      {subs.map((sub) => {
                                        const subSelected = buyerSubMap[cat]?.[contact.id]?.has(sub) ?? false;
                                        return (
                                          <button
                                            key={sub}
                                            type="button"
                                            onClick={() => toggleBuyerSubcategory(cat, contact.id, sub)}
                                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                                              subSelected
                                                ? "bg-[#EE2A2E] text-white"
                                                : "bg-white border border-gray-200 text-gray-500 hover:border-gray-400"
                                            }`}
                                          >
                                            {sub}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 italic">No contacts available — add staff first.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Store services ── */}
          <div className="border-t border-gray-200 pt-8">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-[#1A1A1A]">Store Services</h3>
              <VisToggle
                label="Store Services"
                visible={visibility.show_store_services ?? true}
                onToggle={() => toggleVis("show_store_services")}
              />
            </div>
            <p className="text-xs text-gray-500 mb-4">Select the ancillary services your store offers.</p>
            <div className="flex flex-wrap gap-2">
              {STORE_SERVICES.map((svc) => {
                const selected = storeServices.has(svc);
                return (
                  <button
                    key={svc}
                    type="button"
                    onClick={() => setStoreServices((prev) => {
                      const next = new Set(prev);
                      next.has(svc) ? next.delete(svc) : next.add(svc);
                      return next;
                    })}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      selected ? "bg-[#EE2A2E] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {svc}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Vendor certification preferences — badge images ── */}
          <div className="border-t border-gray-200 pt-8">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-[#1A1A1A]">Vendor Preferences</h3>
              <VisToggle
                label="Vendor Preferences"
                visible={visibility.show_certifications ?? true}
                onToggle={() => toggleVis("show_certifications")}
              />
            </div>
            <p className="text-xs text-gray-500 mb-4">Select certifications your store prioritizes when choosing vendors.</p>
            <div className="flex flex-wrap gap-3">
              {CERTIFICATION_NAMES.map((cert) => {
                const config = CERTIFICATION_BY_NAME[cert];
                if (!config) return null;
                const selected = preferredCerts.has(cert);
                return (
                  <CertToggleBadge
                    key={cert}
                    name={config.name}
                    filename={config.filename ?? `${config.slug}.svg`}
                    description={config.description}
                    selected={selected}
                    onToggle={() => setPreferredCerts((prev) => {
                      const next = new Set(prev);
                      next.has(cert) ? next.delete(cert) : next.add(cert);
                      return next;
                    })}
                  />
                );
              })}
            </div>
          </div>

          {/* ── Sourcing province preferences ── */}
          <div className="border-t border-gray-200 pt-8">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-[#1A1A1A]">Sourcing Preferences</h3>
              <VisToggle
                label="Sourcing Preferences"
                visible={visibility.show_provinces ?? true}
                onToggle={() => toggleVis("show_provinces")}
              />
            </div>
            <p className="text-xs text-gray-500 mb-4">Select provinces or territories your store prefers or is required to source from.</p>
            <div className="flex flex-wrap gap-2">
              {CANADIAN_PROVINCES.map((prov) => {
                const selected = sourcingProvinces.has(prov);
                return (
                  <button
                    key={prov}
                    type="button"
                    onClick={() => setSourcingProvinces((prev) => {
                      const next = new Set(prev);
                      next.has(prov) ? next.delete(prov) : next.add(prov);
                      return next;
                    })}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      selected ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {prov}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Buying cycle ── */}
          <div className="border-t border-gray-200 pt-8">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-sm font-semibold text-[#1A1A1A]">Buying Cycle</h3>
              <VisToggle
                label="Buying Cycle"
                visible={visibility.show_buying_cycle ?? true}
                onToggle={() => toggleVis("show_buying_cycle")}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-1 gap-6 max-w-xs mb-8">
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-2">Fiscal Year Start</label>
                <select value={fiscalYearStart} onChange={(e) => setFiscalYearStart(e.target.value)} className={inputCls}>
                  <option value="">Select month</option>
                  {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* Key dates */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-[#1A1A1A]">Key Dates</label>
                <button
                  type="button"
                  onClick={addKeyDate}
                  className="inline-flex items-center gap-1.5 text-xs text-[#EE2A2E] hover:text-[#D92327] font-medium"
                >
                  <PlusIcon />
                  Add date
                </button>
              </div>

              {keyDates.length === 0 && !cycleNotes && (
                <p className="text-xs text-gray-400 italic">No key dates added yet.</p>
              )}

              <div className="space-y-3">
                {keyDates.map((kd, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                    <input
                      type="text"
                      value={kd.title}
                      onChange={(e) => updateKeyDate(i, { title: e.target.value })}
                      placeholder="e.g., Textbook adoption deadline"
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
                    />
                    <input
                      type="date"
                      value={kd.date}
                      onChange={(e) => updateKeyDate(i, { date: e.target.value })}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        className={checkCls}
                        checked={kd.recurring ?? false}
                        onChange={(e) => updateKeyDate(i, { recurring: e.target.checked })}
                      />
                      Recurring
                    </label>
                    <button
                      type="button"
                      onClick={() => removeKeyDate(i)}
                      className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <XIcon />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-[#1A1A1A] mb-2">
                  Notes
                  <span className="ml-2 font-normal text-xs text-gray-400">
                    Anything that doesn&apos;t fit a single date — lead times, RFP windows
                  </span>
                </label>
                <textarea
                  value={cycleNotes}
                  onChange={(e) => setCycleNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g., Textbook orders need 10 weeks lead time."
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* ── Actions ── */}
          <div className="border-t border-gray-200 pt-6 flex items-center justify-between">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3 ml-auto">
              <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2 bg-[#EE2A2E] text-white font-medium rounded-md hover:bg-[#D92327] disabled:opacity-50 transition-colors"
              >
                {isSubmitting ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Certification badge toggle — same image + tooltip as CertificationBadges,
// but clickable with a selected state (green ring + checkmark overlay).
// ---------------------------------------------------------------------------

const TOOLTIP_WIDTH = 220;

function CertToggleBadge({
  name,
  filename,
  description,
  selected,
  onToggle,
}: {
  name: string;
  filename: string;
  description: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const showTooltip = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
    if (left < margin) left = margin;
    if (left + TOOLTIP_WIDTH > window.innerWidth - margin) left = window.innerWidth - margin - TOOLTIP_WIDTH;
    setPos({ top: rect.top - 8, left });
  };

  useEffect(() => () => setPos(null), []);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setPos(null)}
      onFocus={showTooltip}
      onBlur={() => setPos(null)}
      className="relative flex-shrink-0 focus:outline-none"
      aria-pressed={selected}
    >
      <div className={`relative rounded-full transition-all ${selected ? "ring-2 ring-green-500 ring-offset-2" : "opacity-50 hover:opacity-80"}`}>
        <img
          src={`/certifications/${filename}`}
          alt={name}
          width={40}
          height={40}
          className="rounded-full object-contain select-none"
          style={{ width: 40, height: 40 }}
          draggable={false}
        />
        {selected && (
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center shadow">
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      {pos && (
        <div className="fixed z-[9999] pointer-events-none" style={{ top: pos.top, left: pos.left, width: TOOLTIP_WIDTH }}>
          <div className="translate-y-[-100%]">
            <div className="bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 text-center shadow-xl">
              <p className="font-semibold whitespace-nowrap">{name}</p>
              <p className="text-gray-300 mt-0.5 leading-snug">{description}</p>
            </div>
            <div className="flex justify-center">
              <div className="w-2 h-2 bg-gray-900 rotate-45 -mt-1" />
            </div>
          </div>
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Visibility toggle — matches the eye-icon pattern used for PII on the page
// ---------------------------------------------------------------------------

function VisToggle({
  label,
  visible,
  onToggle,
}: {
  label: string;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={visible ? `${label} visible to partners — click to hide` : `${label} hidden from partners — click to show`}
      className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${
        visible
          ? "border-emerald-300 text-emerald-600 hover:bg-emerald-50"
          : "border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100"
      }`}
    >
      {visible ? (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
        </svg>
      )}
      {visible ? "Visible" : "Hidden"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

function PencilIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
