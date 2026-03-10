import { NextRequest, NextResponse } from "next/server";
import { evaluateOpsAlerts } from "@/lib/ops/alerts";
import { logAuditEventSafe } from "@/lib/ops/audit";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await evaluateOpsAlerts();
    await logAuditEventSafe({
      action: "ops_alert_evaluation_cron_run",
      entityType: "ops_alert",
      actorType: "cron",
      details: result,
    });
    const status = result.success ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
