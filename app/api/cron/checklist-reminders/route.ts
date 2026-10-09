import { NextRequest, NextResponse } from "next/server";
import { runChecklistReminders } from "@/lib/conference/checklist-engine";
import { isBusinessDay } from "@/lib/board/vote-schedule";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify cron secret — standard Vercel cron auth
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /*
    ⛔ THE UNATTENDED RUN DOES NOT EMAIL PEOPLE ON A DAY OFF.

    deriveCheckpointOffsets already moves each checkpoint onto a working day,
    but that only governs the date a reminder is AIMED at. A checkpoint whose
    day has passed stays due, so the next cron tick fires it whenever that tick
    happens — including Saturday morning, or Thanksgiving Monday.

    Caught before it sent: nine rescoped checklists went live on Fri 9 Oct 2026
    with Conference in a Box closing 20 Nov, so its 45-day mark was already two
    days past. The next tick was Saturday, and Monday was Thanksgiving.

    ⛔ Deliberately HERE and not in runChecklistReminders, which the admin
    "Send Reminders Now" button shares. A person pressing send on a Saturday
    means it; a cron firing on a Saturday is just the clock. The calendar rule
    belongs to the schedule, not to the send.
  */
  const now = new Date();
  if (!isBusinessDay(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())) {
    return NextResponse.json({
      skipped: "not a business day",
      date: now.toISOString().slice(0, 10),
    });
  }

  try {
    const result = await runChecklistReminders();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/checklist-reminders] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
