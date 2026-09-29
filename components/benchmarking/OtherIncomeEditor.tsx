"use client";

import { useEffect, useState } from "react";
import {
  seedServiceIncome,
  addOtherIncome,
  updateOtherIncome,
  removeOtherIncome,
  type OtherIncomeRow,
} from "@/lib/actions/benchmarking-financials";

/**
 * §4 Other Income — money booked through the store that is not merchandise.
 *
 * ⛔ Retail and online only. Money the INSTITUTION collects is not the store's
 * revenue and is asked in the Inclusive & Equitable Access section, where the
 * store also decides whether it should count toward its comparison at all.
 *
 * Store Services earn without being inventory — printing, lockers, transit
 * passes, gown rental — so they get a line each, seeded from what the store
 * already told us in §1 rather than asked for a second time.
 */
export default function OtherIncomeEditor({
  benchmarkingId,
  initialRows,
  merchandiseTotal,
  courseMaterialsTotal,
  centralFunding,
  isReadOnly,
}: {
  benchmarkingId: string;
  initialRows: OtherIncomeRow[];
  merchandiseTotal: number;
  courseMaterialsTotal: number;
  /**
   * Answered as a field in this same section, and counted here.
   *
   * ⛔ It has to be in this total. The review section counts it as revenue, and
   * a "Total revenue" here that quietly excluded it would disagree with the
   * statement two sections later — which is exactly the kind of difference a
   * store finds after it has stopped trusting either number.
   */
  centralFunding: number;
  isReadOnly: boolean;
}) {
  const [rows, setRows] = useState<OtherIncomeRow[]>(initialRows);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Pull in a line for each service the store said it currently offers.
  useEffect(() => {
    if (isReadOnly) return;
    let cancelled = false;
    void seedServiceIncome(benchmarkingId).then((r) => {
      if (!cancelled && r.added > 0) window.location.reload();
    });
    return () => {
      cancelled = true;
    };
  }, [benchmarkingId, isReadOnly]);

  const otherTotal = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const money = (n: number) =>
    n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

  const patch = (id: string, fn: (r: OtherIncomeRow) => OtherIncomeRow) =>
    setRows((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));

  return (
    <div className="mb-6">
      {/* What they have already told us, so this section has a context. */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          So far
        </p>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-700">General merchandise</dt>
            <dd className="font-medium text-gray-900">{money(merchandiseTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-700">Course materials</dt>
            <dd className="font-medium text-gray-900">{money(courseMaterialsTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-700">Other income below</dt>
            <dd className="font-medium text-gray-900">{money(otherTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-700">Funding from the institution</dt>
            <dd className="font-medium text-gray-900">{money(centralFunding)}</dd>
          </div>
          <div className="flex justify-between border-t border-gray-300 pt-1">
            <dt className="font-medium text-gray-900">Total revenue</dt>
            <dd className="font-semibold text-gray-900">
              {money(merchandiseTotal + courseMaterialsTotal + otherTotal + centralFunding)}
            </dd>
          </div>
        </dl>
      </div>

      <p className="mt-4 text-xs text-gray-600">
        Retail and online income booked through your store that is not merchandise.
        Services you told us you offer are listed already. Do not include money the
        institution collects — that is asked in Inclusive &amp; Equitable Access.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <input
              type="text"
              value={r.label}
              disabled={isReadOnly || r.kind === "store_service"}
              onChange={(e) => patch(r.id, (x) => ({ ...x, label: e.target.value }))}
              onBlur={(e) =>
                void updateOtherIncome({ benchmarkingId, rowId: r.id, label: e.target.value })
              }
              className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-600"
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
                void updateOtherIncome({
                  benchmarkingId,
                  rowId: r.id,
                  amount: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="w-36 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            {!isReadOnly && r.kind !== "store_service" && (
              <button
                onClick={async () => {
                  const res = await removeOtherIncome({ benchmarkingId, rowId: r.id });
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
            placeholder="Name another kind of income"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            onClick={async () => {
              const res = await addOtherIncome({ benchmarkingId, label: newLabel });
              if (!res.success || !res.id) {
                setError(res.error ?? "Could not add that.");
                return;
              }
              setRows((p) => [
                ...p,
                { id: res.id!, kind: "other", serviceName: null, label: newLabel.trim(), amount: null },
              ]);
              setNewLabel("");
            }}
            disabled={!newLabel.trim()}
            className="rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
