"use client";

import { useState, useEffect, useRef } from "react";
import type { QBTransaction } from "@/lib/quickbooks/types";

interface Props {
  accountId:   string;
  accountName: string;
  acctNum:     string;
  startDate:   string;
  endDate:     string;
  children:    React.ReactNode;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style:                 "currency",
    currency:              "CAD",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(s: string): string {
  if (!s) return "";
  const d = new Date(s + "T12:00:00Z");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export default function TransactionPopover({
  accountId,
  accountName,
  acctNum,
  startDate,
  endDate,
  children,
}: Props) {
  const [open, setOpen]   = useState(false);
  const [data, setData]   = useState<QBTransaction[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function handleMouseEnter() {
    timerRef.current = setTimeout(() => {
      setOpen(true);
      if (!data && !loading) {
        fetchTransactions();
      }
    }, 300);
  }

  function handleMouseLeave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }

  async function fetchTransactions() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ accountId, start: startDate, end: endDate });
      const res = await fetch(`/api/admin/board/qbo/transactions?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json.transactions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="relative inline-block w-full"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-50 mt-1 w-[480px] rounded-xl border border-gray-200 bg-white shadow-xl"
          style={{ minWidth: 320 }}
        >
          {/* Header */}
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {acctNum && <span className="mr-1.5 text-gray-400">{acctNum}</span>}
              {accountName}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {startDate} → {endDate} · YTD actual
            </div>
          </div>

          {/* Body */}
          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                Loading transactions…
              </div>
            )}
            {error && (
              <div className="px-4 py-4 text-sm text-red-600">{error}</div>
            )}
            {!loading && !error && data?.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                No transactions found in this period.
              </div>
            )}
            {!loading && !error && data && data.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Payee / Memo</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.map((txn, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                        {fmtDate(txn.date)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900 truncate max-w-[220px]">
                          {txn.payee || txn.type}
                        </div>
                        {txn.memo && txn.memo !== txn.payee && (
                          <div className="truncate text-xs text-gray-400 max-w-[220px]">{txn.memo}</div>
                        )}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums ${
                        txn.amount < 0 ? "text-red-600" : "text-gray-900"
                      }`}>
                        {fmt(txn.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Total */}
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50">
                    <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-gray-500">
                      Total ({data.length} txn{data.length !== 1 ? "s" : ""})
                    </td>
                    <td className="px-4 py-2 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {fmt(data.reduce((s, t) => s + t.amount, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
