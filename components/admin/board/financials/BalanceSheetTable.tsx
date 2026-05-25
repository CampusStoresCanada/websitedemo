"use client";

import type { BalanceSheetData, BalanceSheetSection } from "@/lib/quickbooks/types";

interface Props {
  data:    BalanceSheetData;
  asOf:    string;
  pulledAt: string;
}

function fmtCAD(n: number | null): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style:                 "currency",
    currency:              "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

function SectionBlock({ section, accentColor }: { section: BalanceSheetSection; accentColor: string }) {
  return (
    <div className="mb-4">
      <div className={`px-4 py-2 text-xs font-bold uppercase tracking-wider ${accentColor}`}>
        {section.name}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {section.rows.map((row, i) => {
            const isTotal = row.name.toLowerCase().startsWith("total");
            return (
              <tr
                key={i}
                className={`border-b border-gray-50 ${
                  isTotal ? "bg-gray-50 font-semibold" : "hover:bg-gray-50/50"
                }`}
              >
                <td
                  className="py-1.5 px-4 text-gray-800"
                  style={{ paddingLeft: `${16 + row.indent * 16}px` }}
                >
                  {row.name}
                </td>
                <td className={`py-1.5 px-4 text-right tabular-nums ${
                  row.value !== null && row.value < 0 ? "text-red-600" : "text-gray-900"
                }`}>
                  {fmtCAD(row.value)}
                </td>
              </tr>
            );
          })}
        </tbody>
        {section.total !== null && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-100">
              <td className="px-4 py-2 font-bold text-gray-900">Total {section.name}</td>
              <td className={`px-4 py-2 text-right tabular-nums font-bold ${
                section.total < 0 ? "text-red-600" : "text-gray-900"
              }`}>
                {fmtCAD(section.total)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function BalanceSheetTable({ data, asOf, pulledAt }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Title */}
      <div className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-base font-semibold text-gray-900">
          Campus Stores Canada — Balance Sheet
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">As of {asOf}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-x divide-gray-100">
        {/* Left column: Assets */}
        <div className="py-4">
          <div className="px-4 mb-2 text-xs font-bold uppercase tracking-widest text-[#163D6D]">
            Assets
          </div>
          {data.assets.map((s, i) => (
            <SectionBlock key={i} section={s} accentColor="text-[#163D6D] bg-[#163D6D]/5" />
          ))}
          {/* Grand total */}
          <div className="mx-4 mt-2 rounded-lg bg-[#163D6D] px-4 py-3 flex justify-between items-center">
            <span className="text-sm font-bold text-white">TOTAL ASSETS</span>
            <span className="text-sm font-bold text-white tabular-nums">{fmtCAD(data.totalAssets)}</span>
          </div>
        </div>

        {/* Right column: Liabilities + Equity */}
        <div className="py-4">
          <div className="px-4 mb-2 text-xs font-bold uppercase tracking-widest text-gray-600">
            Liabilities &amp; Equity
          </div>
          {data.liabilities.map((s, i) => (
            <SectionBlock key={i} section={s} accentColor="text-gray-600 bg-gray-100" />
          ))}
          {data.equity.map((s, i) => (
            <SectionBlock key={i} section={s} accentColor="text-emerald-700 bg-emerald-50" />
          ))}
          {/* Grand totals */}
          <div className="mx-4 mt-2 space-y-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Total Liabilities</span>
              <span className="text-sm font-semibold tabular-nums text-gray-900">{fmtCAD(data.totalLiabilities)}</span>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex justify-between items-center">
              <span className="text-sm font-semibold text-emerald-800">Total Equity</span>
              <span className="text-sm font-semibold tabular-nums text-emerald-800">{fmtCAD(data.totalEquity)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 px-6 py-3 text-xs text-gray-400">
        Pulled from QuickBooks Online · {new Date(pulledAt).toLocaleString("en-CA")}
      </div>
    </div>
  );
}
