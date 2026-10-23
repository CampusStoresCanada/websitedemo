import { NextRequest, NextResponse } from "next/server";
import { runConferenceCircleAccessSync } from "@/lib/circle/conference-access";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Hourly cron: keep each conference's private Circle spaces (All Conference,
 * Members Only, ...) in step with its pass holders. Queues adds/removes; the
 * circle-sync cron performs them. See lib/circle/conference-access.ts.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runConferenceCircleAccessSync();
    console.log("[cron/conference-circle-access]", JSON.stringify(result));
    return NextResponse.json({ ok: result.errors.length === 0, ...result });
  } catch (error) {
    console.error("[cron/conference-circle-access] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
