import { NextRequest, NextResponse } from "next/server";
import { quickbooksExportRun } from "@/lib/quickbooks/export";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await quickbooksExportRun();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/qbo-export] Unhandled error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
