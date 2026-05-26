"use client";

import { useState } from "react";
import { updateField } from "@/lib/actions/update-field";
import type { VisibleContact } from "@/lib/visibility/data";

interface ContactEditModalProps {
  contact: VisibleContact;
  organizationId: string;
  isHidden: boolean;
  onToggleHidden: () => void;
  onClose: () => void;
}

interface FieldState {
  name: string;
  work_email: string;
  role_title: string;
  work_phone_number: string;
}

export default function ContactEditModal({
  contact,
  organizationId,
  isHidden,
  onToggleHidden,
  onClose,
}: ContactEditModalProps) {
  const [fields, setFields] = useState<FieldState>({
    name: (contact.name as string | null) ?? "",
    work_email: (contact.work_email as string | null) ?? (contact.email as string | null) ?? "",
    role_title: (contact.role_title as string | null) ?? "",
    work_phone_number: (contact.work_phone_number as string | null) ?? (contact.phone as string | null) ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);

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
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("csc:field-updated", {
          detail: { table: "contacts", column, entityId: contact.id },
        }));
      }
    }

    setSaving(false);
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md bg-white rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">

          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-[#1A1A1A]">Edit contact</h2>
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

          {/* Fields */}
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

            {/* Visibility toggle */}
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
                  {isHidden ? "Hidden from visitors" : "Visible to visitors"}
                </span>
                <span className="text-xs text-gray-400">{isHidden ? "Click to show" : "Click to hide"}</span>
              </button>
            </div>

            {error && (
              <p className="text-xs text-red-600">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 pb-5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
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
