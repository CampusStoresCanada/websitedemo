"use client";

import { useState, useRef, useCallback, useTransition } from "react";
import {
  uploadBoardDocument,
  deleteBoardDocument,
  type BoardDocumentType,
} from "@/lib/actions/board-meeting-event";
import DocumentDownloadLink from "@/components/admin/board/DocumentDownloadLink";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Doc {
  id: string;
  title: string;
  document_type: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  meetingId: string;
  initialDocs: Doc[];
  isSA: boolean;
}

const DEFAULT_DOC_TYPE: BoardDocumentType = "other";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fileIcon(mime: string | null): string {
  if (!mime) return "📄";
  if (mime.includes("pdf")) return "📄";
  if (mime.includes("word") || mime.includes("document")) return "📝";
  if (mime.includes("sheet") || mime.includes("excel")) return "📊";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "📑";
  return "📎";
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Delete button with confirm ───────────────────────────────────────────────

function DeleteButton({ docId, onDeleted }: { docId: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-xs text-gray-500">Remove?</span>
        <button
          type="button"
          disabled={deleting}
          onClick={() =>
            startDelete(async () => {
              await deleteBoardDocument(docId);
              onDeleted();
            })
          }
          className="text-xs font-medium text-red-600 hover:text-red-700"
        >
          {deleting ? "…" : "Yes"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title="Delete document"
      className="ml-2 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="w-4 h-4">
        <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9H3z" />
      </svg>
    </button>
  );
}

// ─── Upload button for a section ─────────────────────────────────────────────

function UploadButton({
  meetingId,
  docType,
  onUploaded,
}: {
  meetingId: string;
  docType: BoardDocumentType;
  onUploaded: (doc: Doc) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("meetingId", meetingId);
      fd.append("documentType", docType);
      fd.append("title", file.name.replace(/\.[^.]+$/, ""));
      const result = await uploadBoardDocument(fd);
      setUploading(false);
      if ("error" in result) {
        setError(result.error);
      } else {
        onUploaded(result.doc as Doc);
      }
    },
    [meetingId, docType, onUploaded],
  );

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {uploading ? (
          <>
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Uploading…
          </>
        ) : (
          <>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <path d="M8 2v9M4 6l4-4 4 4M2 13h12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Upload
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/jpeg,image/png"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function MeetingDocumentsPanel({ meetingId, initialDocs, isSA }: Props) {
  const [docs, setDocs] = useState<Doc[]>(initialDocs);

  const handleUploaded = (doc: Doc) => setDocs((prev) => [...prev, doc]);
  const handleDeleted  = (id: string) => setDocs((prev) => prev.filter((d) => d.id !== id));

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-700">Documents</h2>
        {isSA && (
          <UploadButton
            meetingId={meetingId}
            docType={DEFAULT_DOC_TYPE}
            onUploaded={handleUploaded}
          />
        )}
      </div>

      {docs.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="group flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg leading-none" aria-hidden>
                  {fileIcon(doc.mime_type)}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{doc.title}</div>
                  <div className="text-xs text-gray-400">
                    {formatBytes(doc.file_size_bytes)}
                    {doc.mime_type && <span className="mx-1 text-gray-300">·</span>}
                    {doc.mime_type && <span>{doc.mime_type.split("/").pop()?.toUpperCase()}</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <DocumentDownloadLink docId={doc.id} fileName={doc.title} />
                {isSA && (
                  <DeleteButton docId={doc.id} onDeleted={() => handleDeleted(doc.id)} />
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-gray-400">
          No documents uploaded yet.{isSA ? " Use the Upload button to add files." : ""}
        </p>
      )}
    </div>
  );
}
