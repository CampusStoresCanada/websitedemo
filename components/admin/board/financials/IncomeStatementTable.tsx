"use client";

import type {
  ComparativeReport,
  ComparativeSegment,
  ComparativeSubsection,
  ComparativeAccountRow,
  ComparativeValues,
} from "@/lib/quickbooks/types";
import TransactionPopover from "./TransactionPopover";

interface Props {
  report:   ComparativeReport;
  compact?: boolean; // drops Prior Year Full + Projected columns to fit narrower viewports
}

// ─── formatting ──────────────────────────────────────────────────

function fmtCAD(n: number | null): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style:                 "currency",
    currency:              "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtFiscalLabel(start: string, end: string): string {
  const sy = start.slice(0, 4);
  const ey = end.slice(0, 4);
  return `${sy}-${ey.slice(2)}`;
}

// ─── column headers ───────────────────────────────────────────────

// Full: 8 cols × 120px. Compact: 5 cols × 85px (drops Prior Year Full + Projected)
const COL_WIDTH_FULL    = "w-[120px] min-w-[100px]";
const COL_WIDTH_COMPACT = "w-[85px]  min-w-[75px]";

function fmtMonthYear(dateStr: string): string {
  // "2026-05-25" → "May '26"
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-CA", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function ColHeaders({ report, compact }: { report: ComparativeReport; compact: boolean }) {
  const cw           = compact ? COL_WIDTH_COMPACT : COL_WIDTH_FULL;
  const currentFY    = fmtFiscalLabel(report.fiscalYearStart, report.fiscalYearEnd);
  const priorFYStart = String(parseInt(report.fiscalYearStart.slice(0, 4)) - 1) + "-09-01";
  const priorFYEnd   = String(parseInt(report.fiscalYearStart.slice(0, 4)))     + "-08-31";
  const priorFY      = fmtFiscalLabel(priorFYStart, priorFYEnd);

  const priorYTDEndDate = String(parseInt(report.asOfDate.slice(0, 4)) - 1) + report.asOfDate.slice(4);
  const priorYTDLabel   = fmtMonthYear(priorYTDEndDate);
  const currentYTDLabel = fmtMonthYear(report.asOfDate);

  // compact: 5 cols (Last Month | Prior YTD | Current YTD | Budget | Variance)
  // full:    8 cols (+ Prior Year Full | Projected)
  const fullYearColSpan = compact ? 2 : 4;

  return (
    <thead>
      {/* Fiscal year labels */}
      <tr className="border-b border-gray-100 bg-gray-50">
        <th className="px-4 py-2 text-left text-xs font-medium text-gray-400" />
        <th className={`${cw} px-3 py-2 text-center text-xs font-semibold text-amber-700 border-l border-gray-100 bg-amber-50/60`}>
          {report.lastMonthLabel}
        </th>
        <th className={`${cw} px-3 py-2 text-center text-xs font-semibold text-gray-500 border-l border-gray-100`}>
          {priorFY} YTD
        </th>
        <th className={`${cw} px-3 py-2 text-center text-xs font-semibold text-[#163D6D] border-l border-gray-100`}>
          {currentFY} YTD
        </th>
        <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 border-l border-gray-100" colSpan={fullYearColSpan}>
          Full Year {currentFY}
        </th>
      </tr>
      {/* Column sub-labels */}
      <tr className="border-b border-gray-200 bg-gray-50 text-xs">
        <th className="px-4 py-2 text-left font-medium text-gray-500">Account</th>
        <th className={`${cw} px-3 py-2 text-right font-medium text-amber-700 border-l border-gray-100 bg-amber-50/60`}>
          Actual
        </th>
        <th className={`${cw} px-3 py-2 text-right font-medium text-gray-500 border-l border-gray-100`}>
          Actual<br />
          <span className="font-normal text-gray-400">to {priorYTDLabel}</span>
        </th>
        <th className={`${cw} px-3 py-2 text-right font-medium text-[#163D6D] border-l border-gray-100`}>
          Actual<br />
          <span className="font-normal text-[#163D6D]/60">to {currentYTDLabel}</span>
        </th>
        {!compact && (
          <>
            <th className={`${cw} px-3 py-2 text-right font-medium text-gray-500 border-l border-gray-100`}>
              Prior Year<br /><span className="font-normal text-gray-400">Full Actual</span>
            </th>
            <th className={`${cw} px-3 py-2 text-right font-medium text-gray-500 border-l border-gray-100`}>
              Projected<br /><span className="font-normal text-gray-400">YTD + Rem.</span>
            </th>
          </>
        )}
        <th className={`${cw} px-3 py-2 text-right font-medium text-gray-500 border-l border-gray-100`}>
          Budget<br /><span className="font-normal text-gray-400">Full Year</span>
        </th>
        <th className={`${cw} px-3 py-2 text-right font-medium text-gray-500 border-l border-gray-100`}>
          Variance<br /><span className="font-normal text-gray-400">Proj. vs Budget</span>
        </th>
      </tr>
    </thead>
  );
}

// ─── value cells ─────────────────────────────────────────────────

function ValueCells({
  values,
  isExpense = false,
  isBold = false,
  compact = false,
}: {
  values:    ComparativeValues;
  isExpense?: boolean;
  isBold?:   boolean;
  compact?:  boolean;
}) {
  const cw   = compact ? COL_WIDTH_COMPACT : COL_WIDTH_FULL;
  const base = isBold ? "font-semibold" : "font-normal";
  const varColor =
    values.variance === null ? "text-gray-400" :
    isExpense
      ? values.variance > 0 ? "text-red-600" : "text-green-600"
      : values.variance > 0 ? "text-green-600" : "text-red-600";

  return (
    <>
      <td className={`${cw} px-3 py-2 text-right tabular-nums text-amber-800 ${base} border-l border-gray-100 bg-amber-50/40`}>
        {fmtCAD(values.lastMonth)}
      </td>
      <td className={`${cw} px-3 py-2 text-right tabular-nums text-gray-500 ${base} border-l border-gray-100`}>
        {fmtCAD(values.priorYTD)}
      </td>
      <td className={`${cw} px-3 py-2 text-right tabular-nums text-[#163D6D] ${base} border-l border-gray-100`}>
        {fmtCAD(values.currentYTD)}
      </td>
      {!compact && (
        <>
          <td className={`${cw} px-3 py-2 text-right tabular-nums text-gray-500 ${base} border-l border-gray-100`}>
            {fmtCAD(values.priorFullYear)}
          </td>
          <td className={`${cw} px-3 py-2 text-right tabular-nums text-gray-700 ${base} border-l border-gray-100`}>
            {fmtCAD(values.projected)}
          </td>
        </>
      )}
      <td className={`${cw} px-3 py-2 text-right tabular-nums text-gray-700 ${base} border-l border-gray-100`}>
        {fmtCAD(values.budget)}
      </td>
      <td className={`${cw} px-3 py-2 text-right tabular-nums ${varColor} ${base} border-l border-gray-100`}>
        {fmtCAD(values.variance)}
      </td>
    </>
  );
}

// ─── account row ─────────────────────────────────────────────────

function AccountRow({
  row,
  indent,
  isExpense,
  report,
  compact,
}: {
  row:       ComparativeAccountRow;
  indent:    number;
  isExpense: boolean;
  report:    ComparativeReport;
  compact:   boolean;
}) {
  const pl = indent * 16;

  return (
    <tr className="group hover:bg-blue-50/40 border-b border-gray-50 transition-colors">
      <td className="px-4 py-1.5 text-sm" style={{ paddingLeft: `${16 + pl}px` }}>
        <TransactionPopover
          accountId={row.qboId}
          accountName={row.name}
          acctNum={row.accountNum}
          startDate={report.lastMonthStart}
          endDate={report.lastMonthEnd}
        >
          <span className="flex items-center gap-2">
            {row.accountNum && (
              <span className="text-xs text-gray-400 tabular-nums font-mono">{row.accountNum}</span>
            )}
            <span className="text-gray-800">{row.name}</span>
          </span>
        </TransactionPopover>
      </td>
      <ValueCells values={row.values} isExpense={isExpense} compact={compact} />
    </tr>
  );
}

// ─── subsection ──────────────────────────────────────────────────

function SubsectionRows({
  sub,
  indent,
  isExpense,
  report,
  compact,
}: {
  sub:       ComparativeSubsection;
  indent:    number;
  isExpense: boolean;
  report:    ComparativeReport;
  compact:   boolean;
}) {
  const pl      = indent * 16;
  const numCols = compact ? 5 : 7;

  return (
    <>
      <tr className="border-b border-gray-100 bg-gray-50/60">
        <td
          className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500"
          style={{ paddingLeft: `${16 + pl}px` }}
        >
          {sub.name}
        </td>
        <td colSpan={numCols} />
      </tr>

      {sub.rows.map(row => (
        <AccountRow key={row.qboId} row={row} indent={indent + 1} isExpense={isExpense} report={report} compact={compact} />
      ))}

      <tr className="border-b border-gray-200 bg-gray-50/40">
        <td
          className="px-4 py-1.5 text-xs font-semibold text-gray-600"
          style={{ paddingLeft: `${16 + pl}px` }}
        >
          Total {sub.name}
        </td>
        <ValueCells values={sub.total} isExpense={isExpense} isBold compact={compact} />
      </tr>
    </>
  );
}

// ─── segment ─────────────────────────────────────────────────────

function SegmentRows({
  segment,
  isExpense,
  report,
  compact,
}: {
  segment:   ComparativeSegment;
  isExpense: boolean;
  report:    ComparativeReport;
  compact:   boolean;
}) {
  const hasContent = segment.subsections.length > 0 || segment.directRows.length > 0;
  if (!hasContent) return null;
  const numCols = compact ? 6 : 8;

  return (
    <>
      <tr className="border-b border-gray-200 bg-gray-100">
        <td className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500" colSpan={numCols}>
          {segment.name}
        </td>
      </tr>

      {segment.subsections.map(sub => (
        <SubsectionRows
          key={sub.qboId || sub.name}
          sub={sub}
          indent={0}
          isExpense={isExpense}
          report={report}
          compact={compact}
        />
      ))}

      {segment.directRows.map(row => (
        <AccountRow key={row.qboId} row={row} indent={0} isExpense={isExpense} report={report} compact={compact} />
      ))}

      <tr className="border-b border-gray-300 bg-gray-100">
        <td className="px-4 py-2 text-sm font-bold text-gray-700">
          Total {segment.name}
        </td>
        <ValueCells values={segment.total} isExpense={isExpense} isBold compact={compact} />
      </tr>
    </>
  );
}

// ─── grand total row ─────────────────────────────────────────────

function GrandTotalRow({
  label,
  values,
  isExpense = false,
  accent = false,
  compact = false,
}: {
  label:      string;
  values:     ComparativeValues;
  isExpense?: boolean;
  accent?:    boolean;
  compact?:   boolean;
}) {
  return (
    <tr className={`border-b-2 border-gray-300 ${accent ? "bg-[#163D6D]/5" : "bg-gray-50"}`}>
      <td className="px-4 py-2.5 text-sm font-bold text-gray-900">{label}</td>
      <ValueCells values={values} isExpense={isExpense} isBold compact={compact} />
    </tr>
  );
}

// ─── section divider ─────────────────────────────────────────────

function SectionDivider({ label, compact }: { label: string; compact: boolean }) {
  const numCols = compact ? 6 : 8;
  return (
    <tr className="bg-[#163D6D]">
      <td className="px-4 py-2 text-sm font-bold uppercase tracking-wider text-white" colSpan={numCols}>
        {label}
      </td>
    </tr>
  );
}

// ─── main component ──────────────────────────────────────────────

export default function IncomeStatementTable({ report, compact = false }: Props) {
  const lml = report.lastMonthLabel ?? "";
  // Combined totals
  const totalRevValues: ComparativeValues = report.revenue.reduce(
    (acc, seg) => ({
      lastMonth:      (acc.lastMonth     ?? 0) + (seg.total.lastMonth     ?? 0),
      lastMonthLabel: lml,
      priorYTD:       (acc.priorYTD      ?? 0) + (seg.total.priorYTD      ?? 0),
      currentYTD:     (acc.currentYTD    ?? 0) + (seg.total.currentYTD    ?? 0),
      priorFullYear:  (acc.priorFullYear ?? 0) + (seg.total.priorFullYear ?? 0),
      budget:         (acc.budget        ?? 0) + (seg.total.budget        ?? 0),
      projected:      (acc.projected     ?? 0) + (seg.total.projected     ?? 0),
      variance:       (acc.variance      ?? 0) + (seg.total.variance      ?? 0),
    }),
    { lastMonth: 0, lastMonthLabel: lml, priorYTD: 0, currentYTD: 0, priorFullYear: 0, budget: 0, projected: 0, variance: 0 } as ComparativeValues
  );

  const totalExpValues: ComparativeValues = report.expenses.reduce(
    (acc, seg) => ({
      lastMonth:      (acc.lastMonth     ?? 0) + (seg.total.lastMonth     ?? 0),
      lastMonthLabel: lml,
      priorYTD:       (acc.priorYTD      ?? 0) + (seg.total.priorYTD      ?? 0),
      currentYTD:     (acc.currentYTD    ?? 0) + (seg.total.currentYTD    ?? 0),
      priorFullYear:  (acc.priorFullYear ?? 0) + (seg.total.priorFullYear ?? 0),
      budget:         (acc.budget        ?? 0) + (seg.total.budget        ?? 0),
      projected:      (acc.projected     ?? 0) + (seg.total.projected     ?? 0),
      variance:       (acc.variance      ?? 0) + (seg.total.variance      ?? 0),
    }),
    { lastMonth: 0, lastMonthLabel: lml, priorYTD: 0, currentYTD: 0, priorFullYear: 0, budget: 0, projected: 0, variance: 0 } as ComparativeValues
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      {/* Title */}
      <div className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-base font-semibold text-gray-900">
          Campus Stores Canada — Comparative Income Statement
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Fiscal year {report.fiscalYearStart} → {report.fiscalYearEnd} &middot; As of {report.asOfDate}
          {compact && <span className="ml-2 text-gray-400">· Prior Year &amp; Projected columns hidden</span>}
        </p>
      </div>

      <table className="w-full text-sm">
        <ColHeaders report={report} compact={compact} />
        <tbody>
          <SectionDivider label="Revenue" compact={compact} />
          {report.revenue.map(seg => (
            <SegmentRows key={seg.name} segment={seg} isExpense={false} report={report} compact={compact} />
          ))}
          <GrandTotalRow label="TOTAL REVENUE" values={totalRevValues} compact={compact} />

          <SectionDivider label="Expenses" compact={compact} />
          {report.expenses.map(seg => (
            <SegmentRows key={seg.name} segment={seg} isExpense report={report} compact={compact} />
          ))}
          <GrandTotalRow label="TOTAL EXPENSES" values={totalExpValues} isExpense compact={compact} />

          <SectionDivider label="Net Surplus / Deficit" compact={compact} />
          <GrandTotalRow label="NET SURPLUS (DEFICIT)" values={report.netIncome} accent compact={compact} />
        </tbody>
      </table>

      <div className="border-t border-gray-100 px-6 py-3 text-xs text-gray-400">
        Pulled from QuickBooks Online · {new Date(report.pulledAt).toLocaleString("en-CA")} · Hover any account row to see individual transactions.
      </div>
    </div>
  );
}
