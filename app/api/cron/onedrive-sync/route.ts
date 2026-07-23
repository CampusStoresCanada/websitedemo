/**
 * GET /api/cron/onedrive-sync
 *
 * Daily cron — syncs board documents from OneDrive into Supabase Storage.
 * Also checks the Entra ID client secret expiry and emails super admins
 * if within 14 days.
 *
 * Schedule: daily (e.g. 06:00 UTC)
 * Auth: Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { syncOneDriveDocuments, daysUntilSecretExpiry } from "@/lib/onedrive/sync";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { sendEmail } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const EXPIRY_WARN_DAYS = 14;

async function getSuperAdminEmails(): Promise<string[]> {
  const db = createAdminClient();
  const { data: profiles } = await db
    .from("profiles")
    .select("id")
    .eq("global_role", "super_admin");

  if (!profiles?.length) return [];

  const ids = profiles.map((p: { id: string }) => p.id);
  const emailMap = await lookupUserEmailsByIds(db, ids);
  return Object.values(emailMap);
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: Record<string, unknown> = {};

  // ── 1. OneDrive sync ─────────────────────────────────────────────
  try {
    const result = await syncOneDriveDocuments();
    log.sync = result;

    if (result.errors.length > 0) {
      await raiseAlertIfNotOpen({
        ruleKey:  "onedrive_sync_errors",
        severity: result.errors.length > 3 ? "critical" : "warning",
        message:  `OneDrive sync completed with ${result.errors.length} error(s)`,
        details:  { errors: result.errors.slice(0, 5) },
      }).catch(() => {});
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.syncError = message;

    await raiseAlertIfNotOpen({
      ruleKey:  "onedrive_sync_failed",
      severity: "critical",
      message:  `OneDrive sync failed: ${message}`,
      details:  { error: message },
    }).catch(() => {});
  }

  // ── 2. Entra ID secret expiry check ──────────────────────────────
  try {
    const days = daysUntilSecretExpiry();
    log.secretExpiryDays = days;

    if (days !== null && days <= EXPIRY_WARN_DAYS) {
      const emails = await getSuperAdminEmails();

      const subject = days <= 3
        ? `URGENT: CSC Board Portal Microsoft secret expires in ${days} day${days === 1 ? "" : "s"}`
        : `Action required: CSC Board Portal Microsoft secret expires in ${days} days`;

      const html = `
        <h2 style="color:#163D6D;margin:0 0 12px;">Entra ID Client Secret Expiring Soon</h2>
        <p>The Microsoft client secret used by the <strong>CSC Board Portal</strong> to sync
           board documents from OneDrive will expire in <strong>${days} day${days === 1 ? "" : "s"}</strong>.</p>
        <p>If it expires, the daily OneDrive sync will stop working and board documents
           will no longer update automatically.</p>
        <h3 style="margin:20px 0 8px;">To renew:</h3>
        <ol>
          <li>Go to <a href="https://portal.azure.com">portal.azure.com</a></li>
          <li>Navigate to Entra ID → App Registrations → CSC Board Portal Sync</li>
          <li>Certificates &amp; secrets → New client secret</li>
          <li>Copy the new Value and update <code>CSC_BOARD_PORTAL_VALUE</code> in your environment</li>
          <li>Update <code>CSC_BOARD_PORTAL_EXPIRY</code> with the new expiry date (YYYYMMDD)</li>
          <li>Redeploy the application</li>
        </ol>
        <p style="color:#6B7280;font-size:13px;">
          This reminder fires daily until the secret is renewed.
        </p>
      `;

      for (const email of emails) {
        await sendEmail({ to: email, subject, html }).catch(() => {});
      }

      log.expiryWarningsSent = emails.length;
    }
  } catch (err) {
    log.expiryCheckError = err instanceof Error ? err.message : String(err);
  }

  await logAuditEventSafe({
    action:     "cron_onedrive_sync",
    entityType: "board_documents",
    actorType:  "cron",
    details:    log,
  }).catch(() => {});

  return NextResponse.json({ success: true, ...log });
}
