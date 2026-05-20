import { NextRequest, NextResponse } from "next/server";
import { sweepInboundFromCircle } from "@/lib/circle/sync";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Daily cron: bulk-sweep Circle profiles into circle_properties.
 *
 * Fetches all Circle members in one paginated pass, diffs against stored
 * circle_properties, and writes only changed rows. Webhooks handle real-time
 * updates; this is the daily catch-up for anything missed.
 *
 * Cost: ~ceil(members / 100) Circle API calls per run regardless of member count.
 * At 500 members: 5 calls/day = ~150 calls/month.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepInboundFromCircle();
    console.log("[cron/circle-inbound-sweep]", result);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/circle-inbound-sweep] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
