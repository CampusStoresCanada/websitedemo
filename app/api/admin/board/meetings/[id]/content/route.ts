/**
 * PATCH /api/admin/board/meetings/[id]/content
 * Saves agenda_html or minutes_html for a board meeting.
 *
 * Minutes are normalised on the way in, in this order:
 *
 *   1. Bare names in ACTION lines ("S. Thomas") are rewritten to canonical
 *      mentions ("@Stephen Thomas") so the stored minutes and anything minted
 *      from them agree on who is who. Ambiguous names are left as written.
 *      See docs/BOARD_ACTION_ITEM_MINT.md.
 *   2. DECIDED / OUTSTANDING / NEXT MEETING tags are CONSUMED — parsed into a
 *      Butler Ghost recap draft and removed from the minutes. They are
 *      addressed to the machine, not to the board, and are not part of the
 *      record of the meeting. See docs/BOARD_RECAP_POST_MINT.md.
 *
 * Mentions run first so the text captured onto the draft is already canonical.
 *
 * The response returns the normalised HTML because the editor holds the body
 * in local state — without it the tag block stays on screen after being
 * removed from the database, which reads as a bug and invites a re-save.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { rewriteMentions, type DirectoryEntry } from "@/lib/board/action-mint";
import {
  draftBoardRecapFromMinutes,
  announceRecapAwaitingReview,
  formatMeetingDateLong,
} from "@/lib/ghosts/board-recap-draft";

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

  let content = html || null;
  let recap: {
    drafted: boolean;
    id: string | null;
    counts: { decided: number; outstanding: number; nextMeeting: number };
    note: string | null;
  } | null = null;

  if (docType === "minutes" && content) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, display_name")
      .in("global_role", ["admin", "super_admin"]);

    const directory: DirectoryEntry[] = (profiles ?? [])
      .filter((p) => p.display_name)
      .map((p) => ({ id: p.id, displayName: p.display_name as string }));

    if (directory.length > 0) content = rewriteMentions(content, directory);

    const result = await draftBoardRecapFromMinutes({ meetingId: id, minutesHtml: content });

    // The ONLY place the minutes are allowed to lose the tags, and only
    // because a draft row now holds them.
    if (result.consumed) content = result.strippedHtml;

    recap = {
      drafted: result.consumed,
      id: result.announcementId,
      counts: result.counts,
      note: result.reason,
    };
  }

  const { error } = await db
    .from("board_meetings")
    .update({ [col]: content, [updatedAt]: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[board/meetings/content]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Only after the save has committed — Butler must never report a recap for
  // minutes that failed to save. Non-fatal: a missed alert is a missed
  // reminder, not a lost draft, and the draft is already on the meeting page.
  if (recap?.drafted && recap.id) {
    try {
      const { data: meeting } = await db
        .from("board_meetings")
        .select("meeting_date")
        .eq("id", id)
        .maybeSingle();

      if (meeting?.meeting_date) {
        await announceRecapAwaitingReview({
          meetingId: id,
          announcementId: recap.id,
          meetingDateLong: formatMeetingDateLong(meeting.meeting_date as string),
          counts: recap.counts,
          // Butler tells whoever just saved the minutes, rather than a
          // hardcoded address — the person who did the thing is the person
          // who wants to know it worked.
          recipientEmail: auth.ctx.userEmail,
        });
      }
    } catch (err) {
      console.error("[board/meetings/content] recap alert failed", err);
    }
  }

  return NextResponse.json({ ok: true, html: content, recap });
}
