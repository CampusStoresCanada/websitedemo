/**
 * One Notion page per upcoming board meeting, for the transcript to land on.
 *
 * The page exists BEFORE the meeting so the recording has somewhere to go:
 * AI Meeting Notes attaches to an existing page (microphone icon, or `/meet`),
 * which is what lets the app pre-create the row rather than having Notion spawn
 * a second page that then has to be reconciled with this one.
 *
 * `board_meetings` owns the record; the Notion page is derived, and
 * `board_meetings.notion_page_id` is the only link between them. Nothing reads
 * the Notion page except the transcript fetch — so if the transcript source
 * ever moves, only that fetch changes.
 *
 * See docs/BOARD_MINUTES_DRAFT_FROM_TRANSCRIPT.md §8b.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createDataSourceRow, trashPage, isNotionConfigured } from "@/lib/notion/client";

/**
 * The "Notion Transcripts" data source inside the Board Meetings page.
 * Same env-with-known-default shape as CIRCLE_BOARD_SPACE_ID.
 */
function transcriptsDataSourceId(): string {
  return (
    process.env.NOTION_TRANSCRIPTS_DATA_SOURCE_ID ??
    "3caa69bf-0cfd-80f7-9182-000b373cca67"
  );
}

export interface EnsurePagesResult {
  created: Array<{ meetingId: string; title: string; notionPageId: string }>;
  failed: Array<{ meetingId: string; title: string; reason: string }>;
  skipped: number;
}

/**
 * Create a Notion page for every FUTURE board meeting that doesn't have one.
 *
 * Deliberately forward-only. Past meetings already have their minutes and there
 * is no transcript to record retroactively, so a page for them would be an
 * empty shell that never gets used. Cancelled meetings are excluded for the
 * same reason.
 *
 * Idempotent: the filter is `notion_page_id is null`, so re-running is a no-op
 * for anything already linked. Safe to run on every tick.
 */
export async function ensureNotionTranscriptPages(
  today: string = new Date().toISOString().slice(0, 10)
): Promise<EnsurePagesResult> {
  const created: EnsurePagesResult["created"] = [];
  const failed: EnsurePagesResult["failed"] = [];

  if (!isNotionConfigured()) {
    return { created, failed: [{ meetingId: "-", title: "-", reason: "NOTION_API_KEY is not configured." }], skipped: 0 };
  }

  const db = createAdminClient();
  const dataSourceId = transcriptsDataSourceId();

  const { data: meetings, error } = await db
    .from("board_meetings")
    .select("id, title, meeting_date, status")
    .is("notion_page_id", null)
    .neq("status", "cancelled")
    .gt("meeting_date", today)
    .order("meeting_date", { ascending: true });

  if (error) {
    console.error("[board/notion-pages] could not read meetings", error);
    return { created, failed: [{ meetingId: "-", title: "-", reason: error.message }], skipped: 0 };
  }

  for (const meeting of meetings ?? []) {
    const title = (meeting.title as string) || `CSC Board Meeting — ${meeting.meeting_date}`;

    const page = await createDataSourceRow({
      dataSourceId,
      title,
      date: meeting.meeting_date as string,
    });

    if (!page.ok) {
      failed.push({ meetingId: meeting.id as string, title, reason: page.error });
      continue;
    }

    // The write-back is the load-bearing step. A page with no pointer is
    // invisible to this function's own filter, so the next run would create a
    // second one — and nothing would ever notice. If the pointer can't be
    // stored, take the page back out rather than leaving an orphan behind.
    const { data: linked, error: writeError } = await db
      .from("board_meetings")
      .update({ notion_page_id: page.page.id, notion_page_url: page.page.url })
      .eq("id", meeting.id as string)
      .select("id")
      .single();

    if (writeError || !linked) {
      const trashed = await trashPage(page.page.id);
      failed.push({
        meetingId: meeting.id as string,
        title,
        reason:
          `could not store notion_page_id (${writeError?.message ?? "no row updated"})` +
          (trashed.ok ? " — the Notion page was trashed" : ` — AND the Notion page could not be trashed: ${trashed.error}`),
      });
      continue;
    }

    created.push({ meetingId: meeting.id as string, title, notionPageId: page.page.id });
  }

  return { created, failed, skipped: 0 };
}
