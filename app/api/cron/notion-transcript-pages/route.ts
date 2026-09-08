/**
 * GET /api/cron/notion-transcript-pages
 *
 * Daily. Makes sure every upcoming board meeting has a Notion page waiting for
 * its transcript, and records the pointer on board_meetings.notion_page_id.
 *
 * Creates nothing on its own authority — it mirrors meetings that already exist
 * in board_meetings, which is itself driven by the Google Calendar schedule.
 * No recurrence rules, no invented meetings.
 *
 * See docs/BOARD_MINUTES_DRAFT_FROM_TRANSCRIPT.md §8b.
 */
import { NextRequest, NextResponse } from "next/server";
import { ensureNotionTranscriptPages } from "@/lib/board/notion-transcript-pages";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await ensureNotionTranscriptPages();

  if (result.failed.length) {
    console.error("[cron/notion-transcript-pages] failures", result.failed);
  }

  return NextResponse.json({
    ok: result.failed.length === 0,
    created: result.created.length,
    failed: result.failed.length,
    detail: result,
  });
}
