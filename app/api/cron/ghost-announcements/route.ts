/**
 * GET /api/cron/ghost-announcements
 *
 * Hourly. Two halves:
 *
 *   1. DRAFT — scan for partners who have newly gone active and write an
 *      announcement for each. Drafts only; nobody sees them until a human
 *      approves them in /admin/comms/announcements.
 *
 *   2. RELEASE — publish at most ONE approved announcement. That cap is the
 *      spacing rule: because this runs hourly and releases one item, posts can
 *      never land closer together than an hour, and the per-day caps in the
 *      posting policy keep the real rate to one new-partner post per business
 *      day.
 *
 * Drafting is unconditional — it costs nothing and keeps the review queue
 * current even on a weekend. Only the release half is gated by the policy.
 */

import { NextRequest, NextResponse } from "next/server";
import { draftPendingAnnouncementsCore } from "@/lib/ghosts/draft";
import { publishNextAnnouncement } from "@/lib/ghosts/publish";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const drafting = await draftPendingAnnouncementsCore();
  const release = await publishNextAnnouncement();

  return NextResponse.json({
    ok: true,
    drafted: drafting.drafted,
    skipped: drafting.skipped,
    published: release.published ? 1 : 0,
    detail: release.published
      ? { organization: release.organizationName, url: release.url }
      : { heldBecause: release.reason },
  });
}
