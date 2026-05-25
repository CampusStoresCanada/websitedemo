/**
 * POST /api/admin/board/meetings — create a new board meeting + Notion page
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBoardMeetingPage } from "@/lib/notion/board";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { meetingDate, meetingType, title, notes } = await req.json() as {
    meetingDate: string;
    meetingType: "regular" | "agm" | "special";
    title?:      string;
    notes?:      string;
  };

  if (!meetingDate || !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    return NextResponse.json({ error: "meetingDate is required (YYYY-MM-DD)" }, { status: 400 });
  }

  const db = createAdminClient();

  // Check for duplicate
  const { data: existing } = await db
    .from("board_meetings")
    .select("id")
    .eq("meeting_date", meetingDate)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "A meeting already exists for that date" }, { status: 409 });
  }

  // Create Notion page (best-effort — don't fail the whole thing if Notion is down)
  let notionPageId:  string | null = null;
  let notionPageUrl: string | null = null;

  try {
    const page = await createBoardMeetingPage(meetingDate, meetingType, title);
    notionPageId  = page.id;
    notionPageUrl = page.url;
  } catch (err) {
    console.warn("[createBoardMeeting] Notion page creation failed:", err);
  }

  const typeLabel =
    meetingType === "agm"     ? "AGM" :
    meetingType === "special" ? "Special Meeting" :
    "Board Meeting";

  const { data: meeting, error } = await db
    .from("board_meetings")
    .insert({
      meeting_date:   meetingDate,
      meeting_type:   meetingType,
      title:          title ?? `CSC ${typeLabel} — ${meetingDate}`,
      status:         "upcoming",
      notes:          notes ?? null,
      notion_page_id:  notionPageId,
      notion_page_url: notionPageUrl,
    })
    .select("id, meeting_date, meeting_type, title, status, notion_page_url")
    .single();

  if (error || !meeting) {
    console.error("[createBoardMeeting] DB insert failed:", error);
    return NextResponse.json({ error: "Failed to create meeting" }, { status: 500 });
  }

  return NextResponse.json({ meeting }, { status: 201 });
}
