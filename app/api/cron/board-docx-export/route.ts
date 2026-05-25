/**
 * GET /api/cron/board-docx-export
 *
 * Runs on the 15th of each month at midnight UTC.
 * Finds board meetings from the prior month that have agenda or minutes content,
 * exports them to DOCX, and pushes to OneDrive.
 *
 * Schedule: 0 0 15 * *  (15th of every month, midnight UTC)
 * Auth: Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exportMeetingToOneDrive } from "@/lib/board/docx-export";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

function getPriorMonthRange(): { start: string; end: string } {
  const now   = new Date();
  // First day of current month
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Last day of prior month = day before first of current month
  const last  = new Date(first.getTime() - 86400_000);
  // First day of prior month
  const start = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1));

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(last) };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();

  // Load OneDrive config
  const { data: settings } = await db
    .from("app_settings")
    .select("key, value")
    .in("key", ["onedrive_drive_id", "onedrive_board_folder_path"]);

  const settingsMap: Record<string, string> = {};
  for (const row of settings ?? []) settingsMap[row.key] = row.value ?? "";

  const driveId    = settingsMap["onedrive_drive_id"];
  const boardFolder = settingsMap["onedrive_board_folder_path"] || "Board Meetings";

  if (!driveId) {
    console.warn("[board-docx-export] onedrive_drive_id not configured — skipping OneDrive push");
  }

  // Find meetings from the prior month with content
  const { start, end } = getPriorMonthRange();

  const { data: meetings, error } = await db
    .from("board_meetings")
    .select("id, meeting_date, agenda_html, minutes_html")
    .gte("meeting_date", start)
    .lte("meeting_date", end)
    .or("agenda_html.not.is.null,minutes_html.not.is.null");

  if (error) {
    console.error("[board-docx-export] DB query failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];
  const allErrors: string[] = [];

  for (const meeting of meetings ?? []) {
    if (!driveId) {
      // No OneDrive configured — log but don't fail
      results.push({ meetingId: meeting.id, skipped: "no_drive_id" });
      continue;
    }

    const result = await exportMeetingToOneDrive(
      {
        meetingId:   meeting.id,
        meetingDate: meeting.meeting_date,
        agendaHtml:  (meeting as Record<string, string | null>)["agenda_html"] ?? null,
        minutesHtml: (meeting as Record<string, string | null>)["minutes_html"] ?? null,
      },
      driveId,
      boardFolder
    );

    results.push(result);
    allErrors.push(...result.errors);
  }

  if (allErrors.length > 0) {
    await raiseAlertIfNotOpen({
      ruleKey:  "board_docx_export_errors",
      severity: "warning",
      message:  `Board DOCX export completed with ${allErrors.length} error(s)`,
      details:  { errors: allErrors.slice(0, 10), period: { start, end } },
    }).catch(() => {});
  }

  await logAuditEventSafe({
    action:     "cron_board_docx_export",
    entityType: "board_meetings",
    actorType:  "cron",
    details:    { period: { start, end }, meetings: results.length, errors: allErrors.length },
  }).catch(() => {});

  return NextResponse.json({
    success:  true,
    period:   { start, end },
    meetings: results,
    errors:   allErrors,
  });
}
