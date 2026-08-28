"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import DocumentDownloadLink from "@/components/admin/board/DocumentDownloadLink";
import MeetingFinancialsTab from "@/components/admin/board/financials/MeetingFinancialsTab";
import MeetingRenewalsTab from "@/components/events/MeetingRenewalsTab";
import type { BoardRenewalReport } from "@/lib/renewal/board-report";
import type { RenewalSnapshot, RenewalDelta } from "@/lib/renewal/snapshot";
import type { AssignableMember } from "@/lib/renewal/outreach";
import { uploadBoardDocument } from "@/lib/actions/board-meeting-event";
import type { ComparativeReport } from "@/lib/quickbooks/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemStatus = "open" | "in_progress" | "complete" | "deferred";

interface ActionItem {
  id:             string;
  title:          string;
  description:    string | null;
  assignees:      string[];
  due_date:       string | null;
  status:         ItemStatus;
  complete_token: string;
}

interface BoardDoc {
  id:              string;
  title:           string;
  document_type:   string;
  mime_type:       string | null;
  file_size_bytes: number | null;
}

interface Profile {
  id:           string;
  display_name: string | null;
}

interface MeetingMeta {
  id:              string;
  meeting_date:    string;
  meeting_type:    string;
  status:          string;
  notes:           string | null;
  agenda_html:     string | null;
  minutes_html:    string | null;
  notion_page_url: string | null;
}

interface Props {
  meeting:         MeetingMeta;
  prevMinutes:     { meeting_date: string; minutes_html: string | null } | null;
  actionItems:     ActionItem[];
  docs:            BoardDoc[];
  profiles:        Profile[];
  currentUserId:   string | null;
  financialReport: ComparativeReport | null;
  /** Null when the meeting falls outside the board renewal window — tab is hidden. */
  renewalReport: BoardRenewalReport | null;
  renewalSnapshot: RenewalSnapshot | null;
  renewalDelta: RenewalDelta | null;
  assignableMembers: AssignableMember[];
  assignmentsByOrg: Record<string, string>;
  eventSlug: string;
  reportPeriod:    { start: string; end: string; label: string };
  isSA:            boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ItemStatus, string> = {
  open:        "Open",
  in_progress: "In Progress",
  complete:    "Complete",
  deferred:    "Deferred",
};

const STATUS_COLORS: Record<ItemStatus, string> = {
  open:        "bg-blue-100 text-blue-700",
  in_progress: "bg-purple-100 text-purple-700",
  complete:    "bg-green-100 text-green-700",
  deferred:    "bg-amber-100 text-amber-700",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  agenda:     "Agenda",
  minutes:    "Minutes",
  financials: "Financials",
  renewals: "Renewals",
  other:      "Other",
};

const DOC_TYPE_ORDER = ["agenda", "minutes", "financials", "other"];

function fileIcon(mimeType: string | null): string {
  if (!mimeType) return "📄";
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "📊";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "📑";
  return "📎";
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Action items sub-view ────────────────────────────────────────────────────

function ActionItemsView({ items, nameMap, currentUserId }: {
  items:         ActionItem[];
  nameMap:       Record<string, string>;
  currentUserId: string | null;
}) {
  const STATUS_ORDER: ItemStatus[] = ["open", "in_progress", "deferred", "complete"];

  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-8 text-center">No action items for this meeting.</p>
    );
  }

  // Within each status group, put the current user's items first
  function sortGroup(group: ActionItem[]): ActionItem[] {
    if (!currentUserId) return group;
    return [
      ...group.filter((i) => i.assignees.includes(currentUserId)),
      ...group.filter((i) => !i.assignees.includes(currentUserId)),
    ];
  }

  return (
    <div className="space-y-6">
      {currentUserId && items.some((i) => i.assignees.includes(currentUserId) && i.status !== "complete") && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 font-medium">
          ✋ Your items are shown first in each group.
        </div>
      )}
      {STATUS_ORDER.map((status) => {
        const group = sortGroup(items.filter((i) => i.status === status));
        if (group.length === 0) return null;
        return (
          <div key={status}>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {STATUS_LABELS[status]}
            </h3>
            <ul className="space-y-2">
              {group.map((item) => {
                const completeUrl   = `/api/board/action/${item.complete_token}`;
                const isMyItem      = currentUserId ? item.assignees.includes(currentUserId) : false;
                const assigneeNames = item.assignees
                  .map((id) => nameMap[id] ?? null)
                  .filter(Boolean) as string[];

                return (
                  <li
                    key={item.id}
                    className={`rounded-lg border px-4 py-3 ${isMyItem && item.status !== "complete" ? "border-blue-200 bg-blue-50/40" : "border-gray-200 bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isMyItem && item.status !== "complete" && (
                            <span className="text-xs font-semibold text-blue-600">You</span>
                          )}
                          <span className={`font-medium text-sm ${item.status === "complete" ? "line-through text-gray-400" : "text-gray-900"}`}>
                            {item.title}
                          </span>
                          <StatusBadge status={item.status} />
                        </div>

                        {item.description && (
                          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                            {item.description}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-3 mt-2">
                          {item.due_date && (
                            <span className="text-xs text-gray-400">Due: {item.due_date}</span>
                          )}
                          {assigneeNames.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {assigneeNames.map((name, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs"
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {item.status !== "complete" && (
                        <a
                          href={completeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-xs font-medium text-[#163D6D] hover:underline whitespace-nowrap"
                        >
                          ✅ Mark complete
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ─── Documents sub-view ───────────────────────────────────────────────────────

function DocumentsView({ meetingId, initialDocs }: { meetingId: string; initialDocs: BoardDoc[] }) {
  const [docs, setDocs] = useState<BoardDoc[]>(initialDocs);
  const [isPending, startTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("meetingId", meetingId);
    formData.set("documentType", "other");

    setUploadError(null);
    startTransition(async () => {
      const result = await uploadBoardDocument(formData);
      if ("error" in result) {
        setUploadError(result.error);
      } else {
        setDocs((prev) => [...prev, result.doc as BoardDoc]);
        form.reset();
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  const grouped: Record<string, BoardDoc[]> = {};
  for (const type of DOC_TYPE_ORDER) {
    grouped[type] = docs.filter((d) => d.document_type === type);
  }

  return (
    <div className="space-y-4">
      {/* Upload form — supplementary files only; agenda/minutes are managed in their own tabs */}
      <form onSubmit={handleUpload} className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Upload a supplementary file</p>
        <p className="text-xs text-gray-400 mb-3">Reports, presentations, reference docs, etc.</p>
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <div className="flex-1 min-w-0">
            <input
              ref={fileInputRef}
              type="file"
              name="file"
              required
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png"
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-white file:text-gray-700 file:border file:border-gray-300 hover:file:bg-gray-50 cursor-pointer"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="shrink-0 px-3 py-1.5 rounded bg-[#163D6D] text-white text-sm font-medium hover:bg-[#1a4d8a] disabled:opacity-50 transition-colors"
          >
            {isPending ? "Uploading…" : "Upload"}
          </button>
        </div>
        {uploadError && (
          <p className="mt-2 text-xs text-red-600">{uploadError}</p>
        )}
      </form>

      {/* Document list */}
      {docs.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No documents yet — upload one above.</p>
      ) : (
        DOC_TYPE_ORDER.map((type) => {
          const items = grouped[type];
          if (!items || items.length === 0) return null;
          return (
            <div key={type} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  {DOC_TYPE_LABELS[type]}
                </h3>
              </div>
              <ul className="divide-y divide-gray-100">
                {items.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg leading-none" aria-hidden>{fileIcon(doc.mime_type)}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{doc.title}</div>
                        {doc.file_size_bytes && (
                          <div className="text-xs text-gray-400">{formatBytes(doc.file_size_bytes)}</div>
                        )}
                      </div>
                    </div>
                    <DocumentDownloadLink docId={doc.id} fileName={doc.title} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type TabKey = "agenda" | "minutes" | "actions" | "documents" | "financials" | "renewals";

// ─── Minutes subtabs view ─────────────────────────────────────────────────────

type MinutesSubtab = "current" | "past" | "scratchpad";

function MinutesView({
  meeting,
  prevMinutes,
}: {
  meeting:     MeetingMeta;
  prevMinutes: { meeting_date: string; minutes_html: string | null } | null;
}) {
  // Until this meeting has minutes there is nothing to read on "Current" — and
  // the thing people actually want in that window is the last meeting's
  // minutes, which is what item 3 of every agenda asks them to approve.
  const [sub, setSub] = useState<MinutesSubtab>(
    meeting.minutes_html ? "current" : prevMinutes?.minutes_html ? "past" : "current"
  );

  const subtabs: { key: MinutesSubtab; label: string }[] = [
    { key: "current",    label: "Current Meeting" },
    { key: "past",       label: "Past Meeting" },
    { key: "scratchpad", label: "Scratch Pad" },
  ];

  return (
    <div>
      {/* Subtab strip */}
      <div className="flex gap-0 border-b border-gray-200 mb-4">
        {subtabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              sub === t.key
                ? "border-[#163D6D] text-[#163D6D]"
                : "border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === "current" && (
        meeting.minutes_html ? (
          <div className="prose prose-gray max-w-none" dangerouslySetInnerHTML={{ __html: meeting.minutes_html }} />
        ) : (
          <p className="text-sm text-gray-400 py-8 text-center">Minutes have not been published yet.</p>
        )
      )}

      {sub === "past" && (
        prevMinutes ? (
          <div>
            <p className="text-xs text-gray-400 mb-4">Minutes from the {prevMinutes.meeting_date} meeting.</p>
            {prevMinutes.minutes_html ? (
              <div className="prose prose-gray max-w-none" dangerouslySetInnerHTML={{ __html: prevMinutes.minutes_html }} />
            ) : (
              <p className="text-sm text-gray-400 py-8 text-center">No minutes were published for that meeting.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 py-8 text-center">No previous meeting found.</p>
        )
      )}

      {sub === "scratchpad" && (
        meeting.notion_page_url ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
            <p className="text-sm text-gray-500 mb-4">Live notes and draft content for this meeting live in Notion.</p>
            <a
              href={meeting.notion_page_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#163D6D] text-white text-sm font-medium hover:bg-[#1a4d8a] transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
              </svg>
              Open in Notion
            </a>
          </div>
        ) : (
          <p className="text-sm text-gray-400 py-8 text-center">No Notion page is linked to this meeting.</p>
        )
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BoardMeetingSection({
  meeting,
  prevMinutes,
  actionItems,
  docs,
  profiles,
  currentUserId,
  financialReport,
  renewalReport,
  renewalSnapshot,
  renewalDelta,
  assignableMembers,
  assignmentsByOrg,
  eventSlug,
  reportPeriod,
  isSA,
}: Props) {
  const nameMap = Object.fromEntries(
    profiles.map((p) => [p.id, p.display_name ?? "Unknown"])
  );

  const openCount  = actionItems.filter((i) => i.status === "open" || i.status === "in_progress").length;
  const myOpenCount = currentUserId
    ? actionItems.filter((i) => (i.status === "open" || i.status === "in_progress") && i.assignees.includes(currentUserId)).length
    : 0;

  // Renewals is the first conditional tab — it appears only for meetings inside
  // the board renewal window (see resolveBoardRenewalWindow). Every other tab
  // renders unconditionally, so this is a filter rather than a push.
  const allTabs: { key: TabKey; label: string; count?: number; badge?: number }[] = [
    { key: "agenda",     label: "Agenda" },
    { key: "minutes",    label: "Minutes" },
    { key: "actions",    label: "Action Items", count: actionItems.length, badge: myOpenCount },
    ...(renewalReport
      ? [{
          key: "renewals" as TabKey,
          label: "Renewals",
          count: renewalReport.totals.outstandingCount,
        }]
      : []),
    { key: "financials", label: "Financials" },
    { key: "documents",  label: "Documents",    count: docs.length },
  ];

  // Falls through in the same order the tabs are shown, so the first tab with
  // anything in it is also the leftmost one that has anything in it.
  const firstWithContent: TabKey =
    meeting.agenda_html    ? "agenda"   :
    meeting.minutes_html   ? "minutes"  :
    actionItems.length > 0 ? "actions"  :
    renewalReport          ? "renewals" :
    docs.length > 0        ? "documents":
    "financials";

  const [activeTab, setActiveTab] = useState<TabKey>(firstWithContent);

  const meetingTypeLabel =
    meeting.meeting_type === "agm"     ? "AGM" :
    meeting.meeting_type === "special" ? "Special Meeting" :
    "Regular Meeting";

  return (
    <div className="mt-6">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-3 mb-5">
        <h2 className="text-lg font-bold text-gray-900">Board Meeting Materials</h2>
        <span className="text-sm text-gray-400">{meetingTypeLabel} · {meeting.meeting_date}</span>
        {myOpenCount > 0 && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
            {myOpenCount} open action{myOpenCount !== 1 ? "s" : ""} assigned to you
          </span>
        )}
      </div>

      {/* Notes banner */}
      {meeting.notes && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {meeting.notes}
        </div>
      )}

      {/* Tab strip */}
      <div className="flex flex-wrap gap-x-0 gap-y-0 border-b border-gray-200 mb-5">
        {allTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap flex items-center gap-1 ${
              activeTab === tab.key
                ? "border-[#163D6D] text-[#163D6D]"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 font-medium ${
                activeTab === tab.key ? "bg-[#163D6D]/10 text-[#163D6D]" : "bg-gray-100 text-gray-500"
              }`}>
                {tab.count}
              </span>
            )}
            {/* Dot indicator for user's own outstanding items */}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "agenda" && (
        meeting.agenda_html ? (
          <div
            className="prose prose-gray max-w-none"
            dangerouslySetInnerHTML={{ __html: meeting.agenda_html }}
          />
        ) : (
          <p className="text-sm text-gray-400 py-8 text-center">No agenda has been published for this meeting yet.</p>
        )
      )}

      {activeTab === "minutes" && (
        <MinutesView meeting={meeting} prevMinutes={prevMinutes} />
      )}

      {activeTab === "actions" && (
        <ActionItemsView items={actionItems} nameMap={nameMap} currentUserId={currentUserId} />
      )}

      {activeTab === "documents" && (
        <DocumentsView meetingId={meeting.id} initialDocs={docs} />
      )}

      {activeTab === "financials" && (
        <MeetingFinancialsTab
          report={financialReport}
          reportPeriod={reportPeriod}
          meetingId={meeting.id}
          isSA={isSA}
          compact
        />
      )}

      {activeTab === "renewals" && renewalReport && (
        <MeetingRenewalsTab
          report={renewalReport}
          snapshot={renewalSnapshot}
          delta={renewalDelta}
          meetingId={meeting.id}
          meetingDate={meeting.meeting_date}
          eventSlug={eventSlug}
          assignableMembers={assignableMembers}
          assignmentsByOrg={assignmentsByOrg}
        />
      )}
    </div>
  );
}
