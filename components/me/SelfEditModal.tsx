"use client";

import { useState } from "react";
import { updateField } from "@/lib/actions/update-field";
import { setContactHidden } from "@/lib/actions/user-management";
import { updateProcurementInfo } from "@/lib/actions/procurement";
import type { ProcurementInfo } from "@/lib/types/procurement";
import { VENDOR_CATEGORIES, CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";

export interface ContactEditData {
  id: string;
  name: string | null;
  work_email: string | null;
  email: string | null;
  role_title: string | null;
  work_phone_number: string | null;
  phone: string | null;
  hidden: boolean | null;
}

export interface OrgEditData {
  orgId: string;
  orgName: string;
  orgType: string;
  role: string;
  contact: ContactEditData;
  procurementInfo: ProcurementInfo | null;
}

interface SelfEditModalProps {
  orgEditData: OrgEditData[];
}

type FieldState = {
  name: string;
  work_email: string;
  role_title: string;
  work_phone_number: string;
};

type ProcurementState = {
  buyerCategories: Set<string>;
  subcategoryMap: Record<string, Set<string>>;
};

function initFieldState(contact: ContactEditData): FieldState {
  return {
    name: contact.name ?? "",
    work_email: contact.work_email ?? contact.email ?? "",
    role_title: contact.role_title ?? "",
    work_phone_number: contact.work_phone_number ?? contact.phone ?? "",
  };
}

function initProcurementState(contactId: string, info: ProcurementInfo | null): ProcurementState {
  const buyerCategories = new Set<string>();
  const subcategoryMap: Record<string, Set<string>> = {};
  for (const entry of info?.category_buyers ?? []) {
    if (entry.contact_ids.includes(contactId)) {
      buyerCategories.add(entry.category);
      const mySubs = entry.contact_subcategories?.[contactId];
      if (mySubs?.length) subcategoryMap[entry.category] = new Set(mySubs);
    }
  }
  return { buyerCategories, subcategoryMap };
}

export default function SelfEditModal({ orgEditData: initialOrgEditData }: SelfEditModalProps) {
  const [open, setOpen] = useState(false);
  // Lifted, mutable copy of the server-rendered prop. The page is a server
  // component, so `initialOrgEditData` is fixed at request time — without this,
  // closing and reopening the modal would re-derive state from stale data and
  // make freshly-saved edits (contact fields, visibility, procurement) appear
  // to vanish, even though they persisted correctly. Mirrors the lifted-state
  // pattern `MemberProfile` uses with `onProcurementSave={setProcurementInfo}`.
  const [orgEditData, setOrgEditData] = useState(initialOrgEditData);

  if (orgEditData.length === 0) return null;

  function handleSaved(orgId: string, patch: { contact: ContactEditData; procurementInfo: ProcurementInfo | null }) {
    setOrgEditData((prev) =>
      prev.map((o) => (o.orgId === orgId ? { ...o, contact: patch.contact, procurementInfo: patch.procurementInfo } : o))
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-onboarding="self-edit-trigger"
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors whitespace-nowrap"
      >
        Edit my info
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
        </svg>
      </button>

      {open && (
        <SelfEditModalInner orgEditData={orgEditData} onClose={() => setOpen(false)} onSaved={handleSaved} />
      )}
    </>
  );
}

function SelfEditModalInner({
  orgEditData,
  onClose,
  onSaved,
}: {
  orgEditData: OrgEditData[];
  onClose: () => void;
  onSaved: (orgId: string, patch: { contact: ContactEditData; procurementInfo: ProcurementInfo | null }) => void;
}) {
  const multiOrg = orgEditData.length > 1;
  const [activeOrgId, setActiveOrgId] = useState(orgEditData[0].orgId);

  // Per-org field state
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>(() => {
    const map: Record<string, FieldState> = {};
    for (const org of orgEditData) map[org.orgId] = initFieldState(org.contact);
    return map;
  });

  // Per-org hidden state
  const [hiddenStates, setHiddenStates] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const org of orgEditData) map[org.orgId] = org.contact.hidden ?? false;
    return map;
  });

  // Per-org procurement state (only for member-type orgs)
  const [procStates, setProcStates] = useState<Record<string, ProcurementState>>(() => {
    const map: Record<string, ProcurementState> = {};
    for (const org of orgEditData) {
      if (org.orgType === "Member") {
        // Always available for own contact in a Member org — even if the org
        // has no procurement data yet, so the user can set it from scratch.
        map[org.orgId] = initProcurementState(org.contact.id, org.procurementInfo ?? {});
      }
    }
    return map;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type Tab = "details" | "procurement";
  const [tab, setTab] = useState<Tab>("details");

  const activeOrg = orgEditData.find((o) => o.orgId === activeOrgId)!;
  const fields = fieldStates[activeOrgId];
  const isHidden = hiddenStates[activeOrgId];
  const procState = procStates[activeOrgId];
  const showProcurement = !!procState;
  const activeTab: Tab = showProcurement ? tab : "details";

  function switchOrg(orgId: string) {
    setActiveOrgId(orgId);
    setTab("details");
    setError(null);
  }

  function setFields(updater: (f: FieldState) => FieldState) {
    setFieldStates((prev) => ({ ...prev, [activeOrgId]: updater(prev[activeOrgId]) }));
  }

  function toggleHiddenOptimistic() {
    setHiddenStates((prev) => ({ ...prev, [activeOrgId]: !prev[activeOrgId] }));
  }

  function setProcState(updater: (p: ProcurementState) => ProcurementState) {
    setProcStates((prev) => ({ ...prev, [activeOrgId]: updater(prev[activeOrgId]) }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const contact = activeOrg.contact;
    const original = initFieldState(contact);

    // Track what actually changed so we can patch the lifted state with the
    // freshly-saved values (server-rendered props won't refresh on their own).
    let updatedContact = contact;
    let updatedProcurementInfo = activeOrg.procurementInfo;

    // 1. Save changed contact fields
    const changed = (Object.keys(fields) as (keyof FieldState)[]).filter(
      (k) => fields[k].trim() !== original[k].trim()
    );
    for (const column of changed) {
      const newValue = fields[column].trim() || null;
      const result = await updateField({
        table: "contacts",
        column,
        entityId: contact.id,
        newValue,
        orgId: activeOrg.orgId,
      });
      if (!result.success) {
        setError("Something went wrong saving your changes.");
        setSaving(false);
        return;
      }
      updatedContact = { ...updatedContact, [column]: newValue };
      window.dispatchEvent(new CustomEvent("csc:field-updated", {
        detail: { table: "contacts", column, entityId: contact.id },
      }));
    }

    // 2. Save visibility if changed
    const originalHidden = contact.hidden ?? false;
    if (isHidden !== originalHidden) {
      const result = await setContactHidden(activeOrg.orgId, contact.id, isHidden);
      if (!result.success) {
        setError("Something went wrong saving your visibility setting.");
        setSaving(false);
        return;
      }
      updatedContact = { ...updatedContact, hidden: isHidden };
      window.dispatchEvent(new CustomEvent("csc:field-updated", {
        detail: { table: "contacts", column: "hidden", entityId: contact.id },
      }));
    }

    // 3. Save procurement if applicable
    if (showProcurement) {
      const baseProcurementInfo = activeOrg.procurementInfo ?? {};
      const existingBuyers = baseProcurementInfo.category_buyers ?? [];
      const updatedBuyers = [];
      const processedCategories = new Set<string>();

      for (const entry of existingBuyers) {
        const isChecked = procState.buyerCategories.has(entry.category);
        const ids = new Set(entry.contact_ids);
        isChecked ? ids.add(contact.id) : ids.delete(contact.id);

        const contactSubs = { ...(entry.contact_subcategories ?? {}) };
        if (isChecked && procState.subcategoryMap[entry.category]?.size) {
          contactSubs[contact.id] = [...procState.subcategoryMap[entry.category]];
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

      for (const cat of procState.buyerCategories) {
        if (!processedCategories.has(cat)) {
          const mySubs = procState.subcategoryMap[cat] ? [...procState.subcategoryMap[cat]] : [];
          updatedBuyers.push({
            category: cat,
            contact_ids: [contact.id],
            contact_subcategories: mySubs.length > 0 ? { [contact.id]: mySubs } : undefined,
          });
        }
      }

      const updatedData: ProcurementInfo = {
        ...baseProcurementInfo,
        category_buyers: updatedBuyers.length > 0 ? updatedBuyers : undefined,
      };

      const result = await updateProcurementInfo(activeOrg.orgId, updatedData);
      if (!result.success) {
        setError("Failed to save procurement changes.");
        setSaving(false);
        return;
      }
      updatedProcurementInfo = updatedData;
    }

    // Patch the lifted state so reopening the modal shows freshly-saved values
    // instead of re-deriving from the (now stale) server-rendered props.
    onSaved(activeOrg.orgId, { contact: updatedContact, procurementInfo: updatedProcurementInfo });

    setSaving(false);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md bg-white rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
            <h2 className="text-base font-semibold text-[#1A1A1A]">Edit my info</h2>
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

          {/* Org tabs — only when multiple orgs */}
          {multiOrg && (
            <div className="flex border-b border-gray-100 shrink-0 overflow-x-auto">
              {orgEditData.map((org) => (
                <button
                  key={org.orgId}
                  onClick={() => switchOrg(org.orgId)}
                  className={`flex-shrink-0 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                    org.orgId === activeOrgId
                      ? "border-b-2 border-[#EE2A2E] text-[#EE2A2E]"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {org.orgName}
                </button>
              ))}
            </div>
          )}

          {/* Details / Procurement sub-tabs — only when procurement is available for this org */}
          {showProcurement && (
            <div className="flex border-b border-gray-100 shrink-0">
              <button
                onClick={() => { setTab("details"); setError(null); }}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  activeTab === "details"
                    ? "border-b-2 border-[#EE2A2E] text-[#EE2A2E]"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Details
              </button>
              <button
                onClick={() => { setTab("procurement"); setError(null); }}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  activeTab === "procurement"
                    ? "border-b-2 border-[#EE2A2E] text-[#EE2A2E]"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                Procurement
              </button>
            </div>
          )}

          {/* Body */}
          <div className="overflow-y-auto flex-1">
          {activeTab === "details" && (
          <div className="px-6 py-5 space-y-4">

            {/* Contact fields */}
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

            {/* Visibility */}
            <div className="pt-1 border-t border-gray-100">
              <button
                onClick={toggleHiddenOptimistic}
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
          </div>
          )}

          {activeTab === "procurement" && showProcurement && (
              <div className="px-6 py-5">
                <p className="text-xs text-gray-500 mb-4">
                  Check the categories you buy for. All subcategories are selected by default — deselect any that don&apos;t apply to you.
                </p>
                <div className="space-y-2">
                  {VENDOR_CATEGORIES.map((cat) => {
                    const checked = procState.buyerCategories.has(cat);
                    const subs = CATEGORY_SUBCATEGORIES[cat];
                    return (
                      <div key={cat} className="border border-gray-200 rounded-xl overflow-hidden">
                        <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E] cursor-pointer"
                            checked={checked}
                            onChange={() => {
                              setProcState((prev) => {
                                const next = new Set(prev.buyerCategories);
                                const nextMap = { ...prev.subcategoryMap };
                                if (next.has(cat)) {
                                  next.delete(cat);
                                  delete nextMap[cat];
                                } else {
                                  next.add(cat);
                                  if (subs?.length) nextMap[cat] = new Set(subs);
                                }
                                return { buyerCategories: next, subcategoryMap: nextMap };
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
                                const selected = procState.subcategoryMap[cat]?.has(sub) ?? false;
                                return (
                                  <button
                                    key={sub}
                                    type="button"
                                    onClick={() => {
                                      setProcState((prev) => {
                                        const existing = new Set(prev.subcategoryMap[cat] ?? []);
                                        existing.has(sub) ? existing.delete(sub) : existing.add(sub);
                                        return { ...prev, subcategoryMap: { ...prev.subcategoryMap, [cat]: existing } };
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
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
