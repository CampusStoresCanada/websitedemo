"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const RichTextEditor = dynamic(() => import("@/components/ui/RichTextEditor"), { ssr: false });

type DocType = "agenda" | "minutes";

interface Props {
  meetingId:   string;
  docType:     DocType;
  initialHtml: string | null;
  notionUrl:   string | null;
  isSA:        boolean;
}

const LABELS: Record<DocType, { title: string; placeholder: string }> = {
  agenda:  { title: "Agenda",  placeholder: "Start writing the agenda…" },
  minutes: { title: "Minutes", placeholder: "Start writing the minutes…" },
};

export default function MeetingDocumentEditor({
  meetingId,
  docType,
  initialHtml,
  notionUrl,
  isSA,
}: Props) {
  const router = useRouter();
  const [html,    setHtml]    = useState(initialHtml ?? "");
  const [dirty,   setDirty]   = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const { title, placeholder } = LABELS[docType];

  const handleChange = useCallback((value: string) => {
    setHtml(value);
    setDirty(true);
    setSaveMsg(null);
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/board/meetings/${meetingId}/content`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ docType, html }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }
      setDirty(false);
      setSaveMsg("Saved");
      router.refresh();
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
          {notionUrl && (
            <a
              href={notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Open Notion scratchpad ↗
            </a>
          )}
        </div>
        {isSA && (
          <div className="flex items-center gap-3">
            {saveMsg && (
              <span className={`text-xs ${saveMsg === "Saved" ? "text-green-600" : "text-red-500"}`}>
                {saveMsg}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90 disabled:opacity-40 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {/* Editor or read-only view */}
      {isSA ? (
        <RichTextEditor
          value={html}
          onChange={handleChange}
          placeholder={placeholder}
          minHeight="300px"
        />
      ) : html ? (
        <div
          className="prose prose-sm prose-gray max-w-none rounded-xl border border-gray-200 bg-white px-5 py-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-gray-400">No {title.toLowerCase()} has been drafted yet.</p>
        </div>
      )}
    </div>
  );
}
