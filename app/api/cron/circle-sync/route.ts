import { NextRequest, NextResponse } from "next/server";
import { processCircleSyncQueue } from "@/lib/circle/sync";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Cron job: Process the Circle sync queue.
 * Runs every 5 minutes via Vercel cron.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processCircleSyncQueue();
    return NextResponse.json(result);
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
