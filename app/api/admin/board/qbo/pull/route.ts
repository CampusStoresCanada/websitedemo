/**
 * POST /api/admin/board/qbo/pull
 *
 * Manual "pull financial reports now" trigger for the board dashboard.
 * Super admin only — this hits a live QBO API.
 *
 * Body (all optional):
 *   startDate  — YYYY-MM-DD (default: first of current month)
 *   endDate    — YYYY-MM-DD (default: today)
 *   meetingId  — UUID of a board_meeting to link this snapshot to
 *   accountingMethod — "Accrual" | "Cash" (default: "Accrual")
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { pullAndCacheQBOReports } from "@/lib/quickbooks/reports";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { logAuditEventSafe } from "@/lib/ops/audit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return NextResponse.json({ error: "Super admin required" }, { status: 403 });
  }

  let body: Record<string, string> = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — all params are optional
  }

  const { startDate, endDate, meetingId, accountingMethod } = body;

  try {
    const { summary, snapshotId } = await pullAndCacheQBOReports({
      startDate,
      endDate,
      meetingId,
      accountingMethod: accountingMethod as "Accrual" | "Cash" | undefined,
    });

    await logAuditEventSafe({
      action:     "qbo_report_pull",
      entityType: "board_qbo_snapshots",
      entityId:   snapshotId,
      actorId:    auth.ctx.userId,
      actorType:  "user",
      details:    {
        snapshotId,
        periodStart: summary.periodStart,
        periodEnd:   summary.periodEnd,
        meetingId:   meetingId ?? null,
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, snapshotId, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    await raiseAlertIfNotOpen({
      ruleKey:  "qbo_report_pull_failed",
      severity: "warning",
      message:  `QBO report pull failed: ${message}`,
      details:  { error: message },
    }).catch(() => {});

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
