"use client";

import { useState } from "react";
import type { Organization } from "@/lib/database.types";
import type { VisibleOrganization, VisibleContact } from "@/lib/visibility/data";
import type { ProcurementInfo, ProductCategory } from "@/lib/types/procurement";
import { PRODUCT_CATEGORIES, hasProcurementInfo } from "@/lib/types/procurement";
import { updateProcurementInfo } from "@/lib/actions/procurement";
import { useAuth } from "@/components/providers/AuthProvider";

interface EditableProcurementSectionProps {
  organization: VisibleOrganization;
  contacts: VisibleContact[];
}

/**
 * Procurement section that can be edited inline by org_admins.
 * Shows view mode by default, with an edit button for admins.
 */
export default function EditableProcurementSection({
  organization,
  contacts,
}: EditableProcurementSectionProps) {
  const { organizations } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [procurementInfo, setProcurementInfo] = useState<ProcurementInfo | undefined>(
    (organization as Organization & { procurement_info?: ProcurementInfo }).procurement_info || undefined
  );

  // Check if current user is org_admin for this organization
  const isOrgAdmin = organizations.some(
    (uo) => uo.organization.id === organization.id && uo.role === "org_admin"
  );

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
          <h2 className="text-xl font-semibold text-[#1A1A1A]">
            Procurement Information
          </h2>
          {isOrgAdmin && (
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
            <p className="text-gray-500 mb-4">
              Procurement details for this organization are not yet available.
            </p>
            {isOrgAdmin && (
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

/**
 * View mode - displays procurement info (same as PartnerViewOfMember but without permission gating)
 */
function ViewMode({
  procurementInfo,
  contacts,
}: {
  procurementInfo: ProcurementInfo;
  contacts: VisibleContact[];
}) {
  const categories = procurementInfo.product_categories || [];
  const requirements = procurementInfo.requirements;
  const buyingCycle = procurementInfo.buying_cycle;
  const buyerContactId = procurementInfo.buyer_contact_id;
  const buyerContact = buyerContactId
    ? contacts.find((c) => c.id === buyerContactId)
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
      {/* Left Column */}
      <div className="space-y-10">
        {/* Product Categories */}
        {categories.length > 0 && (
          <div>
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Product Categories
            </h3>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <span
                  key={category}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-full"
                >
                  {category}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Requirements */}
        {requirements && (
          <div>
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Procurement Requirements
            </h3>
            <div className="space-y-4">
              {requirements.buy_local !== undefined && (
                <RequirementRow
                  active={requirements.buy_local}
                  label="Buy Local Policy"
                  notes={requirements.buy_local_notes}
                />
              )}
              {requirements.indigenous_owned !== undefined && (
                <RequirementRow
                  active={requirements.indigenous_owned}
                  label="Indigenous-Owned Vendor Preference"
                  notes={requirements.indigenous_owned_notes}
                />
              )}
              {requirements.sustainability_certs && requirements.sustainability_certs.length > 0 && (
                <div className="flex items-start gap-3">
                  <CheckBadge />
                  <div>
                    <span className="font-medium text-[#1A1A1A]">Sustainability Certifications</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {requirements.sustainability_certs.map((cert) => (
                        <span
                          key={cert}
                          className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-full"
                        >
                          {cert}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {requirements.other_requirements && (
                <div className="flex items-start gap-3">
                  <CheckBadge />
                  <div>
                    <span className="font-medium text-[#1A1A1A]">Other Requirements</span>
                    <p className="text-sm text-gray-500 mt-0.5">{requirements.other_requirements}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right Column */}
      <div className="space-y-10">
        {/* Buying Cycle */}
        {buyingCycle && (buyingCycle.fiscal_year_start || buyingCycle.rfp_window || buyingCycle.key_dates) && (
          <div>
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Buying Cycle
            </h3>
            <div className="bg-gray-50 rounded-lg p-5 space-y-4">
              {buyingCycle.fiscal_year_start && (
                <div>
                  <span className="text-xs uppercase text-gray-400">Fiscal Year Starts</span>
                  <p className="font-medium text-[#1A1A1A]">{buyingCycle.fiscal_year_start}</p>
                </div>
              )}
              {buyingCycle.rfp_window && (
                <div>
                  <span className="text-xs uppercase text-gray-400">RFP Window</span>
                  <p className="font-medium text-[#1A1A1A]">{buyingCycle.rfp_window}</p>
                </div>
              )}
              {buyingCycle.key_dates && (
                <div>
                  <span className="text-xs uppercase text-gray-400">Key Dates</span>
                  <p className="text-sm text-gray-600">{buyingCycle.key_dates}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Buyer Contact */}
        {buyerContact && (
          <div>
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Buyer Contact
            </h3>
            <div className="bg-gray-50 rounded-lg p-5">
              <div className="font-medium text-[#1A1A1A] text-lg">{buyerContact.name}</div>
              {buyerContact.role_title && (
                <p className="text-gray-500 text-sm mt-0.5">{buyerContact.role_title}</p>
              )}
              <div className="mt-4 space-y-2 text-sm">
                {(buyerContact.work_email || buyerContact.email) && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <EmailIcon />
                    {buyerContact.work_email || buyerContact.email}
                  </div>
                )}
                {(buyerContact.work_phone_number || buyerContact.phone) && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <PhoneIcon />
                    {buyerContact.work_phone_number || buyerContact.phone}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Edit mode - inline form for editing procurement info
 */
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
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
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
    setError(null);

    const newData: ProcurementInfo = {
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
    if (Object.values(newData.requirements || {}).every((v) => v === undefined)) {
      delete newData.requirements;
    }
    if (Object.values(newData.buying_cycle || {}).every((v) => v === undefined)) {
      delete newData.buying_cycle;
    }

    try {
      const result = await updateProcurementInfo(organizationId, newData);
      if (result.success) {
        onSave(newData);
      } else {
        setError(result.error || "Failed to save");
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-semibold text-[#1A1A1A]">
            Edit Procurement Information
          </h2>
          <button
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Product Categories */}
          <div>
            <h3 className="text-sm font-semibold text-[#1A1A1A] mb-3">Product Categories</h3>
            <p className="text-xs text-gray-500 mb-4">Select the categories of products your store carries.</p>
            <div className="flex flex-wrap gap-2">
              {PRODUCT_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    productCategories.includes(category)
                      ? "bg-[#EE2A2E] text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {/* Requirements */}
          <div className="border-t border-gray-200 pt-8">
            <h3 className="text-sm font-semibold text-[#1A1A1A] mb-4">Procurement Requirements</h3>

            {/* Buy Local */}
            <div className="mb-6">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={buyLocal}
                  onChange={(e) => setBuyLocal(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
                />
                <div>
                  <span className="font-medium text-[#1A1A1A]">Buy Local Policy</span>
                  <p className="text-xs text-gray-500 mt-0.5">Your organization has preferences for local vendors</p>
                </div>
              </label>
              {buyLocal && (
                <input
                  type="text"
                  value={buyLocalNotes}
                  onChange={(e) => setBuyLocalNotes(e.target.value)}
                  placeholder="e.g., 30% local sourcing required"
                  className="mt-3 ml-7 w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
                />
              )}
            </div>

            {/* Indigenous Owned */}
            <div className="mb-6">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={indigenousOwned}
                  onChange={(e) => setIndigenousOwned(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
                />
                <div>
                  <span className="font-medium text-[#1A1A1A]">Indigenous-Owned Vendor Preference</span>
                  <p className="text-xs text-gray-500 mt-0.5">Priority given to indigenous-owned suppliers</p>
                </div>
              </label>
              {indigenousOwned && (
                <input
                  type="text"
                  value={indigenousOwnedNotes}
                  onChange={(e) => setIndigenousOwnedNotes(e.target.value)}
                  placeholder="e.g., Indigenous suppliers given priority"
                  className="mt-3 ml-7 w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
                />
              )}
            </div>

            {/* Sustainability Certs */}
            <div className="mb-6">
              <label className="block font-medium text-[#1A1A1A] mb-2">Sustainability Certifications</label>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newCert}
                  onChange={(e) => setNewCert(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCert())}
                  placeholder="Enter certification name"
                  className="flex-1 max-w-xs px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
                />
                <button type="button" onClick={addCert} className="px-4 py-2 text-sm bg-gray-100 rounded-md hover:bg-gray-200">
                  Add
                </button>
              </div>
              {sustainabilityCerts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {sustainabilityCerts.map((cert) => (
                    <span key={cert} className="inline-flex items-center gap-1 px-3 py-1 bg-green-50 text-green-700 text-sm rounded-full">
                      {cert}
                      <button type="button" onClick={() => removeCert(cert)} className="hover:text-green-900">
                        <XIcon />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Other */}
            <div>
              <label className="block font-medium text-[#1A1A1A] mb-2">Other Requirements</label>
              <textarea
                value={otherRequirements}
                onChange={(e) => setOtherRequirements(e.target.value)}
                placeholder="e.g., All vendors must carry $2M liability insurance"
                rows={2}
                className="w-full max-w-lg px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
              />
            </div>
          </div>

          {/* Buying Cycle */}
          <div className="border-t border-gray-200 pt-8">
            <h3 className="text-sm font-semibold text-[#1A1A1A] mb-4">Buying Cycle</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-lg">
              <div>
                <label className="block font-medium text-[#1A1A1A] mb-2">Fiscal Year Start</label>
                <select
                  value={fiscalYearStart}
                  onChange={(e) => setFiscalYearStart(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
                >
                  <option value="">Select month</option>
                  {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-[#1A1A1A] mb-2">RFP Window</label>
                <input
                  type="text"
                  value={rfpWindow}
                  onChange={(e) => setRfpWindow(e.target.value)}
                  placeholder="e.g., January - March"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
                />
              </div>
            </div>
            <div className="mt-6 max-w-lg">
              <label className="block font-medium text-[#1A1A1A] mb-2">Key Dates</label>
              <textarea
                value={keyDates}
                onChange={(e) => setKeyDates(e.target.value)}
                placeholder="e.g., Textbook adoption deadline: June 15"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
              />
            </div>
          </div>

          {/* Buyer Contact */}
          <div className="border-t border-gray-200 pt-8">
            <h3 className="text-sm font-semibold text-[#1A1A1A] mb-4">Buyer Contact</h3>
            {contacts.length > 0 ? (
              <select
                value={buyerContactId}
                onChange={(e) => setBuyerContactId(e.target.value)}
                className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]"
              >
                <option value="">Select a contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.role_title ? `(${c.role_title})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-gray-400 italic">No contacts available.</p>
            )}
          </div>

          {/* Actions */}
          <div className="border-t border-gray-200 pt-6 flex items-center justify-between">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3 ml-auto">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2 bg-[#EE2A2E] text-white font-medium rounded-md hover:bg-[#D92327] disabled:opacity-50 transition-colors"
              >
                {isSubmitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// Helper components
function RequirementRow({ active, label, notes }: { active: boolean; label: string; notes?: string }) {
  return (
    <div className="flex items-start gap-3">
      {active ? <CheckBadge /> : <XBadge />}
      <div>
        <span className="font-medium text-[#1A1A1A]">{label}</span>
        {notes && <p className="text-sm text-gray-500 mt-0.5">{notes}</p>}
      </div>
    </div>
  );
}

function CheckBadge() {
  return (
    <span className="flex-shrink-0 w-5 h-5 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

function XBadge() {
  return (
    <span className="flex-shrink-0 w-5 h-5 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </span>
  );
}

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
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}
