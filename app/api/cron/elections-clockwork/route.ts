/**
 * The election clock. Advances every election whose next derivable step is due.
 *
 * Hourly rather than daily: the steps are dated to the DAY, so hourly costs
 * nothing (a step not due is a no-op) and means a deadline is never more than an
 * hour stale. `runElectionClockwork` is idempotent — each step is gated on the
 * current status — so a re-run does nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { runElectionClockwork } from "@/lib/elections/clockwork";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runElectionClockwork();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/elections-clockwork] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
