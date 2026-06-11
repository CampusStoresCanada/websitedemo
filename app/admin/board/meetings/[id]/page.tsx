/**
 * /admin/board/meetings/[id]  — Single board meeting with tabs
 * Tabs: Documents | Financials | Action Items
 */

import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMeetingFinancialReport } from "@/lib/quickbooks/reports";
import { getLastFullMonth } from "@/lib/quickbooks/fiscal";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import PullFinancialsButton from "@/components/admin/board/PullFinancialsButton";
import MeetingFinancialsTab from "@/components/admin/board/financials/MeetingFinancialsTab";
import MeetingTabs from "@/components/admin/board/MeetingTabs";
import ActionItemsPanel from "@/components/admin/board/ActionItemsPanel";
import MeetingDocumentEditor from "@/components/admin/board/MeetingDocumentEditor";
import MinutesTabs from "@/components/admin/board/MinutesTabs";
import CancelMeetingButton from "@/components/admin/board/CancelMeetingButton";
import MeetingDocumentsPanel from "@/components/admin/board/MeetingDocumentsPanel";
import LinkEventButton from "@/components/admin/board/LinkEventButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    upcoming:  "bg-blue-100 text-blue-700",
    completed: "bg-gray-100 text-gray-500",
    cancelled: "bg-red-100 text-red-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

type TabKey = "agenda" | "minutes" | "documents" | "financials" | "actions";

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params:       Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const auth = await requireAdmin();
  const isSA = auth.ok && isSuperAdmin(auth.ctx.globalRole);

  const { id }  = await params;
  const sp      = await searchParams;
  const activeTab = ((sp.tab as TabKey) || "agenda") as TabKey;

  const db = createAdminClient();

  const meetingRes = await db
    .from("board_meetings")
    .select("id, title, meeting_date, meeting_type, status, notes, created_at, notion_page_url, agenda_html, minutes_html, event_id")
    .eq("id", id)
    .maybeSingle();

  if (!meetingRes.data) notFound();
  const meeting = meetingRes.data;

  const eventId = (meeting as Record<string, string | null>)["event_id"] ?? null;

  // Fetch the linked event slug so we can build deep links
  let eventSlug: string | null = null;
  if (eventId) {
    const { data: ev } = await db.from("events").select("slug").eq("id", eventId).maybeSingle();
    eventSlug = ev?.slug ?? null;
  }

  const [docsRes, actionsRes, prevMeetingRes] = await Promise.all([
    db
      .from("board_documents")
      .select("id, title, document_type, mime_type, file_size_bytes, storage_path, created_at, updated_at")
      .eq("meeting_id", id)
      .order("document_type")
      .order("title"),
    db
      .from("board_action_items")
      .select("id, title, description, assignees, due_date, status, sort_order, complete_token, created_at")
      .eq("meeting_id", id)
      .order("sort_order")
      .order("created_at"),
    db
      .from("board_meetings")
      .select("meeting_date, minutes_html")
      .lt("meeting_date", meeting.meeting_date)
      .order("meeting_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const docs        = docsRes.data ?? [];
  const actionItems = actionsRes.data ?? [];
  const prevMeeting = prevMeetingRes.data ?? null;

  // Financial report: frozen to last closed month before the meeting date
  const reportPeriod = getLastFullMonth(meeting.meeting_date);

  // Only fetch the financial report when on that tab
  const financialReport = activeTab === "financials"
    ? await getMeetingFinancialReport(meeting.id)
    : null;

  const agendaHtml  = (meeting as Record<string, string | null>)["agenda_html"]  ?? null;
  const minutesHtml = (meeting as Record<string, string | null>)["minutes_html"] ?? null;
  const notionUrl   = (meeting as Record<string, string | null>)["notion_page_url"] ?? null;

  const meetingTypeLabel =
    meeting.meeting_type === "agm"     ? "AGM" :
    meeting.meeting_type === "special" ? "Special Meeting" :
    "Regular Meeting";

  // Tab-specific header actions
  const headerActions = (
    <div className="flex items-center gap-2">
      {isSA && activeTab === "financials" && (
        <PullFinancialsButton
          meetingId={meeting.id}
          endDate={reportPeriod.end}
        />
      )}
      {isSA && <CancelMeetingButton meetingId={meeting.id} currentStatus={meeting.status} />}
      <Link
        href="/admin/board/meetings"
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        ← All meetings
      </Link>
    </div>
  );

  return (
    <main>
      <AdminPageHeader
        title={`Board Meeting — ${meeting.meeting_date}`}
        description={`${meetingTypeLabel} · ${docs.length} document${docs.length !== 1 ? "s" : ""}`}
        actions={headerActions}
      />

      {/* Meeting meta */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-gray-600">
        <StatusBadge status={meeting.status} />
        <span className="text-gray-400">·</span>
        <span>{meetingTypeLabel}</span>
        <span className="text-gray-400">·</span>
        <span>{meeting.meeting_date}</span>
        <span className="text-gray-400">·</span>
        <LinkEventButton
          meetingId={meeting.id}
          eventId={eventId}
          eventSlug={eventSlug}
          isSA={isSA}
        />
      </div>

      {/* Notes */}
      {meeting.notes && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {meeting.notes}
        </div>
      )}

      {/* Tab strip — client component for active highlight */}
      <Suspense>
        <MeetingTabs meetingId={meeting.id} />
      </Suspense>

      {/* ── Agenda tab ── */}
      {activeTab === "agenda" && (
        <MeetingDocumentEditor
          meetingId={meeting.id}
          docType="agenda"
          initialHtml={agendaHtml}
          notionUrl={notionUrl}
          isSA={isSA}
        />
      )}

      {/* ── Minutes tab ── */}
      {activeTab === "minutes" && (
        <MinutesTabs
          meetingId={meeting.id}
          minutesHtml={minutesHtml}
          notionUrl={notionUrl}
          isSA={isSA}
          prevMeeting={prevMeeting}
        />
      )}

      {/* ── Documents tab ── */}
      {activeTab === "documents" && (
        <MeetingDocumentsPanel
          meetingId={meeting.id}
          initialDocs={docs}
          isSA={isSA}
        />
      )}

      {/* ── Financials tab ── */}
      {activeTab === "financials" && (
        <MeetingFinancialsTab
          report={financialReport}
          reportPeriod={reportPeriod}
          meetingId={meeting.id}
          isSA={isSA}
        />
      )}

      {/* ── Action Items tab ── */}
      {activeTab === "actions" && (
        <ActionItemsPanel
          meetingId={meeting.id}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items={actionItems as any}
          isSA={isSA}
        />
      )}
    </main>
  );
}
