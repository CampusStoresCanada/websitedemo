import { NextRequest, NextResponse } from "next/server";
import { expireStalePendingConferenceOrders } from "@/lib/actions/conference-commerce";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await expireStalePendingConferenceOrders();
    const status = result.success ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (error) {
    console.error("[cron/expire-pending-conference-orders] unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
