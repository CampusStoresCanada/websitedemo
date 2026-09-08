"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { requestMinutesDraft, loadMinutesDraft } from "@/lib/actions/board-minutes";
import dynamic from "next/dynamic";

const RichTextEditor = dynamic(() => import("@/components/ui/RichTextEditor"), { ssr: false });

type DocType = "agenda" | "minutes";

interface Props {
  meetingId:   string;
  docType:     DocType;
  initialHtml: string | null;
  notionUrl:   string | null;
  isSA:        boolean;
  minutesDraft?: { status: string; error: string | null } | null;
}

const LABELS: Record<DocType, { title: string; placeholder: string }> = {
  agenda:  { title: "Agenda",  placeholder: "Start writing the agenda…" },
  minutes: { title: "Minutes", placeholder: "Start writing the minutes…" },
};

interface RecapResponse {
  drafted: boolean;
  id: string | null;
  counts: { decided: number; outstanding: number; nextMeeting: number };
  note: string | null;
}

/**
 * What Butler has to say about the save, if anything.
 *
 * `note` carries the reason nothing was consumed — a locked draft, a failed
 * write. Those matter more than the happy path, because in each of them the
 * tag block is still sitting in the minutes and the person needs to know why.
 */
function recapNotice(recap: RecapResponse | null | undefined): string | null {
  if (!recap) return null;
  if (recap.note) return recap.note;
  if (!recap.drafted) return null;

  const { decided, outstanding, nextMeeting } = recap.counts;
  const parts = [
    decided ? `${decided} decided` : null,
    outstanding ? `${outstanding} outstanding` : null,
    nextMeeting ? `${nextMeeting} for next meeting` : null,
  ].filter(Boolean);

  return `Butler Ghost drafted a recap (${parts.join(", ")}) and removed the tags from the minutes. It is waiting for your review.`;
}

export default function MeetingDocumentEditor({
  meetingId,
  docType,
  initialHtml,
  notionUrl,
  isSA,
  minutesDraft = null,
}: Props) {
  const router = useRouter();
  const [html,    setHtml]    = useState(initialHtml ?? "");
  const [dirty,   setDirty]   = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [recapMsg, setRecapMsg] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);

  const { title, placeholder } = LABELS[docType];

  const handleChange = useCallback((value: string) => {
    setHtml(value);
    setDirty(true);
    setSaveMsg(null);
    setRecapMsg(null);
  }, []);

  async function handleRequestDraft() {
    setDrafting(true);
    setDraftMsg(null);
    try {
      const result = await requestMinutesDraft(meetingId);
      setDraftMsg(result.ok ? result.message ?? "Requested." : result.error ?? "Could not request a draft.");
      if (result.ok) router.refresh();
    } finally {
      setDrafting(false);
    }
  }

  async function handleLoadDraft() {
    // Loading replaces whatever is in the editor. The draft itself is only
    // offered when the meeting has no saved minutes, but unsaved typing is
    // visible only here, so this is the one place it can be protected.
    if (html.trim() && !confirm("Replace what's currently in the editor with the drafted minutes?")) {
      return;
    }
    setDrafting(true);
    setDraftMsg(null);
    setAssumptions([]);
    try {
      const result = await loadMinutesDraft(meetingId);
      if (!result.ok || !result.html) {
        setDraftMsg(result.error ?? "Could not load the draft.");
        return;
      }
      setHtml(result.html);
      setDirty(true);
      setSaveMsg(null);
      setRecapMsg(null);
      setAssumptions(result.assumptions ?? []);
      setDraftMsg("Loaded — nothing is saved yet. Read it, check the judgment calls, then Save.");
    } finally {
      setDrafting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/board/meetings/${meetingId}/content`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ docType, html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");

      // The server normalises what it stores: it rewrites bare names to
      // canonical @mentions, and it REMOVES the DECIDED / OUTSTANDING /
      // NEXT MEETING tags once Butler has them. Local state would otherwise
      // keep showing a block that no longer exists in the database, which
      // reads as a failed save and invites a pointless re-save.
      if (typeof data.html === "string") setHtml(data.html);

      setDirty(false);
      setSaveMsg("Saved");
      setRecapMsg(recapNotice(data.recap));
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
            {docType === "minutes" && !html.trim() && minutesDraft?.status === "submitted" && (
              <span className="text-xs text-gray-500">Drafting… Butler will DM you</span>
            )}
            {docType === "minutes" && minutesDraft?.status === "ready" && (
              <button
                onClick={handleLoadDraft}
                disabled={drafting || saving}
                className="rounded-md bg-[#163D6D]/10 px-3 py-1.5 text-sm font-medium text-[#163D6D] hover:bg-[#163D6D]/20 disabled:opacity-40 transition-colors"
              >
                {drafting ? "Loading…" : "Load drafted minutes"}
              </button>
            )}
            {docType === "minutes" && minutesDraft?.status !== "submitted" && minutesDraft?.status !== "ready" && (
              <button
                onClick={handleRequestDraft}
                disabled={drafting || saving}
                className="rounded-md border border-[#163D6D]/30 px-3 py-1.5 text-sm font-medium text-[#163D6D] hover:bg-[#163D6D]/5 disabled:opacity-40 transition-colors"
              >
                {drafting ? "Requesting…" : minutesDraft?.status === "failed" ? "Retry draft" : "Draft from transcript"}
              </button>
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

      {!draftMsg && minutesDraft?.status === "failed" && minutesDraft.error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          The last drafting attempt failed: {minutesDraft.error}
        </div>
      )}

      {draftMsg && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          {draftMsg}
        </div>
      )}

      {assumptions.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold mb-1">
            Judgment calls made while drafting — check these first:
          </p>
          <ul className="list-disc pl-4 space-y-0.5">
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {recapMsg && (
        <div className="mb-3 rounded-lg border border-[#163D6D]/20 bg-[#163D6D]/5 px-3 py-2 text-xs text-[#163D6D]">
          {recapMsg}
          {" "}
          <a href="/admin/board/recaps" className="font-medium underline underline-offset-2">
            Review it
          </a>
        </div>
      )}

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
