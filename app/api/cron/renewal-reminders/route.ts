import { NextRequest, NextResponse } from "next/server";
import { renewalReminderRun } from "@/lib/renewal/jobs";

export const dynamic = "force-dynamic";
// Explicit, not just relying on the platform default — this is the ceiling
// renewalReminderRun's concurrency (RENEWAL_JOB_CONCURRENCY) is sized to
// stay well under, not a limit it's expected to bump up against. The old
// implicit-default run silently died at this wall on 2026-08-02 with no
// visibility (see updateJobRunProgress in lib/renewal/jobs.ts for the fix
// to that half of the incident).
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify cron secret — standard Vercel cron auth
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await renewalReminderRun();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/renewal-reminders] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
