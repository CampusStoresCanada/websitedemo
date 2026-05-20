/**
 * POST /api/admin/onedrive/sync
 *
 * Manual "sync now" trigger. Also called by the daily cron.
 * Super admin only.
 */

import { NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { syncOneDriveDocuments } from "@/lib/onedrive/sync";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return NextResponse.json({ error: "Super admin required" }, { status: 403 });
  }

  try {
    const result = await syncOneDriveDocuments();

    if (result.errors.length > 0) {
      // Raise an ops alert for sync errors but still return the partial result
      await raiseAlertIfNotOpen({
        ruleKey:  "onedrive_sync_errors",
        severity: result.errors.length > 3 ? "critical" : "warning",
        message:  `OneDrive sync completed with ${result.errors.length} error(s)`,
        details:  { errors: result.errors.slice(0, 5) },
      }).catch(() => {/* don't let alert failure mask the sync result */});
    }

    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    await raiseAlertIfNotOpen({
      ruleKey:  "onedrive_sync_failed",
      severity: "critical",
      message:  `OneDrive sync failed: ${message}`,
      details:  { error: message },
    }).catch(() => {});

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
