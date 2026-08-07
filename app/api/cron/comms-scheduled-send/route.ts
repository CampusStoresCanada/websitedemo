import { NextRequest, NextResponse } from "next/server";
import { dispatchScheduledCampaigns } from "@/lib/comms/send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchScheduledCampaigns();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[cron/comms-scheduled-send] unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
