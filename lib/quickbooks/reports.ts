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

function zeroValues(): ComparativeValues {
  return {
    priorYTD: null, currentYTD: null, priorFullYear: null,
    budget: null, projected: null, variance: null,
  };
}

function addValues(a: ComparativeValues, b: ComparativeValues): ComparativeValues {
  const add = (x: number | null, y: number | null) =>
    x === null && y === null ? null : (x ?? 0) + (y ?? 0);
  return {
    priorYTD:      add(a.priorYTD,      b.priorYTD),
    currentYTD:    add(a.currentYTD,    b.currentYTD),
    priorFullYear: add(a.priorFullYear, b.priorFullYear),
    budget:        add(a.budget,        b.budget),
    projected:     add(a.projected,     b.projected),
    variance:      add(a.variance,      b.variance),
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
 * Build a map of QBO account ID → full-year budget amount
 * and a separate map for YTD budget (months elapsed).
 */
function buildBudgetMaps(
  budget: QBBudget | null,
  fiscalStart: string,
  asOf: string
): {
  fullYear: Map<string, number>;
  ytd:      Map<string, number>;
} {
  const fullYear = new Map<string, number>();
  const ytd      = new Map<string, number>();

  if (!budget?.BudgetDetail) return { fullYear, ytd };

  const elapsedMonths = new Set(elapsedBudgetMonths({ start: fiscalStart, end: "", label: "" }, asOf));

  for (const detail of budget.BudgetDetail) {
    const id     = detail.AccountRef.value;
    const month  = detail.BudgetDate.slice(0, 7) + "-01"; // normalise to YYYY-MM-01
    const amount = detail.Amount;

    fullYear.set(id, (fullYear.get(id) ?? 0) + amount);

    if (elapsedMonths.has(month)) {
      ytd.set(id, (ytd.get(id) ?? 0) + amount);
    }
  }

  return { fullYear, ytd };
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
  plTree:         PLSection[],
  currentYTDMap:  Map<string, number | null>,
  priorYTDMap:    Map<string, number | null>,
  priorFullMap:   Map<string, number | null>,
  budgetFull:     Map<string, number>,
  budgetYTD:      Map<string, number>,
  accountsMap:    Map<string, QBAccount>,
  asOf:           string,
  fiscalStart:    string,
  fiscalEnd:      string,
): Pick<ComparativeReport, "revenue" | "expenses" | "netIncome" | "accountMap"> {

  const accountMap: Record<string, { id: string; name: string; num: string }> = {};

  function resolveAcctNum(qboId: string, fallbackName: string): string {
    const acct = accountsMap.get(qboId);
    return acct?.AcctNum ?? "";
  }

  function buildRowValues(qboId: string): ComparativeValues {
    const currentYTD    = currentYTDMap.get(qboId) ?? null;
    const priorYTD      = priorYTDMap.get(qboId)   ?? null;
    const priorFullYear = priorFullMap.get(qboId)   ?? null;
    const budget        = budgetFull.has(qboId) ? budgetFull.get(qboId)! : null;
    const ytdBudget     = budgetYTD.has(qboId)  ? budgetYTD.get(qboId)!  : 0;

    // Remaining budget = full year budget - YTD budget
    const remainingBudget = budget !== null ? budget - ytdBudget : null;

    // Projected = YTD actual + remaining budget
    const projected = currentYTD !== null && remainingBudget !== null
      ? currentYTD + remainingBudget
      : currentYTD; // if no budget, projected = YTD actual

    const variance = projected !== null && budget !== null
      ? projected - budget
      : null;

    return { priorYTD, currentYTD, priorFullYear, budget, projected, variance };
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

    let total = zeroValues();
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
      let t = zeroValues();
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
  let netIncome = zeroValues();
  const allRevTotals  = addValues(gnoRevenue.total,  confRevenue.total);
  const allExpTotals  = addValues(gnoExpenses.total, confExpenses.total);

  const sub = (a: number | null, b: number | null) =>
    a === null && b === null ? null : (a ?? 0) - (b ?? 0);

  netIncome = {
    priorYTD:      sub(allRevTotals.priorYTD,      allExpTotals.priorYTD),
    currentYTD:    sub(allRevTotals.currentYTD,    allExpTotals.currentYTD),
    priorFullYear: sub(allRevTotals.priorFullYear, allExpTotals.priorFullYear),
    budget:        sub(allRevTotals.budget,        allExpTotals.budget),
    projected:     sub(allRevTotals.projected,     allExpTotals.projected),
    variance:      sub(allRevTotals.variance,      allExpTotals.variance),
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

  const acctMethod = options.accountingMethod ?? "Accrual";

  // Parallel fetch — all reports + accounts + budgets
  const [
    currentYTDReport,
    priorYTDReport,
    priorFullReport,
    balanceSheetReport,
    accounts,
    budgets,
  ] = await Promise.all([
    fetchQBReport("ProfitAndLoss", { startDate: fiscal.start,       endDate: asOf,          accountingMethod: acctMethod }),
    fetchQBReport("ProfitAndLoss", { startDate: priorFiscal.start,  endDate: priorYTDEnd_,  accountingMethod: acctMethod }),
    fetchQBReport("ProfitAndLoss", { startDate: priorFiscal.start,  endDate: priorFiscal.end, accountingMethod: acctMethod }),
    fetchQBReport("BalanceSheet",  { startDate: fiscal.start,       endDate: asOf }),
    fetchQBAccounts(),
    fetchQBBudgets(),
  ]);

  const accountsMap = new Map(accounts.map(a => [a.Id, a]));

  // Build amount maps from each P&L report
  const currentYTDMap = buildAmountMap(currentYTDReport);
  const priorYTDMap   = buildAmountMap(priorYTDReport);
  const priorFullMap  = buildAmountMap(priorFullReport);

  // Budget maps
  const fiscalBudget = findFiscalBudget(budgets, fiscal.start);
  const { fullYear: budgetFull, ytd: budgetYTD } = buildBudgetMaps(fiscalBudget, fiscal.start, asOf);

  // Use current YTD report as structural backbone
  const plTree = buildPLTree(currentYTDReport);

  const { revenue, expenses, netIncome, accountMap } = assembleComparative(
    plTree,
    currentYTDMap,
    priorYTDMap,
    priorFullMap,
    budgetFull,
    budgetYTD,
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
    .insert({
      meeting_id:      options.meetingId ?? null,
      period_end_date: asOf,
      report_type:     "combined",
      data_json:       report as unknown as Json,
    })
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

export async function getLatestComparativeReport(): Promise<ComparativeReport | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("board_qbo_snapshots")
    .select("data_json, pulled_at")
    .eq("report_type", "combined")
    .order("pulled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return data.data_json as unknown as ComparativeReport;
}

/** Legacy helper — still used by the existing dashboard metric cards */
export async function getLatestFinancialSummary(): Promise<QBFinancialSummary | null> {
  const report = await getLatestComparativeReport();
  if (!report) return null;

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
