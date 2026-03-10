"use client";

import { useState } from "react";
import type { Contact } from "@/lib/database.types";
import type { ProcurementInfo, ProductCategory } from "@/lib/types/procurement";
import { PRODUCT_CATEGORIES } from "@/lib/types/procurement";
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

  // Form state
  const [productCategories, setProductCategories] = useState<ProductCategory[]>(
    initialData?.product_categories || []
  );
  const [buyLocal, setBuyLocal] = useState(initialData?.requirements?.buy_local ?? false);
  const [buyLocalNotes, setBuyLocalNotes] = useState(initialData?.requirements?.buy_local_notes || "");
  const [indigenousOwned, setIndigenousOwned] = useState(initialData?.requirements?.indigenous_owned ?? false);
  const [indigenousOwnedNotes, setIndigenousOwnedNotes] = useState(initialData?.requirements?.indigenous_owned_notes || "");
  const [sustainabilityCerts, setSustainabilityCerts] = useState<string[]>(
    initialData?.requirements?.sustainability_certs || []
  );
  const [newCert, setNewCert] = useState("");
  const [otherRequirements, setOtherRequirements] = useState(initialData?.requirements?.other_requirements || "");
  const [fiscalYearStart, setFiscalYearStart] = useState(initialData?.buying_cycle?.fiscal_year_start || "");
  const [rfpWindow, setRfpWindow] = useState(initialData?.buying_cycle?.rfp_window || "");
  const [keyDates, setKeyDates] = useState(initialData?.buying_cycle?.key_dates || "");
  const [buyerContactId, setBuyerContactId] = useState(initialData?.buyer_contact_id || "");

  const toggleCategory = (category: ProductCategory) => {
    setProductCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const addCert = () => {
    if (newCert.trim() && !sustainabilityCerts.includes(newCert.trim())) {
      setSustainabilityCerts([...sustainabilityCerts, newCert.trim()]);
      setNewCert("");
    }
  };

  const removeCert = (cert: string) => {
    setSustainabilityCerts(sustainabilityCerts.filter((c) => c !== cert));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const procurementInfo: ProcurementInfo = {
      product_categories: productCategories.length > 0 ? productCategories : undefined,
      requirements: {
        buy_local: buyLocal || undefined,
        buy_local_notes: buyLocalNotes || undefined,
        indigenous_owned: indigenousOwned || undefined,
        indigenous_owned_notes: indigenousOwnedNotes || undefined,
        sustainability_certs: sustainabilityCerts.length > 0 ? sustainabilityCerts : undefined,
        other_requirements: otherRequirements || undefined,
      },
      buying_cycle: {
        fiscal_year_start: fiscalYearStart || undefined,
        rfp_window: rfpWindow || undefined,
        key_dates: keyDates || undefined,
      },
      buyer_contact_id: buyerContactId || undefined,
    };

    // Clean up empty objects
    if (Object.values(procurementInfo.requirements || {}).every((v) => v === undefined)) {
      delete procurementInfo.requirements;
    }
    if (Object.values(procurementInfo.buying_cycle || {}).every((v) => v === undefined)) {
      delete procurementInfo.buying_cycle;
    }

    try {
      const result = await updateProcurementInfo(organizationId, procurementInfo);

      if (result.success) {
        setMessage({ type: "success", text: "Procurement information saved successfully!" });
      } else {
        setMessage({ type: "error", text: result.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "An unexpected error occurred" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Product Categories */}
      <div>
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-3">
          Product Categories
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Select the categories of products your store carries.
        </p>
        <div className="flex flex-wrap gap-2">
          {PRODUCT_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => toggleCategory(category)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                productCategories.includes(category)
                  ? "bg-[#D60001] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Procurement Requirements */}
      <div className="border-t border-gray-200 pt-8">
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-4">
          Procurement Requirements
        </h3>

        {/* Buy Local */}
        <div className="mb-6">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={buyLocal}
              onChange={(e) => setBuyLocal(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-[#D60001] focus:ring-[#D60001]"
            />
            <div>
              <span className="font-medium text-[#1A1A1A]">Buy Local Policy</span>
              <p className="text-xs text-gray-500 mt-0.5">
                Your organization has preferences for local vendors
              </p>
            </div>
          </label>
          {buyLocal && (
            <div className="mt-3 ml-7">
              <input
                type="text"
                value={buyLocalNotes}
                onChange={(e) => setBuyLocalNotes(e.target.value)}
                placeholder="e.g., 30% local sourcing required for apparel"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D60001] focus:border-transparent"
              />
            </div>
          )}
        </div>

        {/* Indigenous-Owned */}
        <div className="mb-6">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={indigenousOwned}
              onChange={(e) => setIndigenousOwned(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-[#D60001] focus:ring-[#D60001]"
            />
            <div>
              <span className="font-medium text-[#1A1A1A]">Indigenous-Owned Vendor Preference</span>
              <p className="text-xs text-gray-500 mt-0.5">
                Priority given to indigenous-owned suppliers
              </p>
            </div>
          </label>
          {indigenousOwned && (
            <div className="mt-3 ml-7">
              <input
                type="text"
                value={indigenousOwnedNotes}
                onChange={(e) => setIndigenousOwnedNotes(e.target.value)}
                placeholder="e.g., Indigenous suppliers given priority for promotional items"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D60001] focus:border-transparent"
              />
            </div>
          )}
        </div>

        {/* Sustainability Certifications */}
        <div className="mb-6">
          <label className="block font-medium text-[#1A1A1A] mb-2">
            Sustainability Certifications
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Add certifications you require or prefer from vendors (e.g., Fair Trade, B Corp, FSC)
          </p>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newCert}
              onChange={(e) => setNewCert(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCert();
                }
              }}
              placeholder="Enter certification name"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D60001] focus:border-transparent"
            />
            <button
              type="button"
              onClick={addCert}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              Add
            </button>
          </div>
          {sustainabilityCerts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sustainabilityCerts.map((cert) => (
                <span
                  key={cert}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-green-50 text-green-700 text-sm rounded-full"
                >
                  {cert}
                  <button
                    type="button"
                    onClick={() => removeCert(cert)}
                    className="hover:text-green-900"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Other Requirements */}
        <div>
          <label className="block font-medium text-[#1A1A1A] mb-2">
            Other Requirements
          </label>
          <textarea
            value={otherRequirements}
            onChange={(e) => setOtherRequirements(e.target.value)}
            placeholder="e.g., All vendors must carry $2M liability insurance"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D60001] focus:border-transparent"
          />
        </div>
      </div>

      {/* Buying Cycle */}
      <div className="border-t border-gray-200 pt-8">
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-4">
          Buying Cycle
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block font-medium text-[#1A1A1A] mb-2">
              Fiscal Year Start
            </label>
            <select
              value={fiscalYearStart}
              onChange={(e) => setFiscalYearStart(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D60001] focus:border-transparent"
            >
              <option value="">Select month</option>
              {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((month) => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-[#1A1A1A] mb-2">
              RFP Window
            </label>
            <input
              type="text"
              value={rfpWindow}
              onChange={(e) => setRfpWindow(e.target.value)}
              placeholder="e.g., January - March"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D60001] focus:border-transparent"
            />
          </div>
        </div>

        <div className="mt-6">
          <label className="block font-medium text-[#1A1A1A] mb-2">
            Key Dates
          </label>
          <textarea
            value={keyDates}
            onChange={(e) => setKeyDates(e.target.value)}
            placeholder="e.g., Textbook adoption deadline: June 15. Apparel RFP opens: February 1."
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D60001] focus:border-transparent"
          />
        </div>
      </div>

      {/* Buyer Contact */}
      <div className="border-t border-gray-200 pt-8">
        <h3 className="text-sm font-semibold text-[#1A1A1A] mb-4">
          Buyer Contact
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Select the primary contact for procurement inquiries.
        </p>

        {contacts.length > 0 ? (
          <select
            value={buyerContactId}
            onChange={(e) => setBuyerContactId(e.target.value)}
            className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D60001] focus:border-transparent"
          >
            <option value="">Select a contact</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name} {contact.role_title ? `(${contact.role_title})` : ""}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-gray-400 italic">
            No contacts available. Add contacts to your organization first.
          </p>
        )}
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
          className="px-6 py-2 bg-[#D60001] text-white font-medium rounded-md hover:bg-[#B00001] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
