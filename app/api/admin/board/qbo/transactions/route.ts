/**
 * GET /api/admin/board/qbo/transactions
 *
 * Live transaction detail for an account — powers the income statement hover popover.
 * Calls QBO GeneralLedger report filtered to a single account + date range.
 *
 * Query params:
 *   accountId  — QBO account ID (required)
 *   start      — YYYY-MM-DD (default: fiscal year start)
 *   end        — YYYY-MM-DD (default: today)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { fetchQBTransactions } from "@/lib/quickbooks/client";
import { getFiscalYear } from "@/lib/quickbooks/fiscal";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const accountId = searchParams.get("accountId");
  const today     = new Date().toISOString().slice(0, 10);
  const fiscal    = getFiscalYear(today);
  const start     = searchParams.get("start") ?? fiscal.start;
  const end       = searchParams.get("end")   ?? today;

  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  try {
    const transactions = await fetchQBTransactions({ accountId, startDate: start, endDate: end });
    return NextResponse.json({ transactions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
