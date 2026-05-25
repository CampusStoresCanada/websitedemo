/**
 * GET /api/board/action/[token]/ics
 * Serves a VTODO .ics — imports as a task in Outlook, Reminders, etc.
 * No auth required — the token IS the credential.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildActionIcs } from "@/lib/board/action-ics";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const db = createAdminClient();

  const { data: item } = await db
    .from("board_action_items")
    .select("id, title, description, due_date, status, complete_token, created_at")
    .eq("complete_token", token)
    .maybeSingle();

  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ics      = buildActionIcs({ ...item, createdAt: item.created_at, dueDate: item.due_date, completeToken: item.complete_token });
  const filename = `csc-action-${item.id.slice(0, 8)}.ics`;

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type":        "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control":       "no-store",
    },
  });
}
