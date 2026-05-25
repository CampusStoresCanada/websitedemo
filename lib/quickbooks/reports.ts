/**
 * QBO report parsing + comparative snapshot assembly
 *
 * Builds the full board-facing Comparative Income Statement from:
 *   - Three P&L date ranges (prior YTD, current YTD, prior full year)
 *   - QBO Budget entity (approved BOD budget)
 *   - Balance Sheet
 *   - Chart of Accounts (for account number mapping)
 *
 * Fiscal year: Sep 1 → Aug 31
 * Segments: account codes 4200-4299 = Conference Revenue
 *           account codes 5500-5599 = Conference Expenses
 *           everything else = Governance & Operations
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchQBReport,
  fetchQBAccounts,
  fetchQBBudgets,
  type FetchReportOptions,
} from "./client";
import {
  getFiscalYear,
  getPriorFiscalYear,
  priorYTDEnd,
  remainingBudgetMonths,
  elapsedBudgetMonths,
  getLastFullMonth,
} from "./fiscal";
import type {
  QBReport,
  QBSectionRow,
  QBDataRow,
  QBAccount,
  QBBudget,
  ComparativeReport,
  ComparativeSegment,
  ComparativeSubsection,
  ComparativeAccountRow,
  ComparativeValues,
  BalanceSheetData,
  BalanceSheetSection,
  QBFinancialSummary,
} from "./types";
import type { Json } from "@/lib/database.types";

// ─────────────────────────────────────────────────────────────────
// Constants — CSC account code ranges
// ─────────────────────────────────────────────────────────────────

const CONFERENCE_REVENUE_MIN  = 4200;
const CONFERENCE_REVENUE_MAX  = 4299;
const CONFERENCE_EXPENSE_MIN  = 5500;
const CONFERENCE_EXPENSE_MAX  = 5599;

function isConferenceRevenue(acctNum: string): boolean {
  const n = parseInt(acctNum);
  return n >= CONFERENCE_REVENUE_MIN && n <= CONFERENCE_REVENUE_MAX;
}

function isConferenceExpense(acctNum: string): boolean {
  const n = parseInt(acctNum);
  return n >= CONFERENCE_EXPENSE_MIN && n <= CONFERENCE_EXPENSE_MAX;
}

// ─────────────────────────────────────────────────────────────────
// Zero-value helper
// ─────────────────────────────────────────────────────────────────

function zeroValues(lastMonthLabel = ""): ComparativeValues {
  return {
    lastMonth: null, lastMonthLabel,
    priorYTD: null, currentYTD: null, priorFullYear: null,
    budget: null, projected: null, variance: null,
  };
}

function addValues(a: ComparativeValues, b: ComparativeValues): ComparativeValues {
  const add = (x: number | null, y: number | null) =>
    x === null && y === null ? null : (x ?? 0) + (y ?? 0);
  return {
    lastMonth:      add(a.lastMonth,     b.lastMonth),
    lastMonthLabel: a.lastMonthLabel || b.lastMonthLabel,
    priorYTD:       add(a.priorYTD,      b.priorYTD),
    currentYTD:     add(a.currentYTD,    b.currentYTD),
    priorFullYear:  add(a.priorFullYear, b.priorFullYear),
    budget:         add(a.budget,        b.budget),
    projected:      add(a.projected,     b.projected),
    variance:       add(a.variance,      b.variance),
  };
}

// ─────────────────────────────────────────────────────────────────
// P&L row parsing
// ─────────────────────────────────────────────────────────────────

function parseAmount(colData: Array<{ value: string }>, colIndex = 1): number | null {
  const cell = colData[colIndex];
  if (!cell) return null;
  const n = parseFloat(cell.value);
  return isNaN(n) ? null : n;
}

/** Recursively collect account-level data rows from a P&L report section */
function collectDataRows(
  rows: Array<QBDataRow | QBSectionRow>
): Array<{ id: string; name: string; amount: number | null }> {
  const result: Array<{ id: string; name: string; amount: number | null }> = [];
  for (const row of rows) {
    if (row.type === "Data") {
      const dr = row as QBDataRow;
      const id    = dr.ColData[0]?.id ?? "";
      const name  = dr.ColData[0]?.value ?? "";
      const amount = parseAmount(dr.ColData);
      if (id) result.push({ id, name, amount });
    } else if (row.type === "Section") {
      const sr = row as QBSectionRow;
      result.push(...collectDataRows(sr.Rows?.Row ?? []));
    }
  }
  return result;
}

/** Build a flat map of QBO account ID → amount from a P&L report */
function buildAmountMap(report: QBReport): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const row of report.Rows?.Row ?? []) {
    const rows = row.type === "Section"
      ? collectDataRows((row as QBSectionRow).Rows?.Row ?? [])
      : [];
    for (const r of rows) {
      if (r.id) map.set(r.id, r.amount);
    }
  }
  return map;
}

/**
 * Walk P&L report and build nested structure:
 * top-level Section → child Sections (sub-groups) → Data rows (leaf accounts)
 */
interface PLSection {
  id:       string;   // QBO ID of the parent account (or "" for top-level)
  name:     string;   // Section header label
  group?:   string;   // "Income" | "Expenses" | "NetIncome" etc.
  children: PLSection[];
  rows:     Array<{ id: string; name: string }>;
  total?:   number | null;
}

function buildPLTree(report: QBReport): PLSection[] {
  function parseSection(row: QBSectionRow): PLSection {
    const id   = row.Header?.ColData?.[0]?.id ?? "";
    const name = row.Header?.ColData?.[0]?.value ?? row.group ?? "";
    const children: PLSection[] = [];
    const rows: Array<{ id: string; name: string }> = [];

    for (const inner of row.Rows?.Row ?? []) {
      if (inner.type === "Section") {
        children.push(parseSection(inner as QBSectionRow));
      } else if (inner.type === "Data") {
        const dr = inner as QBDataRow;
        const rowId   = dr.ColData[0]?.id ?? "";
        const rowName = dr.ColData[0]?.value ?? "";
        if (rowId) rows.push({ id: rowId, name: rowName });
      }
    }

    const total = row.Summary?.ColData ? parseAmount(row.Summary.ColData) : null;
    return { id, name, group: row.group, children, rows, total };
  }

  return (report.Rows?.Row ?? [])
    .filter(r => r.type === "Section")
    .map(r => parseSection(r as QBSectionRow));
}

// ─────────────────────────────────────────────────────────────────
// Budget parsing
// ─────────────────────────────────────────────────────────────────

/** Find the best budget for the fiscal year (latest matching one) */
function findFiscalBudget(budgets: QBBudget[], fiscalStart: string): QBBudget | null {
  // Prefer budgets that start on or near the fiscal year start
  const matching = budgets.filter(b => b.BudgetType === "ProfitAndLoss");
  if (!matching.length) return budgets[0] ?? null;

  // Find one that starts closest to our fiscal year
  const scored = matching.map(b => ({
    budget: b,
    diff: Math.abs(new Date(b.StartDate).getTime() - new Date(fiscalStart).getTime()),
  }));
  scored.sort((a, b) => a.diff - b.diff);
  return scored[0]?.budget ?? null;
}

/**
 * Build a map of QBO account ID → full-year budget amount,
 * plus a map for the YTD budget (months elapsed through asOf)
 * and a map for the remaining months (months after asOf).
 *
 * "Elapsed" months = Sep through the month containing asOf (inclusive).
 * "Remaining" months = everything after that through Aug.
 */
function buildBudgetMaps(
  budget:      QBBudget | null,
  fiscalStart: string,
  fiscalEnd:   string,
  asOf:        string
): {
  fullYear:  Map<string, number>;
  ytd:       Map<string, number>;
  remaining: Map<string, number>;
} {
  const fullYear  = new Map<string, number>();
  const ytd       = new Map<string, number>();
  const remaining = new Map<string, number>();

  if (!budget?.BudgetDetail) return { fullYear, ytd, remaining };

  // Set of "YYYY-MM-01" strings for months already elapsed (Sep → current month inclusive)
  const elapsed   = new Set(elapsedBudgetMonths({ start: fiscalStart, end: fiscalEnd, label: "" }, asOf));
  // Set of "YYYY-MM-01" strings for months not yet started
  const remaining_ = new Set(remainingBudgetMonths({ start: fiscalStart, end: fiscalEnd, label: "" }, asOf));

  for (const detail of budget.BudgetDetail) {
    const id     = detail.AccountRef.value;
    // Normalise BudgetDate to YYYY-MM-01 (QBO sometimes sends first-of-month already)
    const month  = detail.BudgetDate.slice(0, 7) + "-01";
    const amount = detail.Amount;

    fullYear.set(id, (fullYear.get(id) ?? 0) + amount);

    if (elapsed.has(month)) {
      ytd.set(id, (ytd.get(id) ?? 0) + amount);
    }
    if (remaining_.has(month)) {
      remaining.set(id, (remaining.get(id) ?? 0) + amount);
    }
  }

  return { fullYear, ytd, remaining };
}

// ─────────────────────────────────────────────────────────────────
// Balance Sheet parsing
// ─────────────────────────────────────────────────────────────────

function parseBalanceSheetSection(
  rows: Array<QBDataRow | QBSectionRow>,
  depth = 0
): Array<{ name: string; value: number | null; indent: number }> {
  const result: Array<{ name: string; value: number | null; indent: number }> = [];
  for (const row of rows) {
    if (row.type === "Data") {
      const dr = row as QBDataRow;
      const name  = dr.ColData[0]?.value ?? "";
      const value = dr.ColData[1] ? parseFloat(dr.ColData[1].value) : null;
      if (name && name !== "") result.push({ name, value: isNaN(value as number) ? null : value, indent: depth });
    } else if (row.type === "Section") {
      const sr   = row as QBSectionRow;
      const name = sr.Header?.ColData?.[0]?.value ?? "";
      if (name) result.push({ name, value: null, indent: depth });
      result.push(...parseBalanceSheetSection(sr.Rows?.Row ?? [], depth + 1));
      if (sr.Summary?.ColData) {
        const total = parseFloat(sr.Summary.ColData[1]?.value ?? "");
        if (!isNaN(total) && sr.Summary.ColData[0]?.value) {
          result.push({ name: sr.Summary.ColData[0].value, value: total, indent: depth });
        }
      }
    }
  }
  return result;
}

function parseBalanceSheet(report: QBReport, asOfDate: string): BalanceSheetData {
  const assets:      BalanceSheetSection[] = [];
  const liabilities: BalanceSheetSection[] = [];
  const equity:      BalanceSheetSection[] = [];

  let totalAssets      = null;
  let totalLiabilities = null;
  let totalEquity      = null;

  for (const row of report.Rows?.Row ?? []) {
    if (row.type !== "Section") continue;
    const sr    = row as QBSectionRow;
    const group = sr.group ?? "";
    const name  = sr.Header?.ColData?.[0]?.value ?? group;
    const rows  = parseBalanceSheetSection(sr.Rows?.Row ?? []);
    const total = sr.Summary?.ColData ? parseFloat(sr.Summary.ColData[1]?.value ?? "") : null;
    const section: BalanceSheetSection = { name, rows, total: isNaN(total as number) ? null : total };

    if (group === "Assets" || name.toLowerCase().includes("asset")) {
      assets.push(section);
      totalAssets = section.total;
    } else if (group === "Liabilities" || name.toLowerCase().includes("liabilit")) {
      liabilities.push(section);
      totalLiabilities = section.total;
    } else if (group === "Equity" || name.toLowerCase().includes("equity")) {
      equity.push(section);
      totalEquity = section.total;
    } else {
      // fallback by position
      if (!assets.length) assets.push(section);
      else if (!liabilities.length) liabilities.push(section);
      else equity.push(section);
    }
  }

  return { asOfDate, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity };
}

// ─────────────────────────────────────────────────────────────────
// Comparative assembly
// ─────────────────────────────────────────────────────────────────

/**
 * Build the full ComparativeReport from the four P&L amount maps + budget maps.
 * Uses the QBO P&L tree from the current YTD report as the structural backbone.
 */
function assembleComparative(
  plTree:           PLSection[],
  currentYTDMap:    Map<string, number | null>,
  priorYTDMap:      Map<string, number | null>,
  priorFullMap:     Map<string, number | null>,
  lastMonthMap:     Map<string, number | null>,
  lastMonthLabel:   string,
  budgetFull:       Map<string, number>,
  budgetRemaining:  Map<string, number>,
  accountsMap:      Map<string, QBAccount>,
  asOf:             string,
  fiscalStart:      string,
  fiscalEnd:        string,
): Pick<ComparativeReport, "revenue" | "expenses" | "netIncome" | "accountMap"> {

  const accountMap: Record<string, { id: string; name: string; num: string }> = {};

  function resolveAcctNum(qboId: string, fallbackName: string): string {
    const acct = accountsMap.get(qboId);
    return acct?.AcctNum ?? "";
  }

  function buildRowValues(qboId: string): ComparativeValues {
    const lastMonth     = lastMonthMap.get(qboId)   ?? null;
    const currentYTD    = currentYTDMap.get(qboId)  ?? null;
    const priorYTD      = priorYTDMap.get(qboId)    ?? null;
    const priorFullYear = priorFullMap.get(qboId)   ?? null;
    const budget        = budgetFull.has(qboId)      ? budgetFull.get(qboId)!      : null;
    const remaining     = budgetRemaining.has(qboId) ? budgetRemaining.get(qboId)! : null;

    // Projected = YTD actual + sum of budgeted amounts for remaining months
    const projected = currentYTD !== null && remaining !== null
      ? currentYTD + remaining
      : null;

    // Variance = projected − full-year budget
    const variance = projected !== null && budget !== null
      ? projected - budget
      : null;

    return { lastMonth, lastMonthLabel, priorYTD, currentYTD, priorFullYear, budget, projected, variance };
  }

  function buildAccountRow(id: string, name: string): ComparativeAccountRow {
    const acctNum = resolveAcctNum(id, name);
    const acct    = accountsMap.get(id);
    const displayName = acct?.Name ?? name;
    accountMap[id] = { id, name: displayName, num: acctNum };
    return { qboId: id, accountNum: acctNum, name: displayName, values: buildRowValues(id) };
  }

  function buildSubsection(section: PLSection): ComparativeSubsection {
    const rows: ComparativeAccountRow[] = [];
    for (const r of section.rows) {
      rows.push(buildAccountRow(r.id, r.name));
    }
    for (const child of section.children) {
      rows.push(...buildSubsection(child).rows);
    }

    let total = zeroValues(lastMonthLabel);
    for (const r of rows) total = addValues(total, r.values);

    return {
      qboId: section.id,
      name:  section.name,
      rows,
      total,
    };
  }

  function buildSegment(
    sections: PLSection[],
    segmentName: string,
    type: "revenue" | "expense",
    isConferenceFn: (num: string) => boolean,
  ): { gno: ComparativeSegment; conf: ComparativeSegment } {
    const gnoSubsections:  ComparativeSubsection[] = [];
    const confSubsections: ComparativeSubsection[] = [];
    const gnoDirectRows:   ComparativeAccountRow[] = [];
    const confDirectRows:  ComparativeAccountRow[] = [];

    for (const section of sections) {
      // Figure out if this section is Conference or G&O based on first account code
      // or the section header account ID
      const firstAccountId  = section.rows[0]?.id ?? section.id;
      const firstAcctNum    = resolveAcctNum(firstAccountId, "");
      const sectionAcctNum  = resolveAcctNum(section.id, "");
      const testNum = sectionAcctNum || firstAcctNum;

      const isConf = testNum ? isConferenceFn(testNum) : false;

      if (section.children.length === 0 && section.rows.length > 0) {
        // Leaf section — direct rows
        for (const r of section.rows) {
          const num = resolveAcctNum(r.id, "");
          const row = buildAccountRow(r.id, r.name);
          if (num ? isConferenceFn(num) : isConf) {
            confDirectRows.push(row);
          } else {
            gnoDirectRows.push(row);
          }
        }
      } else {
        const sub = buildSubsection(section);
        // Determine segment by checking the subsection's account numbers
        const anyConf = sub.rows.some(r => r.accountNum ? isConferenceFn(r.accountNum) : false);
        const anyGno  = sub.rows.some(r => r.accountNum ? !isConferenceFn(r.accountNum) : false);

        if (anyConf && !anyGno) {
          confSubsections.push(sub);
        } else if (anyGno && !anyConf) {
          gnoSubsections.push(sub);
        } else if (anyConf) {
          confSubsections.push(sub);
        } else {
          gnoSubsections.push(sub);
        }
      }
    }

    function totalOf(subs: ComparativeSubsection[], directs: ComparativeAccountRow[]): ComparativeValues {
      let t = zeroValues(lastMonthLabel);
      for (const s of subs) t = addValues(t, s.total);
      for (const r of directs) t = addValues(t, r.values);
      return t;
    }

    return {
      gno: {
        name: "Governance & Operations",
        type,
        subsections: gnoSubsections,
        directRows:  gnoDirectRows,
        total:       totalOf(gnoSubsections, gnoDirectRows),
      },
      conf: {
        name: "Campus Stores Conference",
        type,
        subsections: confSubsections,
        directRows:  confDirectRows,
        total:       totalOf(confSubsections, confDirectRows),
      },
    };
  }

  // Split P&L tree into Income / Expense top sections
  const incomeSections  = plTree.filter(s => s.group === "Income"   || s.name.toLowerCase().includes("income") || s.name.toLowerCase().includes("revenue"));
  const expenseSections = plTree.filter(s => s.group === "Expenses" || s.name.toLowerCase().includes("expense"));

  const { gno: gnoRevenue,  conf: confRevenue  } = buildSegment(incomeSections,  "Revenue",  "revenue",  isConferenceRevenue);
  const { gno: gnoExpenses, conf: confExpenses } = buildSegment(expenseSections, "Expenses", "expense",  isConferenceExpense);

  // Net income
  const allRevTotals  = addValues(gnoRevenue.total,  confRevenue.total);
  const allExpTotals  = addValues(gnoExpenses.total, confExpenses.total);

  const sub = (a: number | null, b: number | null) =>
    a === null && b === null ? null : (a ?? 0) - (b ?? 0);

  const netIncome: ComparativeValues = {
    lastMonth:      sub(allRevTotals.lastMonth,     allExpTotals.lastMonth),
    lastMonthLabel,
    priorYTD:       sub(allRevTotals.priorYTD,      allExpTotals.priorYTD),
    currentYTD:     sub(allRevTotals.currentYTD,    allExpTotals.currentYTD),
    priorFullYear:  sub(allRevTotals.priorFullYear, allExpTotals.priorFullYear),
    budget:         sub(allRevTotals.budget,        allExpTotals.budget),
    projected:      sub(allRevTotals.projected,     allExpTotals.projected),
    variance:       sub(allRevTotals.variance,      allExpTotals.variance),
  };

  return {
    revenue:    [gnoRevenue,  confRevenue],
    expenses:   [gnoExpenses, confExpenses],
    netIncome,
    accountMap,
  };
}

// ─────────────────────────────────────────────────────────────────
// Main pull function
// ─────────────────────────────────────────────────────────────────

export interface PullReportsOptions extends FetchReportOptions {
  meetingId?: string;
}

export interface PullReportsResult {
  report:     ComparativeReport;
  snapshotId: string;
  /** Legacy summary for the existing dashboard widget */
  summary:    QBFinancialSummary;
}

/**
 * Pull all QBO data, assemble the comparative report, and persist to
 * board_qbo_snapshots.
 */
export async function pullAndCacheQBOReports(
  options: PullReportsOptions = {}
): Promise<PullReportsResult> {
  const today  = new Date().toISOString().slice(0, 10);
  const asOf   = options.endDate ?? today;

  const fiscal      = getFiscalYear(asOf);
  const priorFiscal = getPriorFiscalYear(asOf);
  const priorYTDEnd_ = priorYTDEnd(fiscal, asOf);

  const acctMethod   = options.accountingMethod ?? "Accrual";

  // When endDate is explicitly provided it IS the last day of the month we want.
  // getLastFullMonth(asOf) would back up one additional month (it finds the month
  // BEFORE asOf), so we derive the month directly from asOf instead.
  const lastFullMonth = options.endDate
    ? (() => {
        const start = asOf.slice(0, 7) + "-01";
        const label = new Date(start + "T12:00:00Z").toLocaleDateString("en-CA", {
          month: "short", year: "numeric", timeZone: "UTC",
        });
        return { start, end: asOf, label };
      })()
    : getLastFullMonth(asOf);

  // Parallel fetch — all reports + accounts + budgets
  const [
    currentYTDReport,
    priorYTDReport,
    priorFullReport,
    lastMonthReport,
    balanceSheetReport,
    accounts,
    budgets,
  ] = await Promise.all([
    fetchQBReport("ProfitAndLoss", { startDate: fiscal.start,          endDate: asOf,               accountingMethod: acctMethod }),
    fetchQBReport("ProfitAndLoss", { startDate: priorFiscal.start,     endDate: priorYTDEnd_,        accountingMethod: acctMethod }),
    fetchQBReport("ProfitAndLoss", { startDate: priorFiscal.start,     endDate: priorFiscal.end,     accountingMethod: acctMethod }),
    fetchQBReport("ProfitAndLoss", { startDate: lastFullMonth.start,   endDate: lastFullMonth.end,   accountingMethod: acctMethod }),
    fetchQBReport("BalanceSheet",  { startDate: fiscal.start,          endDate: asOf }),
    fetchQBAccounts(),
    fetchQBBudgets(),
  ]);

  const accountsMap = new Map(accounts.map(a => [a.Id, a]));

  // Build amount maps from each P&L report
  const currentYTDMap = buildAmountMap(currentYTDReport);
  const priorYTDMap   = buildAmountMap(priorYTDReport);
  const priorFullMap  = buildAmountMap(priorFullReport);
  const lastMonthMap  = buildAmountMap(lastMonthReport);

  // Budget maps
  const fiscalBudget = findFiscalBudget(budgets, fiscal.start);
  const { fullYear: budgetFull, remaining: budgetRemaining } = buildBudgetMaps(fiscalBudget, fiscal.start, fiscal.end, asOf);

  // Use current YTD report as structural backbone
  const plTree = buildPLTree(currentYTDReport);

  const { revenue, expenses, netIncome, accountMap } = assembleComparative(
    plTree,
    currentYTDMap,
    priorYTDMap,
    priorFullMap,
    lastMonthMap,
    lastFullMonth.label,
    budgetFull,
    budgetRemaining,
    accountsMap,
    asOf,
    fiscal.start,
    fiscal.end,
  );

  const balanceSheet = parseBalanceSheet(balanceSheetReport, asOf);

  const report: ComparativeReport = {
    fiscalYearStart: fiscal.start,
    fiscalYearEnd:   fiscal.end,
    asOfDate:        asOf,
    lastMonthLabel:  lastFullMonth.label,
    lastMonthStart:  lastFullMonth.start,
    lastMonthEnd:    lastFullMonth.end,
    pulledAt:        new Date().toISOString(),
    accountMap,
    revenue,
    expenses,
    netIncome,
    balanceSheet,
  };

  // Legacy summary for dashboard widget
  const summary: QBFinancialSummary = {
    netIncome:          netIncome.currentYTD,
    totalRevenue:       (revenue[0]?.total.currentYTD ?? 0) + (revenue[1]?.total.currentYTD ?? 0),
    totalExpenses:      (expenses[0]?.total.currentYTD ?? 0) + (expenses[1]?.total.currentYTD ?? 0),
    cashOnHand:         balanceSheet.assets[0]?.rows.find(r => r.name.toLowerCase().includes("cash"))?.value ?? null,
    accountsReceivable: balanceSheet.assets[0]?.rows.find(r => r.name.toLowerCase().includes("accounts receivable"))?.value ?? null,
    totalAssets:        balanceSheet.totalAssets,
    periodStart:        fiscal.start,
    periodEnd:          asOf,
    reportPulledAt:     report.pulledAt,
  };

  // Persist
  const db = createAdminClient();
  const { data: snapshot, error } = await db
    .from("board_qbo_snapshots")
    .upsert(
      {
        meeting_id:      options.meetingId ?? null,
        period_end_date: asOf,
        report_type:     "combined",
        data_json:       report as unknown as Json,
      },
      { onConflict: "meeting_id,report_type" }
    )
    .select("id")
    .single();

  if (error || !snapshot) {
    throw new Error(`Failed to save QBO snapshot: ${error?.message ?? "unknown error"}`);
  }

  return { report, snapshotId: snapshot.id, summary };
}

// ─────────────────────────────────────────────────────────────────
// Read latest snapshot
// ─────────────────────────────────────────────────────────────────

/**
 * Returns the financial snapshot linked to a specific board meeting.
 * Returns null if no snapshot has been pulled for this meeting yet.
 */
export async function getMeetingFinancialReport(meetingId: string): Promise<ComparativeReport | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("board_qbo_snapshots")
    .select("data_json, pulled_at")
    .eq("meeting_id", meetingId)
    .order("pulled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  if (!isComparativeReport(data.data_json)) return null;
  return data.data_json as unknown as ComparativeReport;
}

/** Returns true if the JSON blob is a new-format ComparativeReport (not the legacy flat summary) */
function isComparativeReport(obj: unknown): obj is ComparativeReport {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "fiscalYearStart" in obj &&
    "revenue" in obj &&
    Array.isArray((obj as ComparativeReport).revenue)
  );
}

export async function getLatestComparativeReport(): Promise<ComparativeReport | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("board_qbo_snapshots")
    .select("data_json, pulled_at")
    .eq("report_type", "combined")
    .order("pulled_at", { ascending: false })
    .limit(10);

  if (!data?.length) return null;

  // Find the newest snapshot in the new ComparativeReport format —
  // old snapshots stored a flat QBFinancialSummary and must be skipped.
  const newFormat = data.find(row => isComparativeReport(row.data_json));
  if (!newFormat) return null;

  return newFormat.data_json as unknown as ComparativeReport;
}

/** Legacy helper — still used by the existing dashboard metric cards */
export async function getLatestFinancialSummary(): Promise<QBFinancialSummary | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("board_qbo_snapshots")
    .select("data_json, pulled_at")
    .eq("report_type", "combined")
    .order("pulled_at", { ascending: false })
    .limit(10);

  if (!data) return null;

  // Find the newest snapshot that is in the new ComparativeReport format
  const newFormat = data.find(row => isComparativeReport(row.data_json));
  if (newFormat) {
    const report = newFormat.data_json as unknown as ComparativeReport;
    const allRevenue  = (report.revenue[0]?.total.currentYTD  ?? 0) + (report.revenue[1]?.total.currentYTD  ?? 0);
    const allExpenses = (report.expenses[0]?.total.currentYTD ?? 0) + (report.expenses[1]?.total.currentYTD ?? 0);
    return {
      netIncome:          report.netIncome.currentYTD,
      totalRevenue:       allRevenue,
      totalExpenses:      allExpenses,
      cashOnHand:         report.balanceSheet.assets[0]?.rows.find(r => r.name.toLowerCase().includes("cash"))?.value ?? null,
      accountsReceivable: report.balanceSheet.assets[0]?.rows.find(r => r.name.toLowerCase().includes("accounts receivable"))?.value ?? null,
      totalAssets:        report.balanceSheet.totalAssets,
      periodStart:        report.fiscalYearStart,
      periodEnd:          report.asOfDate,
      reportPulledAt:     report.pulledAt,
    };
  }

  // Fall back to legacy flat-summary format
  const legacyRow = data[0];
  if (!legacyRow) return null;
  const legacy = legacyRow.data_json as unknown as QBFinancialSummary;
  return legacy ?? null;
}
