/**
 * POST /api/admin/board/onedrive/discover
 *
 * Discovers the OneDrive drive ID for a given user principal name (UPN)
 * and saves it to app_settings. Super admin only.
 *
 * Body: { upn: string, save?: boolean }
 *
 * Returns: { driveId, driveName, driveType, ownerName }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { getUserDrive } from "@/lib/onedrive/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return NextResponse.json({ error: "Super admin required" }, { status: 403 });
  }

  let body: { upn?: string; save?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const upn = (body.upn ?? "").trim();
  if (!upn || !upn.includes("@")) {
    return NextResponse.json(
      { error: "A valid user principal name (email) is required" },
      { status: 400 }
    );
  }

  try {
    const drive = await getUserDrive(upn);

    // If save=true (or not specified — default to saving on discovery), persist the drive ID
    if (body.save !== false) {
      const db = createAdminClient();
      await db
        .from("app_settings")
        .upsert(
          [
            { key: "onedrive_drive_id",   value: drive.id },
            { key: "onedrive_user_upn",   value: upn },
            // Reset delta token so the next sync does a full initial scan
            { key: "onedrive_delta_token", value: "" },
          ],
          { onConflict: "key" }
        );

      await logAuditEventSafe({
        action:     "onedrive_drive_configured",
        entityType: "app_settings",
        actorId:    auth.ctx.userId,
        actorType:  "user",
        details:    { upn, driveId: drive.id, driveName: drive.name },
      }).catch(() => {});
    }

    return NextResponse.json({
      driveId:   drive.id,
      driveName: drive.name,
      upn,
      saved: body.save !== false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
