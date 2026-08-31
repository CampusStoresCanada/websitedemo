/**
 * Read a board meeting's transcript out of Notion.
 *
 * The route is deterministic and never searches:
 *
 *   board_meetings.notion_page_id
 *     → GET /blocks/{page}/children      → the one `meeting_notes` block
 *     → meeting_notes.children.transcript_block_id
 *     → that block's subtree             → plain text
 *
 * ⚠️ DO NOT match meeting notes via `POST /blocks/meeting_notes/query`. That
 * endpoint titles every block "Meeting <date-it-was-created>" — five different
 * board meetings came back with the identical title — and returns no `parent`,
 * so there is no way to tell them apart. Verified 2026-08-28. Going from the
 * page id we already store gives exactly one block, every time. This is why
 * `notion_page_id` is load-bearing rather than a convenience.
 *
 * READINESS IS GATED ON `transcript_block_id`, NOT ON `status`. The only status
 * value ever observed is `transcription_not_started`; the string that means
 * "done" is unknown until a real meeting is recorded. Gating on the presence of
 * the transcript block means an unfamiliar status reads as "not ready yet"
 * rather than crashing, and the raw value is passed back for a human to read.
 *
 * See docs/BOARD_MINUTES_DRAFT_FROM_TRANSCRIPT.md.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { listBlockChildren, isNotionConfigured, type NotionBlock } from "@/lib/notion/client";

export type TranscriptFetch =
  | {
      ready: true;
      notionPageId: string;
      transcriptBlockId: string;
      text: string;
      charCount: number;
      truncated: boolean;
    }
  | { ready: false; reason: string; status?: string | null };

interface RichTextish {
  plain_text?: string;
}

/**
 * Flatten a Notion block subtree to plain text, one block per line.
 *
 * Pure, so the shape handling is testable without a network call — which
 * matters because the transcript block's exact structure is not yet known.
 * Anything carrying a `rich_text` array contributes its text; unknown block
 * types contribute nothing rather than throwing, so a shape we have not seen
 * degrades to a gap instead of an exception.
 */
export function extractPlainText(blocks: NotionBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const payload = block[block.type] as { rich_text?: RichTextish[] } | undefined;
    const rich = payload?.rich_text;
    if (!Array.isArray(rich)) continue;

    const line = rich.map((r) => r?.plain_text ?? "").join("").trim();
    if (line) lines.push(line);
  }

  return lines.join("\n");
}

/** The `meeting_notes` block on a page, or null. */
function findMeetingNotes(blocks: NotionBlock[]): NotionBlock | null {
  return blocks.find((b) => b.type === "meeting_notes") ?? null;
}

export async function fetchMeetingTranscript(meetingId: string): Promise<TranscriptFetch> {
  if (!isNotionConfigured()) return { ready: false, reason: "NOTION_API_KEY is not configured." };

  const db = createAdminClient();
  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, title, notion_page_id")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return { ready: false, reason: "That meeting could not be found." };

  const pageId = meeting.notion_page_id as string | null;
  if (!pageId) {
    return {
      ready: false,
      reason:
        "This meeting has no Notion page yet. The nightly job creates one for every upcoming meeting — a past meeting will not have one.",
    };
  }

  const pageChildren = await listBlockChildren(pageId);
  if (!pageChildren.ok) return { ready: false, reason: `Could not read the Notion page: ${pageChildren.error}` };

  const notes = findMeetingNotes(pageChildren.blocks);
  if (!notes) {
    return {
      ready: false,
      reason:
        "That Notion page has no meeting notes on it yet. Open the page and use the microphone icon (or /meet) to turn it into meeting notes before recording.",
    };
  }

  const payload = notes.meeting_notes as
    | { status?: string; children?: { transcript_block_id?: string } }
    | undefined;
  const status = payload?.status ?? null;
  const transcriptBlockId = payload?.children?.transcript_block_id;

  if (!transcriptBlockId) {
    return {
      ready: false,
      status,
      reason:
        `No transcript on that page yet (Notion reports "${status ?? "unknown"}"). ` +
        `The transcript appears once the recording has been transcribed.`,
    };
  }

  const transcript = await listBlockChildren(transcriptBlockId);
  if (!transcript.ok) return { ready: false, status, reason: `Could not read the transcript: ${transcript.error}` };

  const text = extractPlainText(transcript.blocks);
  if (!text.trim()) {
    return {
      ready: false,
      status,
      reason: "The transcript block exists but is empty — the recording may still be processing.",
    };
  }

  return {
    ready: true,
    notionPageId: pageId,
    transcriptBlockId,
    text,
    charCount: text.length,
    truncated: transcript.truncated,
  };
}
