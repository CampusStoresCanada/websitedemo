import { NextRequest, NextResponse } from "next/server";
import { adminTransferTimeoutCheck } from "@/lib/actions/admin-transfer";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Cron: Admin Transfer Timeout Check
 *
 * Runs hourly. Processes any pending admin transfers that have
 * passed their timeout:
 * - With successor: auto-approve (execute_admin_transfer RPC)
 * - Without successor: fallback to designated super_admin
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await adminTransferTimeoutCheck();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/admin-transfer-timeout] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
