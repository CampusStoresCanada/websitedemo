/**
 * Drafting Butler Ghost's board recap from saved minutes.
 *
 * Split from the route so it can be unit-reasoned about and reused, and so the
 * route stays a thin caller. Produces DRAFTS only — nothing here publishes.
 *
 * The one genuinely dangerous thing this file does is decide whether the recap
 * tags may be removed from the board's minutes. That decision is expressed in
 * exactly one place, `consumed`, and it is true only when a draft row has come
 * back from the database holding the tags. See docs/BOARD_RECAP_POST_MINT.md §5.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { parseRecapLines, groupRecapLines } from "@/lib/board/action-mint";
import { buildBoardRecapPost } from "@/lib/ghosts/board-recap-post";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { butlerDm, dmText, dmLink, dmPara, REVIEW_URL, type DmNode } from "@/lib/ghosts/butler-dm";

/**
 * Base URL for links that end up inside a Circle post.
 *
 * NEXT_PUBLIC_APP_URL is localhost in development, and a recap posted from a
 * dev machine would otherwise carry a localhost button into the board space
 * where it is dead for everyone. Public-facing links fall back to the canonical
 * domain rather than trusting the env blindly.
 */
export function publicAppUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!configured || /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(configured)) {
    return "https://www.campusstores.ca";
  }
  return configured;
}

/**
 * The meeting's own event page, or null.
 *
 * Derived from the linked event's SLUG rather than assembled from the date —
 * the slug is what the route actually resolves, and a meeting with no linked
 * event gets no button rather than a URL that 404s. Shared so the initial draft
 * and a later rebuild from the review screen always agree.
 */
export async function resolveMeetingEventUrl(meetingId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data: meeting } = await db
    .from("board_meetings").select("event_id").eq("id", meetingId).maybeSingle();
  if (!meeting?.event_id) return null;

  const { data: event } = await db
    .from("events").select("slug").eq("id", meeting.event_id as string).maybeSingle();
  return event?.slug ? `${publicAppUrl()}/events/${event.slug}` : null;
}

export interface RecapDraftResult {
  /**
   * True only when a draft row now holds the tags. The caller strips the
   * minutes if and only if this is true — never on the strength of anything
   * else in this object.
   */
  consumed: boolean;
  /** The minutes to save. Identical to the input unless `consumed`. */
  strippedHtml: string;
  announcementId: string | null;
  counts: { decided: number; outstanding: number; nextMeeting: number };
  /** Why nothing was consumed, when nothing was. */
  reason: string | null;
}

function unchanged(minutesHtml: string, reason: string | null): RecapDraftResult {
  return {
    consumed: false,
    strippedHtml: minutesHtml,
    announcementId: null,
    counts: { decided: 0, outstanding: 0, nextMeeting: 0 },
    reason,
  };
}

/**
 * "Thursday, August 27, 2026" from a bare `date` column.
 *
 * Formatted in UTC deliberately. `meeting_date` is a calendar date with no
 * time, and formatting it in the server's zone shifts it a day backwards
 * anywhere west of Greenwich — which on Vercel (UTC) hides the bug locally and
 * produces it in production, or the reverse.
 */
export function formatMeetingDateLong(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Parse the recap tags out of freshly-saved minutes and leave a draft behind.
 *
 * Returns the minutes untouched whenever anything at all is off — no tags, no
 * meeting, a locked draft, a failed write. The caller can treat a `consumed:
 * false` result as "save what you were going to save anyway".
 */
export async function draftBoardRecapFromMinutes(params: {
  meetingId: string;
  minutesHtml: string;
  /** The minutes are provisional until the board approves them. */
  minutesAreDraft?: boolean;
}): Promise<RecapDraftResult> {
  const { meetingId, minutesHtml } = params;

  const parsed = parseRecapLines(minutesHtml);
  if (!parsed.lines.length) return unchanged(minutesHtml, null);

  const db = createAdminClient();

  const { data: existing, error: readError } = await db
    .from("ghost_announcements")
    .select("id, status")
    .eq("kind", "board_recap")
    .eq("meeting_id", meetingId)
    .maybeSingle();

  if (readError) {
    console.error("[ghosts/board-recap] could not read existing draft", readError);
    return unchanged(minutesHtml, "Could not check for an existing recap draft.");
  }

  // A human has already acted on this recap. Regenerating would throw away
  // their edits, and stripping would destroy tags nothing consumed — so the
  // tags stay in the minutes, visible, for a human to decide about.
  if (existing && existing.status !== "draft") {
    return unchanged(
      minutesHtml,
      `A recap for this meeting is already ${existing.status}; the tags were left in the minutes.`
    );
  }

  const { data: meeting } = await db
    .from("board_meetings")
    .select("meeting_date, title, event_id")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting?.meeting_date) {
    return unchanged(minutesHtml, "The meeting has no date, so the recap could not be titled.");
  }

  const grouped = groupRecapLines(parsed.lines);
  const meetingDateLong = formatMeetingDateLong(meeting.meeting_date as string);

  const eventUrl = await resolveMeetingEventUrl(meetingId);

  const post = buildBoardRecapPost({
    meetingDateLong,
    eventUrl,
    decided: grouped.decided.map((l) => l.text),
    outstanding: grouped.outstanding.map((l) => l.text),
    nextMeeting: grouped.next_meeting.map((l) => l.text),
    minutesAreDraft: params.minutesAreDraft ?? true,
  });

  const payload = {
    kind: "board_recap",
    meeting_id: meetingId,
    status: "draft",
    title: post.title,
    source_block: parsed.lines.map((l) => l.raw).join("\n"),
    // Round-tripped to satisfy the generated Json column type — same coercion
    // the new-partner pipeline uses.
    body_tiptap: JSON.parse(JSON.stringify(post.tiptap_body)),
    updated_at: new Date().toISOString(),
  };

  // `.select().single()` is load-bearing, not style. A write that matches no
  // rows returns `error: null` with no rows — indistinguishable from success
  // if you only check the error. Stripping the minutes on that would trade the
  // board's tags for nothing.
  const written = existing
    ? await db.from("ghost_announcements").update(payload).eq("id", existing.id).select("id").single()
    : await db.from("ghost_announcements").insert(payload).select("id").single();

  if (written.error || !written.data?.id) {
    console.error("[ghosts/board-recap] draft write failed", written.error);
    return unchanged(minutesHtml, "The recap draft could not be saved, so the minutes were left as written.");
  }

  const counts = {
    decided: grouped.decided.length,
    outstanding: grouped.outstanding.length,
    nextMeeting: grouped.next_meeting.length,
  };

  return {
    consumed: true,
    strippedHtml: parsed.strippedHtml,
    announcementId: written.data.id as string,
    counts,
    reason: null,
  };
}

/**
 * Butler's reports.
 *
 * A Circle DM, not an ops alert. Ops alerts are for conditions someone has to
 * go and resolve; this is one colleague telling another that a thing is ready.
 * It belongs in the same inbox as the rest of the board's conversation.
 *
 * The DM comes from Butler because DMs are attributed to the KEY OWNER, not to
 * `user_email` the way posts are — so `getCircleGhostClient()` is what makes it
 * Butler rather than the super admin. That asymmetry is easy to get wrong.
 *
 * The ops alert survives only as a fallback for when the DM cannot be
 * delivered. A report that silently fails is the same as no report at all.
 */

/**
 * "A recap draft is waiting on the website."
 *
 * Keyed per meeting on the fallback path: `raiseAlertIfNotOpen` dedupes on any
 * non-resolved row with the same rule_key, so a bare key would mean September's
 * recap raises nothing while August's alert is still open.
 */
export async function announceRecapAwaitingReview(params: {
  meetingId: string;
  announcementId: string;
  meetingDateLong: string;
  counts: { decided: number; outstanding: number; nextMeeting: number };
  /** Who did the save. Butler tells them; falls back to an ops alert. */
  recipientEmail?: string | null;
}): Promise<void> {
  const { counts } = params;
  const tally = `${counts.decided} decided, ${counts.outstanding} outstanding, ${counts.nextMeeting} for next meeting`;
  const plain =
    `I drafted a board recap from the ${params.meetingDateLong} minutes (${tally}). ` +
    `It's waiting for your review — nothing goes to the board space until you approve it. ${REVIEW_URL}`;

  const sent = await butlerDm(
    params.recipientEmail,
    [
      dmPara(
        dmText("I drafted a board recap from the "),
        dmText(params.meetingDateLong, true),
        dmText(` minutes — ${tally}.`)
      ),
      dmPara(
        dmText("I've taken the tagged lines out of the minutes, so the record is clean. Nothing reaches the board space until you approve it: "),
        dmLink("review the recap", REVIEW_URL)
      ),
    ],
    plain
  );

  if (sent) return;

  await raiseAlertIfNotOpen({
    ruleKey: `board_recap_awaiting_review:${params.meetingId}`,
    severity: "info",
    // Fallback only — the DM is the intended channel. Counts are facts about
    // this draft and cannot go stale, which matters because ops_alerts.message
    // is frozen at creation and never recomputed.
    message: `Butler Ghost drafted a board recap for the ${params.meetingDateLong} meeting (${tally}). It is waiting for review. (Circle DM could not be delivered.)`,
    details: {
      meetingId: params.meetingId,
      announcementId: params.announcementId,
      reviewPath: "/admin/board/recaps",
      dmDelivered: false,
    },
  });
}

/**
 * "It's in Circle as a draft — publish it when you're happy."
 *
 * A separate report from the one above, and keyed separately, because they say
 * different things: one means "there is something to review on the website",
 * this means "it is in the board space and one click from being live".
 */
export async function announceRecapDraftInCircle(params: {
  meetingId: string;
  meetingDateLong: string;
  circlePostUrl: string | null;
  recipientEmail?: string | null;
}): Promise<void> {
  const plain =
    `The ${params.meetingDateLong} board recap is in the board space as a draft. ` +
    `Nobody has been notified — read it and publish it in Circle when you're happy.` +
    (params.circlePostUrl ? ` ${params.circlePostUrl}` : "");

  const body: DmNode[] = [
    dmPara(
      dmText("The "),
      dmText(params.meetingDateLong, true),
      dmText(" board recap is now in the board space as a "),
      dmText("draft", true),
      dmText(". Nobody has been notified.")
    ),
    dmPara(
      params.circlePostUrl
        ? dmLink("Open the draft", params.circlePostUrl)
        : dmText("It's in the board space."),
      dmText(" — publish it there when you're happy with it.")
    ),
  ];

  const sent = await butlerDm(params.recipientEmail, body, plain);
  if (sent) return;

  await raiseAlertIfNotOpen({
    ruleKey: `board_recap_in_circle:${params.meetingId}`,
    severity: "info",
    message: plain + " (Circle DM could not be delivered.)",
    details: { meetingId: params.meetingId, circlePostUrl: params.circlePostUrl, state: "circle_draft", dmDelivered: false },
  });
}
