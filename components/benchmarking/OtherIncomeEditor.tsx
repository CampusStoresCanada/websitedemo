"use client";

import { useEffect, useState } from "react";
import {
  seedServiceIncome,
  addOtherIncome,
  updateOtherIncome,
  removeOtherIncome,
  type OtherIncomeRow,
} from "@/lib/actions/benchmarking-financials";
import Explain from "./Explain";

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

  const otherTotal = rows.reduce(
    (s, r) => s + (r.countsAsIncome ? (r.amount ?? 0) : 0),
    0,
  );
  const excluded = rows.filter((r) => !r.countsAsIncome && (r.amount ?? 0) > 0);
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
            <dt className="text-gray-700">
              <Explain text="Retail plus Online across every category you added in Section 2, General Merchandise.">
                General merchandise
              </Explain>
            </dt>
            <dd className="font-medium text-gray-900">{money(merchandiseTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-700">
              <Explain text="Retail plus Online across every format you added in Section 3, Course Materials.">
                Course materials
              </Explain>
            </dt>
            <dd className="font-medium text-gray-900">{money(courseMaterialsTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-700">
              <Explain text="The lines below, counting only the ones you have ticked as income. Untick a line and it drops out of this total and out of every comparison.">
                Other income below
              </Explain>
            </dt>
            <dd className="font-medium text-gray-900">{money(otherTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-700">
              <Explain text="The operating subsidy or covered deficit you enter at the bottom of this section.">
                Funding from the institution
              </Explain>
            </dt>
            <dd className="font-medium text-gray-900">{money(centralFunding)}</dd>
          </div>
          <div className="flex justify-between border-t border-gray-300 pt-1">
            <dt className="font-medium text-gray-900">
              <Explain text="The four lines above, added together. This is the revenue every ratio in your report is a share of.">
                Total revenue
              </Explain>
            </dt>
            <dd className="font-semibold text-gray-900">
              {money(merchandiseTotal + courseMaterialsTotal + otherTotal + centralFunding)}
            </dd>
          </div>
          {excluded.length > 0 && (
            <div className="flex justify-between pt-1 text-xs text-gray-500">
              <dt>
                Not counted, at your request: {excluded.map((r) => r.label).join(", ")}
              </dt>
              <dd className="tabular-nums">
                {money(excluded.reduce((s, r) => s + (r.amount ?? 0), 0))}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-4 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3">
        <p className="text-sm font-semibold text-amber-900">
          Do not include money the institution collects that does not appear in your
          financials.
        </p>
        <p className="mt-1 text-xs text-amber-900">
          If the money never reached your financial statements, it is not your income,
          however large the programme is and however much work your store does to run
          it. Section 10 asks for that amount separately and lets you decide whether it
          should count toward your comparison. Putting it here instead inflates your
          revenue against every store that left it out, and makes your margin and
          expense ratios look worse than they are.
        </p>
      </div>

      <p className="mt-3 text-xs text-gray-600">
        Retail and online income booked through your store that is not merchandise.
        Services you told us you offer are listed already.
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
            <label className="flex w-52 shrink-0 items-center gap-1.5 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={r.countsAsIncome}
                disabled={isReadOnly}
                onChange={(e) => {
                  const on = e.target.checked;
                  patch(r.id, (x) => ({ ...x, countsAsIncome: on }));
                  void updateOtherIncome({
                    benchmarkingId,
                    rowId: r.id,
                    countsAsIncome: on,
                  });
                }}
              />
              <Explain
                align="right"
                text="Ticked, this line is part of your revenue and every ratio built on it. Untick it for a service you run at cost as a campus obligation: a print desk or locker programme that clears its own expenses and nothing more. We will still report what it earned; it just will not count as revenue when your store is compared."
              >
                Included as income
              </Explain>
            </label>
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
                {
                  id: res.id!,
                  kind: "other",
                  serviceName: null,
                  label: newLabel.trim(),
                  amount: null,
                  countsAsIncome: true,
                },
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
