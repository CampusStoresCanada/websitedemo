import { NextRequest, NextResponse } from "next/server";
import { processCircleSyncQueue, pullInboundFromCircle } from "@/lib/circle/sync";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Cron job: Process the Circle sync queue + pull inbound profile updates.
 * Runs every 5 minutes via Vercel cron (inbound pull rate-limited internally).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Process outbound queue (Supabase → Circle)
    const outbound = await processCircleSyncQueue();

    // 2. Pull inbound profile updates (Circle → Supabase)
    // pullInboundFromCircle has its own 60-minute freshness gate per contact,
    // so running on every cron tick is safe.
    const inbound = await pullInboundFromCircle();

    return NextResponse.json({ outbound, inbound });
  } catch (error) {
    console.error("[cron/circle-sync] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
