import { NextRequest, NextResponse } from "next/server";
import { processCircleSyncQueue } from "@/lib/circle/sync";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Cron job: Process the outbound Circle sync queue (Supabase → Circle).
 * Runs every 5 minutes. Inbound profile sync runs separately once per day
 * via /api/cron/circle-inbound-sweep.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const outbound = await processCircleSyncQueue();
    return NextResponse.json({ outbound });
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
