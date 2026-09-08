/**
 * Butler tells the requester their minutes draft is ready.
 *
 * The point of moving drafting to a batch job is that nobody waits for it —
 * which means nobody finds out it finished unless they are told. Same channel
 * and same reasoning as the recap report: a DM from Butler, with an ops alert
 * only as the fallback for an undeliverable one.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { butlerDm, dmText, dmLink, dmPara } from "@/lib/ghosts/butler-dm";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";

function meetingUrl(meetingId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  const root = !base || /localhost|127\.0\.0\.1/i.test(base) ? "https://www.campusstores.ca" : base;
  return `${root}/admin/board/meetings/${meetingId}?tab=minutes`;
}

export async function announceMinutesDraftReady(meetingId: string): Promise<void> {
  const db = createAdminClient();

  const { data: meeting } = await db
    .from("board_meetings")
    .select("title, meeting_date")
    .eq("id", meetingId)
    .maybeSingle();

  const { data: job } = await db
    .from("board_minutes_drafts")
    .select("requested_by_email")
    .eq("meeting_id", meetingId)
    .maybeSingle();

  const title = (meeting?.title as string) ?? "the board meeting";
  const url = meetingUrl(meetingId);
  const plain = `Your minutes draft for ${title} is ready to review. Nothing is saved yet — open the meeting, read it, then save. ${url}`;

  const sent = await butlerDm(
    job?.requested_by_email as string | null,
    [
      dmPara(
        dmText("The minutes draft for "),
        dmText(title, true),
        dmText(" is ready.")
      ),
      dmPara(
        dmLink("Open the meeting", url),
        dmText(" — it loads into the editor unsaved, so read it and check the judgment calls before you save.")
      ),
    ],
    plain
  );

  if (sent) return;

  await raiseAlertIfNotOpen({
    ruleKey: `board_minutes_draft_ready:${meetingId}`,
    severity: "info",
    message: plain + " (Circle DM could not be delivered.)",
    details: { meetingId, state: "draft_ready", dmDelivered: false },
  });
}
