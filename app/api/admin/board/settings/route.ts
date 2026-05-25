/**
 * POST /api/admin/board/settings — save board-level app settings (SA only)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const db   = createAdminClient();

  const updates: Array<{ key: string; value: string }> = [];

  if (body.action_item_reminder_days !== undefined) {
    const v = parseInt(body.action_item_reminder_days, 10);
    if (v >= 1 && v <= 30) {
      updates.push({ key: "action_item_reminder_days", value: String(v) });
    }
  }

  for (const { key, value } of updates) {
    await db
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  }

  return NextResponse.json({ ok: true, updated: updates.map((u) => u.key) });
}
