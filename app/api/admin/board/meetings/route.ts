/**
 * POST /api/admin/board/meetings — create a new board meeting + linked event
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

function generateSlug(title: string, startsAt: string): string {
  const date = new Date(startsAt).toISOString().slice(0, 10);
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) +
    "-" +
    date
  );
}

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
    })
    .select("id, meeting_date, meeting_type, title, status")
    .single();

  if (error || !meeting) {
    console.error("[createBoardMeeting] DB insert failed:", error);
    return NextResponse.json({ error: "Failed to create meeting" }, { status: 500 });
  }

  // Create a linked calendar event so the meeting appears in the Events section
  // board events default to 10:00 AM UTC; audience_mode="board" gates visibility
  const startsAt = `${meetingDate}T10:00:00Z`;
  const endsAt   = `${meetingDate}T12:00:00Z`;
  const eventTitle = meeting.title;
  const slug = generateSlug(eventTitle, startsAt);

  const { data: event, error: eventError } = await db
    .from("events")
    .insert({
      slug,
      title: eventTitle,
      starts_at: startsAt,
      ends_at: endsAt,
      audience_mode: "board",
      is_virtual: true,
      status: "published",
      created_by: auth.ctx.userId,
    })
    .select("id")
    .single();

  if (event && !eventError) {
    // Link the event back to the board meeting
    await db
      .from("board_meetings")
      .update({ event_id: event.id })
      .eq("id", meeting.id);
  } else {
    console.warn("[createBoardMeeting] Event creation failed (non-fatal):", eventError);
  }

  return NextResponse.json({ meeting }, { status: 201 });
}
