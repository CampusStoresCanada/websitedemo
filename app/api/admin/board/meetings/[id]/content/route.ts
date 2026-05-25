/**
 * PATCH /api/admin/board/meetings/[id]/content
 * Saves agenda_html or minutes_html for a board meeting.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { docType, html } = await req.json() as { docType: "agenda" | "minutes"; html: string };

  if (docType !== "agenda" && docType !== "minutes") {
    return NextResponse.json({ error: "Invalid docType" }, { status: 400 });
  }

  const col       = docType === "agenda" ? "agenda_html"   : "minutes_html";
  const updatedAt = docType === "agenda" ? "agenda_updated_at" : "minutes_updated_at";

  const db = createAdminClient();
  const { error } = await db
    .from("board_meetings")
    .update({ [col]: html || null, [updatedAt]: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[board/meetings/content]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
