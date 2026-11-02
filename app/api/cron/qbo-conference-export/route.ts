import { NextRequest, NextResponse } from "next/server";
import {
  quickbooksConferenceReceiptExportRun,
  quickbooksConferenceRefundExportRun,
  quickbooksMiscReceiptExportRun,
} from "@/lib/quickbooks/conference-export";
import { quickbooksExpenseBillExportRun } from "@/lib/quickbooks/expense-bills";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [receipts, refunds, miscReceipts, expenseBills] = await Promise.all([
      quickbooksConferenceReceiptExportRun(),
      quickbooksConferenceRefundExportRun(),
      quickbooksMiscReceiptExportRun(),
      quickbooksExpenseBillExportRun(),
    ]);
    return NextResponse.json({ receipts, refunds, miscReceipts, expenseBills });
  } catch (error) {
    console.error("[cron/qbo-conference-export] Unhandled error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
