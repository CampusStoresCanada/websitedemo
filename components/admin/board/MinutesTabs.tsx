"use client";

import { useState } from "react";
import MeetingDocumentEditor from "./MeetingDocumentEditor";

interface Props {
  meetingId:   string;
  minutesHtml: string | null;
  notionUrl:   string | null;
  isSA:        boolean;
  prevMeeting: { meeting_date: string; minutes_html: string | null } | null;
  minutesDraft: { status: string; error: string | null } | null;
}

type Tab = "current" | "past" | "scratchpad";

const TABS: { key: Tab; label: string }[] = [
  { key: "current",    label: "Current Meeting" },
  { key: "past",       label: "Past Meeting" },
  { key: "scratchpad", label: "Scratch Pad" },
];

export default function MinutesTabs({ meetingId, minutesHtml, notionUrl, isSA, prevMeeting, minutesDraft }: Props) {
  const [tab, setTab] = useState<Tab>("current");

  return (
    <div>
      {/* Subtab strip */}
      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-[#163D6D] text-[#163D6D]"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "current" && (
        // notionUrl omitted here — it lives in the Scratch Pad tab now
        <MeetingDocumentEditor
          meetingId={meetingId}
          docType="minutes"
          minutesDraft={minutesDraft}
          initialHtml={minutesHtml}
          notionUrl={null}
          isSA={isSA}
        />
      )}

      {tab === "past" && (
        prevMeeting ? (
          <div>
            <p className="text-xs text-gray-400 mb-4">
              Minutes from the {prevMeeting.meeting_date} meeting.
            </p>
            {prevMeeting.minutes_html ? (
              <div
                className="prose prose-sm prose-gray max-w-none rounded-xl border border-gray-200 bg-white px-5 py-4"
                dangerouslySetInnerHTML={{ __html: prevMeeting.minutes_html }}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
                <p className="text-sm text-gray-400">No minutes were published for that meeting.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
            <p className="text-sm text-gray-400">No previous meeting found.</p>
          </div>
        )
      )}

      {tab === "scratchpad" && (
        notionUrl ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-sm text-gray-500 mb-5">
              Live notes and draft content for this meeting live in Notion.
            </p>
            <a
              href={notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#163D6D] text-white text-sm font-medium hover:bg-[#163D6D]/90 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
              </svg>
              Open in Notion
            </a>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
            <p className="text-sm text-gray-400">No Notion page is linked to this meeting.</p>
            {isSA && (
              <p className="text-xs text-gray-400 mt-2">
                SA: link a Notion page from the board settings or the meeting record.
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
}
