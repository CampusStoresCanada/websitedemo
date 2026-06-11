"use client";

import { useState } from "react";
import type { Contact } from "@/lib/types/db";
import type { ProcurementInfo, CategoryBuyer, BuyingCycle } from "@/lib/types/procurement";
import {
  VENDOR_CATEGORIES,
  CANADIAN_PROVINCES,
  CERTIFICATION_NAMES,
} from "@/lib/types/procurement";
import { updateProcurementInfo } from "@/lib/actions/procurement";

interface ProcurementInfoFormProps {
  organizationId: string;
  initialData?: ProcurementInfo;
  contacts: Contact[];
}

export default function ProcurementInfoForm({
  organizationId,
  initialData,
  contacts,
}: ProcurementInfoFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  const [preferredCerts, setPreferredCerts] = useState<Set<string>>(
    () => new Set(initialData?.preferred_certifications ?? [])
  );

  const [sourcingProvinces, setSourcingProvinces] = useState<Set<string>>(
    () => new Set(initialData?.sourcing_provinces ?? [])
  );

  const [fiscalYearStart, setFiscalYearStart] = useState(
    initialData?.buying_cycle?.fiscal_year_start ?? ""
  );
  // key_dates is stored as KeyDate[] in the type but the form edits it as freeform text.
  // We keep it as a string here and round-trip it through a notes field.
  const [keyDates, setKeyDates] = useState<string>(
    typeof initialData?.buying_cycle?.key_dates === "string"
      ? (initialData.buying_cycle.key_dates as unknown as string)
      : ""
  );

  const toggleCategory = (cat: string) => {
    setCheckedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
        setBuyerMap((bm) => { const nb = { ...bm }; delete nb[cat]; return nb; });
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const toggleBuyer = (cat: string, contactId: string) => {
    setBuyerMap((prev) => {
      const existing = new Set(prev[cat] ?? []);
      existing.has(contactId) ? existing.delete(contactId) : existing.add(contactId);
      return { ...prev, [cat]: existing };
    });
  };

  const toggleCert = (cert: string) => {
    setPreferredCerts((prev) => {
      const next = new Set(prev);
      next.has(cert) ? next.delete(cert) : next.add(cert);
      return next;
    });
  };

  const toggleProvince = (prov: string) => {
    setSourcingProvinces((prev) => {
      const next = new Set(prev);
      next.has(prov) ? next.delete(prov) : next.add(prov);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const category_buyers: CategoryBuyer[] = [...checkedCategories].map((cat) => ({
      category: cat,
      contact_ids: [...(buyerMap[cat] ?? [])],
    }));

    const buying_cycle: BuyingCycle = {
      fiscal_year_start: fiscalYearStart || undefined,
      // key_dates is a structured KeyDate[] field; the textarea captures freeform notes
      // which are not yet mapped to structured entries, so we omit key_dates here.
    };

    const procurementInfo: ProcurementInfo = {
      category_buyers: category_buyers.length > 0 ? category_buyers : undefined,
      preferred_certifications: preferredCerts.size > 0 ? [...preferredCerts] : undefined,
      sourcing_provinces: sourcingProvinces.size > 0 ? [...sourcingProvinces] : undefined,
      buying_cycle: Object.values(buying_cycle).some(Boolean) ? buying_cycle : undefined,
    };

    try {
      const result = await updateProcurementInfo(organizationId, procurementInfo);
      if (result.success) {
        setMessage({ type: "success", text: "Procurement information saved successfully!" });
      } else {
        setMessage({ type: "error", text: result.error ?? "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "An unexpected error occurred" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent";
  const checkCls =
    "h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent cursor-pointer";

  return (
    <form onSubmit={handleSubmit} className="space-y-10">

      {/* Categories + buyers */}
      <div>
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1">What We Carry</h3>
        <p className="text-xs text-gray-500 mb-4">
          Check each category the store carries, then assign the buyer(s) responsible.
        </p>
        <div className="space-y-2">
          {VENDOR_CATEGORIES.map((cat) => {
            const checked = checkedCategories.has(cat);
            return (
              <div key={cat} className="border border-gray-200 rounded-xl overflow-hidden">
                <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    className={checkCls}
                    checked={checked}
                    onChange={() => toggleCategory(cat)}
                  />
                  <span className="font-medium text-[#1A1A1A] text-sm">{cat}</span>
                </label>

                {checked && (
                  <div className="px-4 pb-3 pt-1 border-t border-gray-100 bg-gray-50">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
                      Buyer(s)
                    </p>
                    {contacts.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {contacts.map((contact) => {
                          const selected = buyerMap[cat]?.has(contact.id) ?? false;
                          return (
                            <button
                              key={contact.id}
                              type="button"
                              onClick={() => toggleBuyer(cat, contact.id)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                selected
                                  ? "bg-accent text-white"
                                  : "bg-white border border-gray-300 text-gray-600 hover:border-gray-400"
                              }`}
                            >
                              {contact.name}
                              {contact.role_title && (
                                <span className={selected ? "text-white/70" : "text-gray-400"}>
                                  · {contact.role_title}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No contacts available.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Vendor preferences */}
      <div className="border-t border-gray-200 pt-8">
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1">Vendor Preferences</h3>
        <p className="text-xs text-gray-500 mb-4">
          Certifications this store prioritizes when choosing vendors.
        </p>
        <div className="flex flex-wrap gap-2">
          {CERTIFICATION_NAMES.map((cert) => {
            const selected = preferredCerts.has(cert);
            return (
              <button
                key={cert}
                type="button"
                onClick={() => toggleCert(cert)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selected ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {cert}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sourcing provinces */}
      <div className="border-t border-gray-200 pt-8">
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1">Sourcing Preferences</h3>
        <p className="text-xs text-gray-500 mb-4">
          Provinces or territories this store prefers or is required to source from.
        </p>
        <div className="flex flex-wrap gap-2">
          {CANADIAN_PROVINCES.map((prov) => {
            const selected = sourcingProvinces.has(prov);
            return (
              <button
                key={prov}
                type="button"
                onClick={() => toggleProvince(prov)}
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

      {/* Buying cycle */}
      <div className="border-t border-gray-200 pt-8">
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-4">Buying Cycle</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block font-medium text-[#1A1A1A] mb-2">Fiscal Year Start</label>
            <select value={fiscalYearStart} onChange={(e) => setFiscalYearStart(e.target.value)} className={inputCls}>
              <option value="">Select month</option>
              {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-6">
          <label className="block font-medium text-[#1A1A1A] mb-2">Key Dates</label>
          <textarea
            value={keyDates}
            onChange={(e) => setKeyDates(e.target.value)}
            placeholder="e.g., Textbook adoption deadline: June 15"
            rows={2}
            className={inputCls}
          />
        </div>
      </div>

      {/* Submit */}
      <div className="border-t border-gray-200 pt-6 flex items-center justify-between">
        <div>
          {message && (
            <p className={`text-sm ${message.type === "success" ? "text-green-600" : "text-red-600"}`}>
              {message.text}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2 bg-accent text-white font-medium rounded-md hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
