"use client";

import { useState, useTransition, useRef } from "react";
import {
  LINK_TYPE_LABELS,
  VISIBILITY_LABELS,
  type PartnerLink,
  type PartnerLinkType,
  type PartnerLinkVisibility,
} from "@/lib/partner-links";
import {
  addPartnerLink,
  removePartnerLink,
  updatePartnerLink,
  reorderPartnerLinks,
} from "@/lib/actions/manage-partner-links";
import { uploadPartnerDocument } from "@/lib/actions/upload-partner-document";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = "list" | "add";

interface PartnerLinksEditorProps {
  orgId: string;
  orgName: string;
  initialLinks: PartnerLink[];
  primaryColor: string;
  onClose: () => void;
  onSaved: (links: PartnerLink[]) => void;
}

// ---------------------------------------------------------------------------
// Icon components
// ---------------------------------------------------------------------------

function LinkTypeIcon({ type }: { type: PartnerLinkType }) {
  const icons: Record<PartnerLinkType, React.ReactNode> = {
    catalogue: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    price_list: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    order_portal: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
    ),
    line_sheet: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
    custom: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
      </svg>
    ),
  };
  return <>{icons[type]}</>;
}

function VisibilityBadge({ visibility }: { visibility: PartnerLinkVisibility }) {
  const styles: Record<PartnerLinkVisibility, string> = {
    public:    "bg-green-50 text-green-700 border-green-200",
    member:    "bg-blue-50 text-blue-700 border-blue-200",
    org_admin: "bg-purple-50 text-purple-700 border-purple-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${styles[visibility]}`}>
      {VISIBILITY_LABELS[visibility]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Add link form
// ---------------------------------------------------------------------------

interface AddLinkFormProps {
  orgId: string;
  primaryColor: string;
  onAdded: (link: PartnerLink) => void;
  onCancel: () => void;
}

function AddLinkForm({ orgId, primaryColor, onAdded, onCancel }: AddLinkFormProps) {
  const [type, setType] = useState<PartnerLinkType>("catalogue");
  const [label, setLabel] = useState("");
  const [visibility, setVisibility] = useState<PartnerLinkVisibility>("member");
  const [linkMode, setLinkMode] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-set a sensible default label when type changes
  const handleTypeChange = (t: PartnerLinkType) => {
    setType(t);
    if (!label || Object.values(LINK_TYPE_LABELS).includes(label)) {
      setLabel(LINK_TYPE_LABELS[t]);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    const trimmedLabel = label.trim();
    if (!trimmedLabel) { setError("Label is required"); return; }

    if (linkMode === "url") {
      if (!url.trim()) { setError("URL is required"); return; }
      const link: PartnerLink = {
        id: crypto.randomUUID(),
        type,
        label: trimmedLabel,
        visibility,
        url: url.trim(),
      };
      setUploading(true);
      const result = await addPartnerLink(orgId, link);
      setUploading(false);
      if (!result.success) { setError(result.error ?? "Failed to save"); return; }
      onAdded(link);
    } else {
      if (!file) { setError("Please select a file"); return; }
      setUploading(true);

      // Read file as base64
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const uploadResult = await uploadPartnerDocument({
        orgId,
        fileData,
        fileName: file.name,
        contentType: file.type,
      });

      if (!uploadResult.success || !uploadResult.storagePath) {
        setUploading(false);
        setError(uploadResult.error ?? "Upload failed");
        return;
      }

      const link: PartnerLink = {
        id: crypto.randomUUID(),
        type,
        label: trimmedLabel,
        visibility,
        storage_path: uploadResult.storagePath,
      };

      const saveResult = await addPartnerLink(orgId, link);
      setUploading(false);
      if (!saveResult.success) { setError(saveResult.error ?? "Failed to save"); return; }
      onAdded(link);
    }
  };

  return (
    <div className="space-y-5">
      {/* Type */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Type
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(Object.keys(LINK_TYPE_LABELS) as PartnerLinkType[]).map((t) => (
            <button
              key={t}
              onClick={() => handleTypeChange(t)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all text-left ${
                type === t
                  ? "border-[#1A1A1A] bg-[#1A1A1A] text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-400"
              }`}
            >
              <span className={type === t ? "text-white" : "text-gray-400"}>
                <LinkTypeIcon type={t} />
              </span>
              {LINK_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Label */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Label
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`e.g. Spring 2026 ${LINK_TYPE_LABELS[type]}`}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-[#1A1A1A] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 transition-colors"
        />
      </div>

      {/* Visibility */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Who can see this?
        </label>
        <div className="flex flex-col gap-2">
          {(["public", "member", "org_admin"] as PartnerLinkVisibility[]).map((v) => {
            const descriptions: Record<PartnerLinkVisibility, string> = {
              public:    "Visible to everyone, including visitors who aren't signed in",
              member:    "Only visible to members (and admins) — price lists, line sheets",
              org_admin: "Only visible to your team and CSC admins",
            };
            return (
              <button
                key={v}
                onClick={() => setVisibility(v)}
                className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                  visibility === v
                    ? "border-[#1A1A1A] bg-gray-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  visibility === v ? "border-[#1A1A1A]" : "border-gray-300"
                }`}>
                  {visibility === v && (
                    <span className="w-2 h-2 rounded-full bg-[#1A1A1A]" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-medium text-[#1A1A1A]">{VISIBILITY_LABELS[v]}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{descriptions[v]}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Link source */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Source
        </label>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden mb-3">
          {(["url", "upload"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setLinkMode(mode)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                linkMode === mode
                  ? "bg-[#1A1A1A] text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              {mode === "url" ? "External URL" : "Upload Document"}
            </button>
          ))}
        </div>

        {linkMode === "url" ? (
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-[#1A1A1A] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 transition-colors font-mono"
          />
        ) : (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              {file ? file.name : "Choose PDF, Word, or Excel file"}
            </button>
            {file && (
              <p className="text-xs text-gray-400 mt-1.5 text-center">
                {(file.size / 1024 / 1024).toFixed(1)} MB · {file.type}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-2 text-center">
              Stored privately · max 50 MB · access-controlled by the visibility setting above
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-500 hover:text-[#1A1A1A] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={uploading}
          className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60 flex items-center gap-2"
          style={{ backgroundColor: primaryColor }}
        >
          {uploading && (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {uploading ? "Saving…" : "Add Link"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export default function PartnerLinksEditor({
  orgId,
  orgName,
  initialLinks,
  primaryColor,
  onClose,
  onSaved,
}: PartnerLinksEditorProps) {
  const [links, setLinks] = useState<PartnerLink[]>(initialLinks);
  const [step, setStep] = useState<Step>("list");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAdded = (link: PartnerLink) => {
    const updated = [...links, link];
    setLinks(updated);
    onSaved(updated);
    setStep("list");
  };

  const handleRemove = (linkId: string) => {
    setRemovingId(linkId);
    startTransition(async () => {
      const result = await removePartnerLink(orgId, linkId);
      setRemovingId(null);
      if (result.success && result.links) {
        setLinks(result.links);
        onSaved(result.links);
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col mx-4">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            {step === "add" && (
              <button
                onClick={() => setStep("list")}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div>
              <h2 className="text-lg font-semibold text-[#1A1A1A]">
                {step === "list" ? "Links & Documents" : "Add a Link"}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {step === "list"
                  ? "Catalogues, price lists, and portals"
                  : "Choose type, label, and access level"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {step === "list" ? (
            <div className="space-y-2">
              {links.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-500 font-medium">No links yet</p>
                  <p className="text-xs text-gray-400 mt-1">Add a catalogue, price list, or portal link</p>
                </div>
              ) : (
                links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl border border-gray-100 bg-gray-50 group hover:border-gray-200 transition-colors"
                  >
                    <span className="text-gray-400 flex-shrink-0">
                      <LinkTypeIcon type={link.type} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">{link.label}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{LINK_TYPE_LABELS[link.type]}</span>
                        <span className="text-gray-200">·</span>
                        <VisibilityBadge visibility={link.visibility} />
                        {link.storage_path && (
                          <>
                            <span className="text-gray-200">·</span>
                            <span className="text-xs text-gray-400">📄 Uploaded</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(link.id)}
                      disabled={removingId === link.id}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 disabled:opacity-50"
                      aria-label={`Remove ${link.label}`}
                    >
                      {removingId === link.id ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      )}
                    </button>
                  </div>
                ))
              )}

              {/* Add button */}
              <button
                onClick={() => setStep("add")}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors mt-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add a link or document
              </button>
            </div>
          ) : (
            <AddLinkForm
              orgId={orgId}
              primaryColor={primaryColor}
              onAdded={handleAdded}
              onCancel={() => setStep("list")}
            />
          )}
        </div>

        {/* Footer — only on list view */}
        {step === "list" && (
          <div className="px-6 py-4 border-t border-gray-100 flex justify-end flex-shrink-0">
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ backgroundColor: primaryColor }}
            >
              Done
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
