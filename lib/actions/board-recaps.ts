"use server";

/**
 * Review and release of Butler Ghost's board recaps.
 *
 * The human gate. Drafts are written by `draftBoardRecapFromMinutes()` when
 * minutes are saved; they are read, corrected and approved here, and only then
 * does anything reach the board space.
 *
 * WHY THE SOURCE BLOCK IS EDITABLE HERE: the recap tags are consumed from the
 * minutes on save, so "fix a line and re-save the minutes" is not available —
 * the tags are gone from the document by design. `source_block` is the only
 * surviving copy, so this screen is where it is corrected. Editing it and
 * regenerating runs the same parser and builder the save path does, which
 * means the structure can only ever contain node types Circle is verified to
 * render.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";
import { parseRecapLines, groupRecapLines } from "@/lib/board/action-mint";
import { buildBoardRecapPost } from "@/lib/ghosts/board-recap-post";
import { formatMeetingDateLong, resolveMeetingEventUrl } from "@/lib/ghosts/board-recap-draft";
import { publishBoardRecap } from "@/lib/ghosts/board-recap-publish";
import { announceRecapDraftInCircle } from "@/lib/ghosts/board-recap-draft";

const REVIEW_PATH = "/admin/board/recaps";

export interface BoardRecapRow {
  id: string;
  meetingId: string | null;
  meetingTitle: string;
  meetingDateLong: string;
  status: "draft" | "approved" | "published" | "skipped";
  title: string;
  /** The consumed tag lines — editable, and the only copy. */
  sourceBlock: string;
  /** Rendered preview, grouped the way the post will read. */
  decided: string[];
  outstanding: string[];
  nextMeeting: string[];
  circlePostUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export async function listBoardRecaps(): Promise<BoardRecapRow[]> {
  const auth = await requireAdmin();
  if (!auth.ok) return [];

  const db = createAdminClient();
  const { data } = await db
    .from("ghost_announcements")
    .select("id, meeting_id, status, title, source_block, circle_post_url, published_at, created_at")
    .eq("kind", "board_recap")
    .order("created_at", { ascending: false });

  if (!data?.length) return [];

  const meetingIds = data.map((r) => r.meeting_id as string).filter(Boolean);
  const { data: meetings } = meetingIds.length
    ? await db.from("board_meetings").select("id, title, meeting_date").in("id", meetingIds)
    : { data: [] as { id: string; title: string | null; meeting_date: string | null }[] };

  const byId = new Map((meetings ?? []).map((m) => [m.id as string, m]));

  return data.map((row) => {
    const meeting = byId.get(row.meeting_id as string);
    const grouped = groupRecapLines(parseRecapLines(String(row.source_block ?? "")).lines);

    return {
      id: row.id as string,
      meetingId: (row.meeting_id as string) ?? null,
      meetingTitle: (meeting?.title as string) ?? "Board meeting",
      meetingDateLong: meeting?.meeting_date
        ? formatMeetingDateLong(meeting.meeting_date as string)
        : "Date unknown",
      status: row.status as BoardRecapRow["status"],
      title: (row.title as string) ?? "",
      sourceBlock: (row.source_block as string) ?? "",
      decided: grouped.decided.map((l) => l.text),
      outstanding: grouped.outstanding.map((l) => l.text),
      nextMeeting: grouped.next_meeting.map((l) => l.text),
      circlePostUrl: (row.circle_post_url as string) ?? null,
      publishedAt: (row.published_at as string) ?? null,
      createdAt: row.created_at as string,
    };
  });
}

/**
 * Rewrite the tag block and rebuild the post from it.
 *
 * Refuses once the recap has left `draft` — a published post is not something
 * this screen can retroactively change, and pretending otherwise would leave
 * the stored body disagreeing with what is actually in Circle.
 */
export async function saveRecapBlock(
  id: string,
  blockText: string
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: row } = await db
    .from("ghost_announcements")
    .select("id, status, meeting_id")
    .eq("id", id)
    .eq("kind", "board_recap")
    .maybeSingle();

  if (!row) return { ok: false, error: "That recap could not be found." };
  if (row.status !== "draft") return { ok: false, error: `This recap is already ${row.status}.` };

  const parsed = parseRecapLines(blockText);
  if (!parsed.lines.length) {
    return {
      ok: false,
      error: "No DECIDED, OUTSTANDING or NEXT MEETING lines found — nothing to build a recap from.",
    };
  }

  const { data: meeting } = await db
    .from("board_meetings")
    .select("meeting_date")
    .eq("id", row.meeting_id as string)
    .maybeSingle();

  if (!meeting?.meeting_date) return { ok: false, error: "The meeting has no date." };

  const grouped = groupRecapLines(parsed.lines);
  const post = buildBoardRecapPost({
    meetingDateLong: formatMeetingDateLong(meeting.meeting_date as string),
    eventUrl: await resolveMeetingEventUrl(row.meeting_id as string),
    decided: grouped.decided.map((l) => l.text),
    outstanding: grouped.outstanding.map((l) => l.text),
    nextMeeting: grouped.next_meeting.map((l) => l.text),
    minutesAreDraft: true,
  });

  const { error } = await db
    .from("ghost_announcements")
    .update({
      title: post.title,
      source_block: parsed.lines.map((l) => l.raw).join("\n"),
      body_tiptap: JSON.parse(JSON.stringify(post.tiptap_body)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(REVIEW_PATH);
  return { ok: true };
}

/**
 * Approve and hand the recap to Circle as a DRAFT.
 *
 * Butler never publishes a recap. It writes the post into the board space
 * unpublished, notifies nobody, and reports that it is there — the final
 * publish is a human act inside Circle, where it can be read in place and
 * edited with Circle's own tools first.
 */
export async function approveAndPostRecap(
  id: string
): Promise<{ ok: boolean; url?: string | null; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: "Forbidden" };

  const db = createAdminClient();

  // Claim the row atomically before posting. Two reviewers double-clicking
  // would otherwise both pass the status check and post the recap twice.
  const { data: claimed, error: claimError } = await db
    .from("ghost_announcements")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: auth.ctx.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("kind", "board_recap")
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (claimError) return { ok: false, error: claimError.message };
  if (!claimed) return { ok: false, error: "This recap is no longer a draft — reload the page." };

  const result = await publishBoardRecap(id, { asDraft: true });
  revalidatePath(REVIEW_PATH);

  if (!result.published) {
    // Hand it back so the reviewer can retry rather than stranding it.
    await db.from("ghost_announcements").update({ status: "draft" }).eq("id", id);
    revalidatePath(REVIEW_PATH);
    return { ok: false, error: result.reason };
  }

  // Butler's report. Non-fatal: a missed alert costs a reminder, not the draft.
  try {
    const { data: sent } = await db
      .from("ghost_announcements")
      .select("meeting_id, board_meetings(meeting_date)")
      .eq("id", id)
      .maybeSingle();

    const meetingDate = (sent as { board_meetings?: { meeting_date?: string } } | null)
      ?.board_meetings?.meeting_date;

    if (sent?.meeting_id && meetingDate) {
      await announceRecapDraftInCircle({
        meetingId: sent.meeting_id as string,
        meetingDateLong: formatMeetingDateLong(meetingDate),
        circlePostUrl: result.url ?? null,
        recipientEmail: auth.ctx.userEmail,
      });
    }
  } catch (err) {
    console.error("[board-recaps] draft-in-Circle alert failed", err);
  }

  return { ok: true, url: result.url };
}

/** Decide this meeting gets no recap. */
export async function skipRecap(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: "Forbidden" };

  const db = createAdminClient();
  const { error } = await db
    .from("ghost_announcements")
    .update({
      status: "skipped",
      skip_reason: reason || "Skipped by reviewer.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("kind", "board_recap")
    .eq("status", "draft");

  if (error) return { ok: false, error: error.message };
  revalidatePath(REVIEW_PATH);
  return { ok: true };
}
