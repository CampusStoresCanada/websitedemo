/**
 * QBO report parsing + Supabase caching
 *
 * Fetches P&L and Balance Sheet from QuickBooks, extracts key figures,
 * and stores them in board_qbo_snapshots so the board dashboard widget
 * can read them without hitting QBO every page load.
 *
 * Key figures extracted:
 *   P&L  → netIncome, totalRevenue, totalExpenses
 *   BS   → cashOnHand, accountsReceivable, totalAssets
 *
 * Schema: board_qbo_snapshots(id, meeting_id, period_end_date, report_type,
 *                              data_json, pulled_at, approved_by)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchQBReport, type FetchReportOptions } from "./client";
import type { QBReport, QBSectionRow, QBFinancialSummary } from "./types";
import type { Json } from "@/lib/database.types";

// ─────────────────────────────────────────────────────────────────
// Parse helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Read the last ColData entry (always the "Total" column) and parse as number.
 */
function summaryValue(colData: Array<{ value: string }>): number | null {
  const last = colData[colData.length - 1];
  if (!last) return null;
  const n = parseFloat(last.value);
  return isNaN(n) ? null : n;
}

/**
 * Walk top-level Rows looking for a Section whose `group` matches.
 * Returns the Summary total, or null if not found.
 */
function findGroupTotal(report: QBReport, group: string): number | null {
  for (const row of report.Rows.Row ?? []) {
    if (row.type === "Section" && (row as QBSectionRow).group === group) {
      const summary = (row as QBSectionRow).Summary;
      if (summary?.ColData) return summaryValue(summary.ColData);
    }
  }
  return null;
}

/**
 * Walk ALL rows (top-level and nested) looking for a Section whose Header
 * label starts with the given string (case-insensitive).
 * Used for Balance Sheet where Cash / AR live inside parent sections.
 */
function findLabelledTotal(report: QBReport, labelPrefix: string): number | null {
  const lower = labelPrefix.toLowerCase();

  function scan(rows: QBReport["Rows"]["Row"]): number | null {
    for (const row of rows ?? []) {
      if (row.type === "Section") {
        const sec = row as QBSectionRow;
        const headerText = sec.Header?.ColData?.[0]?.value ?? "";
        if (headerText.toLowerCase().startsWith(lower) && sec.Summary?.ColData) {
          return summaryValue(sec.Summary.ColData);
        }
        const nested = scan(sec.Rows?.Row);
        if (nested !== null) return nested;
      }
    }
    return null;
  }

  return scan(report.Rows.Row);
}

// ─────────────────────────────────────────────────────────────────
// Public parse functions (exported for tests / direct use)
// ─────────────────────────────────────────────────────────────────

export function parseProfitAndLoss(report: QBReport): Pick<
  QBFinancialSummary,
  "netIncome" | "totalRevenue" | "totalExpenses"
> {
  return {
    totalRevenue:  findGroupTotal(report, "Income"),
    totalExpenses: findGroupTotal(report, "Expenses"),
    netIncome:     findGroupTotal(report, "NetIncome"),
  };
}

export function parseBalanceSheet(report: QBReport): Pick<
  QBFinancialSummary,
  "cashOnHand" | "accountsReceivable" | "totalAssets"
> {
  return {
    cashOnHand:         findLabelledTotal(report, "Cash"),
    accountsReceivable: findLabelledTotal(report, "Accounts Receivable"),
    totalAssets:        findGroupTotal(report, "Assets") ?? findLabelledTotal(report, "Total Assets"),
  };
}

// ─────────────────────────────────────────────────────────────────
// Pull + cache
// ─────────────────────────────────────────────────────────────────

export interface PullReportsOptions extends FetchReportOptions {
  /** Link snapshot to a specific board meeting (optional) */
  meetingId?: string;
}

export interface PullReportsResult {
  summary:    QBFinancialSummary;
  snapshotId: string;
}

/**
 * Fetch P&L + Balance Sheet from QBO, parse key figures, and insert a row
 * in board_qbo_snapshots.  Returns the parsed summary and new snapshot ID.
 */
export async function pullAndCacheQBOReports(
  options: PullReportsOptions = {}
): Promise<PullReportsResult> {
  const today        = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";

  const startDate        = options.startDate        ?? firstOfMonth;
  const endDate          = options.endDate          ?? today;
  const accountingMethod = options.accountingMethod ?? "Accrual";

  const fetchOpts: FetchReportOptions = { startDate, endDate, accountingMethod };

  // Fetch both reports in parallel
  const [plReport, bsReport] = await Promise.all([
    fetchQBReport("ProfitAndLoss", fetchOpts),
    fetchQBReport("BalanceSheet",  fetchOpts),
  ]);

  const plData = parseProfitAndLoss(plReport);
  const bsData = parseBalanceSheet(bsReport);

  const summary: QBFinancialSummary = {
    ...plData,
    ...bsData,
    periodStart:    startDate,
    periodEnd:      endDate,
    reportPulledAt: new Date().toISOString(),
  };

  // Persist to board_qbo_snapshots
  // Schema: id, meeting_id, period_end_date, report_type, data_json, pulled_at, approved_by
  const db = createAdminClient();

  const { data: snapshot, error } = await db
    .from("board_qbo_snapshots")
    .insert({
      meeting_id:      options.meetingId ?? null,
      period_end_date: endDate,
      report_type:     "combined",
      data_json:       summary as unknown as Json,
    })
    .select("id")
    .single();

  if (error || !snapshot) {
    throw new Error(`Failed to save QBO snapshot: ${error?.message ?? "unknown error"}`);
  }

  return { summary, snapshotId: snapshot.id };
}

// ─────────────────────────────────────────────────────────────────
// Read latest snapshot (dashboard widget — no live QBO call)
// ─────────────────────────────────────────────────────────────────

/**
 * Returns the most recent combined snapshot from Supabase.
 * Returns null if none exists yet.
 */
export async function getLatestFinancialSummary(): Promise<QBFinancialSummary | null> {
  const db = createAdminClient();

  const { data } = await db
    .from("board_qbo_snapshots")
    .select("data_json, pulled_at")
    .eq("report_type", "combined")
    .order("pulled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  // data_json is the full QBFinancialSummary object we stored
  return data.data_json as unknown as QBFinancialSummary;
}
