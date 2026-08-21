/**
 * GET /api/cron/elections-kickoff
 *
 * Daily. Guarantees the Executive Director is holding a dated obligation to open
 * the next election cycle, raised at the board meeting before nominations must
 * go out — for a January AGM that is the August meeting, which is the whole
 * point of checking in summer rather than in September when it is already late.
 *
 * Creates nothing once the cycle has been opened, and nothing twice. It does not
 * open the cycle itself: that is a governance act with a date, and it should be
 * a person pressing a button after the board has seen it.
 */
import { NextRequest, NextResponse } from "next/server";
import { ensureElectionKickoff } from "@/lib/elections/cycle";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await ensureElectionKickoff();
    if (result.created || (result.needed && !result.meetingDate)) {
      console.log("[cron/elections-kickoff]", result.note, result);
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/elections-kickoff] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}
