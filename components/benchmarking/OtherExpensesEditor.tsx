"use client";

import { useState } from "react";
import BusyButton from "./BusyButton";
import {
  addOtherExpense,
  updateOtherExpense,
  removeOtherExpense,
  type OtherExpenseRow,
} from "@/lib/actions/benchmarking-financials";

/**
 * §7 Expenses — the lines we did not name.
 *
 * The named expense lines live in the field config, because they are the same
 * for every store and the comparison depends on them being the same. This is
 * the escape hatch: anything a store genuinely spends money on that our list
 * does not cover, in its own words.
 *
 * ⛔ An expense added here is the store's own label, not a category. It is
 * counted in the total and shown back in Review under the words they typed —
 * never silently folded into one of ours.
 */
export default function OtherExpensesEditor({
  benchmarkingId,
  initialRows,
  namedExpenseTotal,
  isReadOnly,
}: {
  benchmarkingId: string;
  initialRows: OtherExpenseRow[];
  namedExpenseTotal: number;
  isReadOnly: boolean;
}) {
  const [rows, setRows] = useState<OtherExpenseRow[]>(initialRows);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const otherTotal = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const money = (n: number) =>
    n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

  const patch = (id: string, fn: (r: OtherExpenseRow) => OtherExpenseRow) =>
    setRows((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-gray-900">Anything we did not name</h3>
      <p className="mt-1 text-xs text-gray-600">
        Only what does not belong on one of the lines above. Give it the name you use
        internally — we will show it back to you that way rather than filing it under one
        of our headings.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.id} data-flaggable className="flex items-center gap-2">
            <input
              type="text"
              value={r.label}
              disabled={isReadOnly}
              onChange={(e) => patch(r.id, (x) => ({ ...x, label: e.target.value }))}
              onBlur={(e) =>
                void updateOtherExpense({ benchmarkingId, rowId: r.id, label: e.target.value })
              }
              className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              value={r.amount ?? ""}
              disabled={isReadOnly}
              placeholder="$"
              onFocus={(e) => {
                const el = e.currentTarget;
                requestAnimationFrame(() => el.select());
              }}
              onChange={(e) =>
                patch(r.id, (x) => ({
                  ...x,
                  amount: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              onBlur={(e) =>
                void updateOtherExpense({
                  benchmarkingId,
                  rowId: r.id,
                  amount: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="w-36 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            {!isReadOnly && (
              <button
                onClick={async () => {
                  const res = await removeOtherExpense({ benchmarkingId, rowId: r.id });
                  if (res.success) setRows((p) => p.filter((x) => x.id !== r.id));
                }}
                className="text-xs text-gray-400 hover:text-red-700"
                aria-label="Remove"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {!isReadOnly && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Name another expense"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <BusyButton
            busyLabel="Adding…"
            onClick={async () => {
              const res = await addOtherExpense({ benchmarkingId, label: newLabel });
              if (!res.success || !res.id) {
                setError(res.error ?? "Could not add that.");
                return;
              }
              setRows((p) => [...p, { id: res.id!, label: newLabel.trim(), amount: null }]);
              setNewLabel("");
            }}
            disabled={!newLabel.trim()}
            className="rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white"
          >
            Add
          </BusyButton>
        </div>
      )}

      <div className="mt-4 flex justify-between border-t border-gray-300 pt-2 text-sm">
        <span className="font-medium text-gray-900">Total operating expenses</span>
        <span className="font-semibold text-gray-900">{money(namedExpenseTotal + otherTotal)}</span>
      </div>
      {/*
        Shrinkage is on this page and deliberately not in this total, so typing
        it moves nothing. Without a line saying why, that reads as a figure that
        failed to save.
      */}
      <p className="mt-1 text-xs text-gray-500">
        Shrinkage is not in this total. It is already inside your cost of sales, so adding
        it here would count the same loss twice and make your expenses look worse than
        they are.
      </p>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
