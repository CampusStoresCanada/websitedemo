"use client";

import { useState, useRef, useEffect, useCallback, useTransition } from "react";
import {
  getBoardMeetingForEvent,
  upsertBoardMeetingForEvent,
  uploadBoardDocument,
  deleteBoardDocument,
  type BoardMeetingRow,
  type BoardDocumentRow,
  type BoardDocumentType,
} from "@/lib/actions/board-meeting-event";

// ─── Constants ────────────────────────────────────────────────────────────────

const MEETING_TYPES = [
  { value: "regular", label: "Regular Meeting" },
  { value: "special", label: "Special Meeting" },
  { value: "agm",     label: "AGM" },
] as const;

const DOC_SLOTS: { type: BoardDocumentType; label: string; icon: string; hint: string }[] = [
  { type: "agenda",     label: "Agenda",          icon: "📋", hint: "Meeting agenda" },
  { type: "minutes",    label: "Past Minutes",    icon: "📝", hint: "Minutes from the previous meeting" },
  { type: "financials", label: "Financials",      icon: "📊", hint: "Financial statements or reports" },
  { type: "other",      label: "Supporting Docs", icon: "📎", hint: "Any other required materials" },
];

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mime: string | null): string {
  if (!mime) return "📄";
  if (mime.includes("pdf")) return "📄";
  if (mime.includes("word") || mime.includes("document")) return "📝";
  if (mime.includes("sheet") || mime.includes("excel")) return "📊";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "📑";
  return "📎";
}

// ─── Single document row ──────────────────────────────────────────────────────

function DocRow({
  doc,
  onDelete,
}: {
  doc: BoardDocumentRow;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-gray-50 group">
      <span className="text-base leading-none">{mimeIcon(doc.mime_type)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate">{doc.title}</p>
        {doc.file_size_bytes && (
          <p className="text-xs text-gray-400">{formatBytes(doc.file_size_bytes)}</p>
        )}
      </div>
      {confirming ? (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs text-gray-500">Remove?</span>
          <button
            type="button"
            disabled={deleting}
            onClick={() =>
              startDelete(async () => {
                await deleteBoardDocument(doc.id);
                onDelete(doc.id);
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
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all flex-shrink-0"
          title="Remove"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9H3z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Upload slot ──────────────────────────────────────────────────────────────

function UploadSlot({
  slot,
  meetingId,
  docs,
  onUploaded,
  onDeleted,
}: {
  slot: (typeof DOC_SLOTS)[number];
  meetingId: string;
  docs: BoardDocumentRow[];
  onUploaded: (doc: BoardDocumentRow) => void;
  onDeleted: (id: string) => void;
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
      fd.append("documentType", slot.type);
      fd.append("title", file.name.replace(/\.[^.]+$/, ""));
      const result = await uploadBoardDocument(fd);
      setUploading(false);
      if ("error" in result) {
        setError(result.error);
      } else {
        onUploaded(result.doc);
      }
    },
    [meetingId, slot.type, onUploaded],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{slot.icon}</span>
          <div>
            <p className="text-sm font-medium text-gray-700">{slot.label}</p>
            <p className="text-xs text-gray-400">{slot.hint}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {uploading ? (
            <>
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Uploading…
            </>
          ) : (
            <>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                <path d="M8 2v9M4 6l4-4 4 4M2 13h12" strokeLinecap="round" strokeLinejoin="round"/>
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

      {error && <p className="text-xs text-red-600">{error}</p>}

      {docs.length > 0 && (
        <div className="space-y-1 pl-6">
          {docs.map((doc) => (
            <DocRow key={doc.id} doc={doc} onDelete={onDeleted} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface BoardMeetingDocumentsProps {
  eventId: string;
  eventTitle: string;
  eventDate: string; // ISO string (starts_at)
}

export default function BoardMeetingDocuments({
  eventId,
  eventTitle,
  eventDate,
}: BoardMeetingDocumentsProps) {
  const [meeting, setMeeting] = useState<BoardMeetingRow | null>(null);
  const [meetingType, setMeetingType] = useState<"regular" | "special" | "agm">("regular");
  const [loading, setLoading] = useState(true);
  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load existing meeting
  useEffect(() => {
    getBoardMeetingForEvent(eventId).then((m) => {
      if (m) {
        setMeeting(m);
        setMeetingType(m.meeting_type as "regular" | "special" | "agm");
      }
      setLoading(false);
    });
  }, [eventId]);

  const handleCreateOrUpdate = () => {
    setSaveError(null);
    startSave(async () => {
      const dateStr = eventDate
        ? new Date(eventDate.includes("T") || eventDate.endsWith("Z") ? eventDate : eventDate.replace(" ", "T") + "Z")
            .toISOString()
            .slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const result = await upsertBoardMeetingForEvent(eventId, {
        meetingType,
        title: eventTitle || "Board Meeting",
        meetingDate: dateStr,
      });

      if ("error" in result) {
        setSaveError(result.error);
        return;
      }

      // Reload
      const updated = await getBoardMeetingForEvent(eventId);
      setMeeting(updated);
    });
  };

  const handleDocUploaded = (type: BoardDocumentType, doc: BoardDocumentRow) => {
    setMeeting((prev) =>
      prev ? { ...prev, documents: [...prev.documents, doc] } : prev,
    );
  };

  const handleDocDeleted = (docId: string) => {
    setMeeting((prev) =>
      prev ? { ...prev, documents: prev.documents.filter((d) => d.id !== docId) } : prev,
    );
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-400">
        Loading board meeting…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#163D6D]/20 bg-[#163D6D]/5 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-lg">🏛️</span>
        <div>
          <p className="text-sm font-semibold text-[#163D6D]">Board Meeting</p>
          <p className="text-xs text-[#163D6D]/60">
            {meeting ? "Linked to Board Portal" : "Not yet linked to Board Portal"}
          </p>
        </div>
        {meeting && (
          <a
            href={`/admin/board/meetings/${meeting.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-[#163D6D] hover:underline font-medium"
          >
            View in Board Portal →
          </a>
        )}
      </div>

      {/* Meeting type + link/update */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Meeting type</label>
          <select
            value={meetingType}
            onChange={(e) => setMeetingType(e.target.value as typeof meetingType)}
            className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#163D6D]"
          >
            {MEETING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleCreateOrUpdate}
          disabled={saving}
          className="rounded-lg bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {saving ? "Saving…" : meeting ? "Update" : "Link to Board Portal"}
        </button>
      </div>

      {saveError && <p className="text-xs text-red-600">{saveError}</p>}

      {/* Document upload slots — only once linked */}
      {meeting ? (
        <div className="space-y-4 pt-2 border-t border-[#163D6D]/10">
          {DOC_SLOTS.map((slot) => (
            <UploadSlot
              key={slot.type}
              slot={slot}
              meetingId={meeting.id}
              docs={meeting.documents.filter((d) => d.document_type === slot.type)}
              onUploaded={(doc) => handleDocUploaded(slot.type, doc)}
              onDeleted={handleDocDeleted}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#163D6D]/50 italic">
          Click "Link to Board Portal" to enable document uploads for this meeting.
        </p>
      )}
    </div>
  );
}
