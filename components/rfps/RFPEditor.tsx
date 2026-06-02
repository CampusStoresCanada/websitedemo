"use client";

import { useState } from "react";
import type { RFPWithContext, RFPVisibility } from "@/lib/types/rfp";
import { VISIBILITY_LABELS, VISIBILITY_DESCRIPTIONS } from "@/lib/types/rfp";
import { CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";
import { RFP_CATEGORIES } from "@/lib/types/rfp";
import { createRFP, closeRFP, deleteRFP } from "@/lib/actions/rfps";
import { uploadRFPDocument } from "@/lib/actions/rfp-document";
import type { VisibleContact } from "@/lib/visibility/data";

type Step = "list" | "add";

interface RFPEditorProps {
  organizationId: string;
  contacts: VisibleContact[];
  initialRFPs: RFPWithContext[];
  onClose: () => void;
  onSaved: (rfps: RFPWithContext[]) => void;
}

function formatDate(iso: string) {
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z")
    .toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function StatusChip({ rfp }: { rfp: RFPWithContext }) {
  const now = new Date();
  const closes = new Date(rfp.closes_at.endsWith("Z") || rfp.closes_at.includes("+")
    ? rfp.closes_at : rfp.closes_at.replace(" ", "T") + "Z");

  if (rfp.status === "closed") {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Closed</span>;
  }
  if (closes < now) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200">Expired</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">Active</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// List step
// ─────────────────────────────────────────────────────────────────────────────

function RFPList({
  rfps,
  onAdd,
  onClose,
  onUpdate,
}: {
  rfps: RFPWithContext[];
  onAdd: () => void;
  onClose: () => void;
  onUpdate: (rfps: RFPWithContext[]) => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClose(id: string) {
    setWorking(id);
    const result = await closeRFP(id);
    setWorking(null);
    if (!result.success) { setError(result.error ?? "Failed"); return; }
    onUpdate(rfps.map(r => r.id === id ? { ...r, status: "closed" as const } : r));
  }

  async function handleDelete(id: string) {
    setWorking(id);
    const result = await deleteRFP(id);
    setWorking(null);
    if (!result.success) { setError(result.error ?? "Failed"); return; }
    onUpdate(rfps.filter(r => r.id !== id));
  }

  return (
    <>
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
        <div>
          <h2 className="text-base font-semibold text-[#1A1A1A]">RFPs</h2>
          <p className="text-xs text-gray-400 mt-0.5">Manage your open and closed RFPs</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
        {error && <p className="text-xs text-red-600">{error}</p>}

        {rfps.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400">No RFPs posted yet.</p>
          </div>
        ) : (
          rfps.map((rfp) => (
            <div key={rfp.id} className="rounded-xl border border-gray-100 bg-white p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1A1A1A] truncate">{rfp.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{rfp.category}</p>
                </div>
                <StatusChip rfp={rfp} />
              </div>

              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>Opens {formatDate(rfp.opens_at)}</span>
                <span>·</span>
                <span>Closes {formatDate(rfp.closes_at)}</span>
                <span>·</span>
                <span>{VISIBILITY_LABELS[rfp.visibility]}</span>
              </div>

              {rfp.status === "active" && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => void handleClose(rfp.id)}
                    disabled={working === rfp.id}
                    className="text-xs text-gray-400 hover:text-amber-600 transition-colors disabled:opacity-50"
                  >
                    Close RFP
                  </button>
                  <span className="text-gray-200">·</span>
                  <button
                    onClick={() => void handleDelete(rfp.id)}
                    disabled={working === rfp.id}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 px-6 py-4 border-t border-gray-100 flex justify-between">
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
          Done
        </button>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Post RFP
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add step
// ─────────────────────────────────────────────────────────────────────────────

function AddRFPForm({
  organizationId,
  contacts,
  onSaved,
  onBack,
}: {
  organizationId: string;
  contacts: VisibleContact[];
  onSaved: (rfp: RFPWithContext) => void;
  onBack: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [subcategories, setSubcategories] = useState<string[]>([]);
  const [contactId, setContactId] = useState<string>("");
  const [opensAt, setOpensAt] = useState(today);
  const [closesAt, setClosesAt] = useState("");
  const [visibility, setVisibility] = useState<RFPVisibility>("partners");
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docStoragePath, setDocStoragePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocFile(file);
    setDocStoragePath(null); // reset any previous upload
    setUploading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const result = await uploadRFPDocument({
        orgId: organizationId,
        fileData: reader.result as string,
        fileName: file.name,
        contentType: file.type,
      });
      setUploading(false);
      if (!result.success) {
        setError(result.error ?? "Upload failed");
        setDocFile(null);
      } else {
        setDocStoragePath(result.storagePath ?? null);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!title.trim()) { setError("Title is required"); return; }
    if (!category) { setError("Category is required"); return; }
    if (!opensAt) { setError("Opening date is required"); return; }
    if (!closesAt) { setError("Closing date is required"); return; }
    if (closesAt <= opensAt) { setError("Closing date must be after opening date"); return; }
    if (docFile && !docStoragePath) { setError("Document is still uploading — please wait."); return; }

    setSaving(true);
    setError(null);

    const result = await createRFP({
      organizationId,
      contactId: contactId || null,
      title,
      description: description || null,
      category,
      subcategories,
      opensAt: new Date(opensAt + "T00:00:00Z").toISOString(),
      closesAt: new Date(closesAt + "T23:59:59Z").toISOString(),
      visibility,
      documentStoragePath: docStoragePath,
    });

    setSaving(false);

    if (!result.success || !result.rfp) {
      setError(result.error ?? "Failed to post RFP");
      return;
    }

    // Build context for optimistic update
    const contact = contacts.find(c => c.id === contactId) ?? null;
    onSaved({
      ...result.rfp,
      organization: { id: organizationId, name: "", slug: "", province: null },
      contact: contact ? {
        id: contact.id,
        name: contact.name as string | null,
        work_email: contact.work_email as string | null,
        email: contact.email as string | null,
        role_title: contact.role_title as string | null,
      } : null,
    });
  }

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30 focus:border-[#EE2A2E]";

  return (
    <>
      <div className="flex items-center gap-2 px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 transition-colors p-1 -ml-1 rounded">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </button>
        <h2 className="text-base font-semibold text-[#1A1A1A]">Post an RFP</h2>
      </div>

      <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className={inputCls}
            placeholder="e.g. RFP — Point of Sale System Replacement"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Summary
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className={inputCls + " resize-none"}
            placeholder="2–3 sentences: what you need, key requirements, any constraints. This is what vendors read before deciding to download the full document."
          />
        </div>

        {/* Category — grouped by operational parent, subcategories as the selectable items */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            What are you RFPing for? <span className="text-red-400">*</span>
          </label>
          <div className="space-y-2">
            {RFP_CATEGORIES.map(parent => {
              const subs = CATEGORY_SUBCATEGORIES[parent] ?? [];
              const isOpen = openCategory === parent;
              const hasSelection = category === parent && subcategories.length > 0;
              return (
                <div key={parent} className="border border-gray-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenCategory(isOpen ? null : parent)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-sm font-medium text-[#1A1A1A]">{parent}</span>
                    <div className="flex items-center gap-2">
                      {hasSelection && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#EE2A2E] text-white">
                          {subcategories.length}
                        </span>
                      )}
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3 pt-1 border-t border-gray-100 bg-gray-50">
                      <div className="flex flex-wrap gap-2">
                        {subs.map(sub => {
                          const selected = category === parent && subcategories.includes(sub);
                          return (
                            <button
                              key={sub}
                              type="button"
                              onClick={() => {
                                if (selected) {
                                  const next = subcategories.filter(s => s !== sub);
                                  setSubcategories(next);
                                  if (next.length === 0) setCategory("");
                                } else {
                                  if (category !== parent) {
                                    setCategory(parent);
                                    setSubcategories([sub]);
                                  } else {
                                    setSubcategories(prev => [...prev, sub]);
                                  }
                                }
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
          {category && (
            <p className="text-xs text-gray-400 mt-2">
              Filed under <span className="font-medium text-gray-600">{category}</span>
              {subcategories.length > 0 && ` · ${subcategories.join(", ")}`}
            </p>
          )}
        </div>

        {/* Contact */}
        {contacts.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Contact person
            </label>
            <select value={contactId} onChange={e => setContactId(e.target.value)} className={inputCls}>
              <option value="">No specific contact</option>
              {contacts.filter(c => !c.hidden).map(c => (
                <option key={c.id} value={c.id}>
                  {c.name as string}{c.role_title ? ` — ${c.role_title as string}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Opening / closing dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Opens <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={opensAt}
              onChange={e => setOpensAt(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Closes <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={closesAt}
              min={opensAt || today}
              onChange={e => setClosesAt(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Visibility */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Visibility
          </label>
          <div className="space-y-2">
            {(["partners", "network", "members", "public"] as RFPVisibility[]).map(v => (
              <label key={v} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                visibility === v ? "border-[#EE2A2E] bg-red-50/30" : "border-gray-200 hover:border-gray-300"
              }`}>
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                  className="mt-0.5 text-[#EE2A2E] focus:ring-[#EE2A2E]"
                />
                <div>
                  <p className="text-sm font-medium text-[#1A1A1A]">{VISIBILITY_LABELS[v]}</p>
                  <p className="text-xs text-gray-400">{VISIBILITY_DESCRIPTIONS[v]}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Full RFP document upload */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Full RFP document
          </label>
          {docFile && docStoragePath ? (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-green-200 bg-green-50">
              <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span className="text-xs text-green-700 font-medium flex-1 truncate">{docFile.name}</span>
              <button
                type="button"
                onClick={() => { setDocFile(null); setDocStoragePath(null); }}
                className="text-green-600 hover:text-green-800 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : uploading ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-500">
              <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Uploading…
            </div>
          ) : (
            <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-400 cursor-pointer transition-colors group">
              <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="text-xs text-gray-400 group-hover:text-gray-600">Upload PDF or Word doc — access requires sign-in</span>
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-2 bg-[#EE2A2E] hover:bg-[#D92327] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
        >
          {saving ? "Posting…" : "Post RFP"}
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main editor modal
// ─────────────────────────────────────────────────────────────────────────────

export default function RFPEditor({
  organizationId,
  contacts,
  initialRFPs,
  onClose,
  onSaved,
}: RFPEditorProps) {
  const [step, setStep] = useState<Step>("list");
  const [rfps, setRFPs] = useState<RFPWithContext[]>(initialRFPs);

  function handleUpdate(updated: RFPWithContext[]) {
    setRFPs(updated);
    onSaved(updated);
  }

  function handleAdded(rfp: RFPWithContext) {
    const updated = [rfp, ...rfps];
    setRFPs(updated);
    onSaved(updated);
    setStep("list");
  }

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-lg bg-white rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 flex flex-col max-h-[90vh]">
          {step === "list" ? (
            <RFPList
              rfps={rfps}
              onAdd={() => setStep("add")}
              onClose={onClose}
              onUpdate={handleUpdate}
            />
          ) : (
            <AddRFPForm
              organizationId={organizationId}
              contacts={contacts}
              onSaved={handleAdded}
              onBack={() => setStep("list")}
            />
          )}
        </div>
      </div>
    </>
  );
}
