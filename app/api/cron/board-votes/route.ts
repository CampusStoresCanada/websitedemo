/**
 * GET /api/cron/board-votes
 *
 * Hourly. Drives the whole board-vote lifecycle:
 *
 *   1. Opens a vote for any partner application sitting in pending_review
 *      without one, and posts it to Board Stuff as Butler.
 *   2. Posts the "closes tomorrow" reminder comment (one API call, riding
 *      Circle's own notifications — not nine DMs).
 *   3. Closes votes whose deadline has passed, tallies them, and comments the
 *      outcome.
 *
 * Never executes an approval. A carried vote is reported to staff, who press
 * the existing approve button — approveApplication() creates the org, logins,
 * Circle access and invites, and that stays behind a human hand.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  findApplicationsNeedingVote,
  findVotesToRemind,
  findVotesToClose,
  openVoteForApplication,
  sendVoteReminder,
  closeVote,
} from "@/lib/board/vote-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const opened: Array<{ applicationId: string; voteId?: string; error?: string }> = [];
  const reminded: string[] = [];
  const closed: Array<{ voteId: string; status: string; tally: string }> = [];

  for (const applicationId of await findApplicationsNeedingVote()) {
    const result = await openVoteForApplication(applicationId);
    opened.push(
      result.ok
        ? { applicationId, voteId: result.voteId }
        : { applicationId, error: result.error }
    );
  }

  for (const vote of await findVotesToRemind()) {
    if (await sendVoteReminder(vote.id)) reminded.push(vote.id);
  }

  for (const vote of await findVotesToClose()) {
    const result = await closeVote(vote.id);
    if (result) {
      closed.push({
        voteId: vote.id,
        status: result.status,
        tally: `${result.tally.yes}Y/${result.tally.no}N/${result.tally.abstain}A`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    opened: opened.length,
    reminded: reminded.length,
    closed: closed.length,
    detail: { opened, reminded, closed },
  });
}
