"use client";

import { useRef, useState, useTransition } from "react";
import type { ConferenceDocument } from "@/lib/conference-documents";
import {
  addConferenceDocument,
  removeConferenceDocument,
} from "@/lib/actions/manage-conference-documents";
import { uploadConferenceDocument } from "@/lib/actions/upload-conference-document";
import { getConferenceDocumentUrl } from "@/lib/actions/get-conference-document-url";

interface Props {
  conferenceId: string;
  initialDocuments: ConferenceDocument[];
}

// ---------------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------------

function AddDocumentForm({
  conferenceId,
  onAdded,
  onCancel,
}: {
  conferenceId: string;
  onAdded: (doc: ConferenceDocument) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    setError(null);
    const trimmedLabel = label.trim();
    if (!trimmedLabel) { setError("Label is required"); return; }

    if (mode === "url") {
      if (!url.trim()) { setError("URL is required"); return; }
      const doc: ConferenceDocument = { id: crypto.randomUUID(), label: trimmedLabel, url: url.trim() };
      setSaving(true);
      const result = await addConferenceDocument(conferenceId, doc);
      setSaving(false);
      if (!result.success) { setError(result.error ?? "Failed to save"); return; }
      onAdded(doc);
    } else {
      if (!file) { setError("Please select a file"); return; }
      setSaving(true);

      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const uploadResult = await uploadConferenceDocument({
        conferenceId,
        fileData,
        fileName: file.name,
        contentType: file.type,
      });

      if (!uploadResult.success || !uploadResult.storagePath) {
        setSaving(false);
        setError(uploadResult.error ?? "Upload failed");
        return;
      }

      const doc: ConferenceDocument = {
        id: crypto.randomUUID(),
        label: trimmedLabel,
        storage_path: uploadResult.storagePath,
      };

      const saveResult = await addConferenceDocument(conferenceId, doc);
      setSaving(false);
      if (!saveResult.success) { setError(saveResult.error ?? "Failed to save"); return; }
      onAdded(doc);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Label
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Venue Contract 2026"
          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Source
        </label>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden mb-3">
          {(["url", "upload"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === m ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-100"
              }`}
            >
              {m === "url" ? "External URL" : "Upload File"}
            </button>
          ))}
        </div>

        {mode === "url" ? (
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 font-mono"
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
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-300 bg-white text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
            >
              {file ? file.name : "Choose PDF, Word, or Excel file"}
            </button>
            {file && (
              <p className="text-xs text-gray-400 mt-1.5 text-center">
                {(file.size / 1024 / 1024).toFixed(1)} MB · {file.type}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-2 text-center">
              Stored privately · max 50 MB · visible to CSC admins only
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-gray-200">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="px-5 py-2 rounded-full text-sm font-semibold text-white bg-accent hover:bg-accent-hover disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : "Add Document"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export default function ConferenceDocumentsEditor({ conferenceId, initialDocuments }: Props) {
  const [documents, setDocuments] = useState<ConferenceDocument[]>(initialDocuments);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAdded = (doc: ConferenceDocument) => {
    setDocuments((prev) => [...prev, doc]);
    setAdding(false);
  };

  const handleRemove = (docId: string) => {
    setRemovingId(docId);
    startTransition(async () => {
      const result = await removeConferenceDocument(conferenceId, docId);
      setRemovingId(null);
      if (result.success && result.documents) {
        setDocuments(result.documents);
      }
    });
  };

  const handleOpen = async (doc: ConferenceDocument) => {
    if (doc.url) {
      window.open(doc.url, "_blank", "noopener,noreferrer");
      return;
    }
    setOpeningId(doc.id);
    const result = await getConferenceDocumentUrl(conferenceId, doc.id);
    setOpeningId(null);
    if (result.success && result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Documents</h2>
          <p className="text-xs text-gray-400 mt-0.5">Contracts, planning docs, and links — visible to CSC admins only</p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            + Add
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {adding && (
          <AddDocumentForm
            conferenceId={conferenceId}
            onAdded={handleAdded}
            onCancel={() => setAdding(false)}
          />
        )}

        {documents.length === 0 && !adding ? (
          <p className="text-center py-8 text-sm text-gray-400">
            No documents yet. Use Add to attach a file or link.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="group flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <button
                  type="button"
                  onClick={() => handleOpen(doc)}
                  disabled={openingId === doc.id}
                  className="flex items-center gap-2 min-w-0 text-left text-sm font-medium text-gray-900 hover:text-accent transition-colors disabled:opacity-50"
                >
                  <span className="flex-shrink-0 text-gray-400">{doc.storage_path ? "📄" : "🔗"}</span>
                  <span className="truncate">{doc.label}</span>
                  {openingId === doc.id && <span className="text-xs text-gray-400">opening…</span>}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(doc.id)}
                  disabled={isPending && removingId === doc.id}
                  className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-colors disabled:opacity-50"
                  aria-label={`Remove ${doc.label}`}
                >
                  {removingId === doc.id ? "…" : "✕"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
