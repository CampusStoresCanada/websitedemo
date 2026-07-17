"use client";

import { useState } from "react";
import { updateField } from "@/lib/actions/update-field";
import { addContact } from "@/lib/actions/add-contact";
import { updateProcurementInfo } from "@/lib/actions/procurement";
import type { VisibleContact } from "@/lib/visibility/data";
import type { ProcurementInfo } from "@/lib/types/procurement";
import { VENDOR_CATEGORIES, CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";

interface ContactEditModalProps {
  /** null = create-mode: same form, empty defaults, inserts instead of updating. */
  contact: VisibleContact | null;
  organizationId: string;
  isHidden?: boolean;
  onToggleHidden?: () => void;
  onClose: () => void;
  /** Pass for Member orgs to enable the Procurement tab. Ignored in create-mode. */
  procurementInfo?: ProcurementInfo;
  onProcurementSave?: (data: ProcurementInfo) => void;
  /** Create-mode only: fires with the new contact once it's saved. */
  onCreated?: (contact: { id: string; name: string; email: string | null }) => void;
}

interface FieldState {
  name: string;
  work_email: string;
  role_title: string;
  work_phone_number: string;
}

type Tab = "details" | "procurement";

export default function ContactEditModal({
  contact,
  organizationId,
  isHidden,
  onToggleHidden,
  onClose,
  procurementInfo,
  onProcurementSave,
  onCreated,
}: ContactEditModalProps) {
  const isCreate = contact === null;
  const showProcurement = !isCreate && procurementInfo !== undefined;
  const [tab, setTab] = useState<Tab>("details");

  // ── Details tab state ──────────────────────────────────────────────────────
  const [fields, setFields] = useState<FieldState>({
    name: (contact?.name as string | null) ?? "",
    work_email: (contact?.work_email as string | null) ?? (contact?.email as string | null) ?? "",
    role_title: (contact?.role_title as string | null) ?? "",
    work_phone_number: (contact?.work_phone_number as string | null) ?? (contact?.phone as string | null) ?? "",
  });

  // ── Procurement tab state (edit-mode only — a new contact has no assignments yet) ──
  // Which categories is this contact already a buyer for?
  const [buyerCategories, setBuyerCategories] = useState<Set<string>>(() => {
    const set = new Set<string>();
    if (!contact) return set;
    for (const entry of procurementInfo?.category_buyers ?? []) {
      if (entry.contact_ids.includes(contact.id)) set.add(entry.category);
    }
    return set;
  });
  // Which subcategories has THIS contact selected per category?
  const [subcategoryMap, setSubcategoryMap] = useState<Record<string, Set<string>>>(() => {
    const map: Record<string, Set<string>> = {};
    if (!contact) return map;
    for (const entry of procurementInfo?.category_buyers ?? []) {
      if (entry.contact_ids.includes(contact.id)) {
        const mySubs = entry.contact_subcategories?.[contact.id];
        if (mySubs?.length) map[entry.category] = new Set(mySubs);
      }
    }
    return map;
  });

  // ── Shared state ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Details save ───────────────────────────────────────────────────────────
  async function handleDetailsSave() {
    setSaving(true);
    setError(null);

    if (!contact) {
      const name = fields.name.trim();
      if (!name) {
        setError("Name is required.");
        setSaving(false);
        return;
      }
      const result = await addContact({
        organizationId,
        name,
        workEmail: fields.work_email.trim() || undefined,
        roleTitle: fields.role_title.trim() || undefined,
        workPhoneNumber: fields.work_phone_number.trim() || undefined,
      });
      setSaving(false);
      if (!result.success || !result.contactId) {
        setError(result.error ?? "Failed to add contact.");
        return;
      }
      window.dispatchEvent(
        new CustomEvent("csc:field-updated", { detail: { table: "contacts", column: "name", entityId: result.contactId } })
      );
      onCreated?.({ id: result.contactId, name, email: fields.work_email.trim() || null });
      onClose();
      return;
    }

    const original: FieldState = {
      name: (contact.name as string | null) ?? "",
      work_email: (contact.work_email as string | null) ?? (contact.email as string | null) ?? "",
      role_title: (contact.role_title as string | null) ?? "",
      work_phone_number: (contact.work_phone_number as string | null) ?? (contact.phone as string | null) ?? "",
    };

    const changed = (Object.keys(fields) as (keyof FieldState)[]).filter(
      (key) => fields[key].trim() !== original[key].trim()
    );

    for (const column of changed) {
      const result = await updateField({
        table: "contacts",
        column,
        entityId: contact.id,
        newValue: fields[column].trim() || null,
        orgId: organizationId,
      });
      if (!result.success) {
        setError("Something went wrong saving your changes.");
        setSaving(false);
        return;
      }
      window.dispatchEvent(new CustomEvent("csc:field-updated", {
        detail: { table: "contacts", column, entityId: contact.id },
      }));
    }

    setSaving(false);
    onClose();
  }

  // ── Procurement save (unreachable in create-mode — tab isn't rendered) ─────
  async function handleProcurementSave() {
    if (!contact) return;
    setSaving(true);
    setError(null);

    const existingBuyers = procurementInfo?.category_buyers ?? [];
    const updatedBuyers = [];
    const processedCategories = new Set<string>();

    // Update existing category entries — preserve other buyers' subcategories, update this contact's
    for (const entry of existingBuyers) {
      const isChecked = buyerCategories.has(entry.category);
      const ids = new Set(entry.contact_ids);
      isChecked ? ids.add(contact.id) : ids.delete(contact.id);

      // Update contact_subcategories: touch only this contact's entry
      const contactSubs = { ...(entry.contact_subcategories ?? {}) };
      if (isChecked && subcategoryMap[entry.category]?.size) {
        contactSubs[contact.id] = [...subcategoryMap[entry.category]];
      } else {
        delete contactSubs[contact.id];
      }

      updatedBuyers.push({
        category: entry.category,
        contact_ids: [...ids],
        contact_subcategories: Object.keys(contactSubs).length > 0 ? contactSubs : undefined,
      });
      processedCategories.add(entry.category);
    }

    // Add new categories this contact checked that weren't in the org's setup yet
    for (const cat of buyerCategories) {
      if (!processedCategories.has(cat)) {
        const mySubs = subcategoryMap[cat] ? [...subcategoryMap[cat]] : [];
        updatedBuyers.push({
          category: cat,
          contact_ids: [contact.id],
          contact_subcategories: mySubs.length > 0 ? { [contact.id]: mySubs } : undefined,
        });
      }
    }

    const updatedData: ProcurementInfo = {
      ...(procurementInfo ?? {}),
      category_buyers: updatedBuyers.length > 0 ? updatedBuyers : undefined,
    };

    const result = await updateProcurementInfo(organizationId, updatedData);
    setSaving(false);

    if (result.success) {
      onProcurementSave?.(updatedData);
      onClose();
    } else {
      setError("Failed to save procurement changes.");
    }
  }

  function handleSave() {
    if (tab === "details") return handleDetailsSave();
    return handleProcurementSave();
  }

  const saveLabel = saving ? "Saving…" : isCreate ? "Add contact" : "Save";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md bg-white rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
            <h2 className="text-base font-semibold text-[#1A1A1A]">{isCreate ? "Add contact" : "Edit contact"}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs — only shown when procurement is available */}
          {showProcurement && (
            <div className="flex border-b border-gray-100 shrink-0">
              <button
                onClick={() => { setTab("details"); setError(null); }}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  tab === "details"
                    ? "border-b-2 border-[#EE2A2E] text-[#EE2A2E]"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Details
              </button>
              <button
                onClick={() => { setTab("procurement"); setError(null); }}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  tab === "procurement"
                    ? "border-b-2 border-[#EE2A2E] text-[#EE2A2E]"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Procurement
              </button>
            </div>
          )}

          {/* Body — scrollable */}
          <div className="overflow-y-auto flex-1">
            {/* ── Details tab ── */}
            {tab === "details" && (
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Name</label>
                  <input
                    type="text"
                    value={fields.name}
                    onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30 focus:border-[#EE2A2E]"
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
                  <input
                    type="email"
                    value={fields.work_email}
                    onChange={(e) => setFields((f) => ({ ...f, work_email: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30 focus:border-[#EE2A2E]"
                    placeholder="work@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Role / Title</label>
                  <input
                    type="text"
                    value={fields.role_title}
                    onChange={(e) => setFields((f) => ({ ...f, role_title: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30 focus:border-[#EE2A2E]"
                    placeholder="e.g. Store Manager"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Phone</label>
                  <input
                    type="tel"
                    value={fields.work_phone_number}
                    onChange={(e) => setFields((f) => ({ ...f, work_phone_number: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30 focus:border-[#EE2A2E]"
                    placeholder="+1 (555) 000-0000"
                  />
                </div>

                {/* Visibility toggle — edit-mode only, nothing to toggle before a contact exists */}
                {!isCreate && (
                <div className="pt-1 border-t border-gray-100">
                  <button
                    onClick={onToggleHidden}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors text-sm ${
                      isHidden
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {isHidden ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                      {isHidden ? "Hidden from the community" : "Visible to the community"}
                    </span>
                    <span className="text-xs text-gray-400">{isHidden ? "Click to show" : "Click to hide"}</span>
                  </button>
                </div>
                )}
              </div>
            )}

            {/* ── Procurement tab ── */}
            {tab === "procurement" && (
              <div className="px-6 py-5">
                <p className="text-xs text-gray-500 mb-4">
                  Check the categories you buy for. All subcategories are selected by default — deselect any that don't apply to you.
                </p>
                <div className="space-y-2">
                  {VENDOR_CATEGORIES.map((cat) => {
                    const checked = buyerCategories.has(cat);
                    const subs = CATEGORY_SUBCATEGORIES[cat];
                    return (
                      <div key={cat} className="border border-gray-200 rounded-xl overflow-hidden">
                        <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer"
                            checked={checked}
                            onChange={() => {
                              setBuyerCategories((prev) => {
                                const next = new Set(prev);
                                if (next.has(cat)) {
                                  next.delete(cat);
                                  setSubcategoryMap((sm) => { const n = { ...sm }; delete n[cat]; return n; });
                                } else {
                                  next.add(cat);
                                  // Auto-select all subcategories — deselect individually to narrow
                                  const subs = CATEGORY_SUBCATEGORIES[cat];
                                  if (subs?.length) {
                                    setSubcategoryMap((sm) => ({ ...sm, [cat]: new Set(subs) }));
                                  }
                                }
                                return next;
                              });
                            }}
                          />
                          <span className="text-sm font-medium text-[#1A1A1A]">{cat}</span>
                        </label>

                        {checked && subs && subs.length > 0 && (
                          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Your subcategories</p>
                            <div className="flex flex-wrap gap-2">
                              {subs.map((sub) => {
                                const selected = subcategoryMap[cat]?.has(sub) ?? false;
                                return (
                                  <button
                                    key={sub}
                                    type="button"
                                    onClick={() => {
                                      setSubcategoryMap((prev) => {
                                        const existing = new Set(prev[cat] ?? []);
                                        existing.has(sub) ? existing.delete(sub) : existing.add(sub);
                                        return { ...prev, [cat]: existing };
                                      });
                                    }}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                      selected
                                        ? "bg-[#EE2A2E] text-white"
                                        : "bg-white border border-gray-300 text-gray-600 hover:border-gray-400"
                                    }`}
                                  >
                                    {sub}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
            {error && <p className="text-xs text-red-600 mr-auto">{error}</p>}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-4 py-2 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
            >
              {saveLabel}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
