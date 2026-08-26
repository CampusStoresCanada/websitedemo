"use client";

import { useState } from "react";
import { traceLeakedReport } from "@/lib/actions/benchmarking-trace";
import type { TraceReport } from "@/lib/benchmarking/trace";

/**
 * Reading a leaked copy back to the member it was prepared for.
 *
 * The screen is built to resist the thing it would be most tempting to do:
 * name someone. Candidates come back ranked with their arithmetic, ties are
 * shown as ties, and the copy says "lead" rather than "culprit" — because the
 * next step is a conversation with a member, and going into it certain of the
 * wrong store is worse than going in with a shortlist.
 */

interface StoreOption {
  id: string;
  name: string;
}

const MEASURES = [
  { key: "revenue", label: "Total revenue" },
  { key: "revenue_per_sqft", label: "Revenue per square foot" },
  { key: "revenue_per_student", label: "Revenue per student" },
];

type Row = { organizationId: string; fieldKey: string; observedValue: string };

const BLANK: Row = { organizationId: "", fieldKey: "revenue", observedValue: "" };

export default function LeakTrace({
  fiscalYear,
  stores,
}: {
  fiscalYear: number;
  stores: StoreOption[];
}) {
  const [rows, setRows] = useState<Row[]>([{ ...BLANK }, { ...BLANK }, { ...BLANK }]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<TraceReport | null>(null);

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }

  async function run() {
    setRunning(true);
    setError(null);
    setReport(null);

    const inputs = rows
      .filter((r) => r.organizationId && r.observedValue.trim() !== "")
      .map((r) => ({
        organizationId: r.organizationId,
        fieldKey: r.fieldKey,
        // Tolerate a figure pasted straight off a report, commas and all.
        observedValue: Number(r.observedValue.replace(/[$,\s]/g, "")),
      }));

    const res = await traceLeakedReport(fiscalYear, inputs);
    setRunning(false);
    if (!res.success || !res.report) {
      setError(res.error ?? "Trace failed.");
      return;
    }
    setReport(res.report);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Trace a leaked report</h1>
      <p className="mt-2 max-w-2xl text-sm text-gray-600">
        Every comparison report carries figures shifted by a few dollars, differently for
        each member it was prepared for. Type what a leaked copy said and this reads the
        shifts back. It changes nothing and records nothing.
      </p>
      <p className="mt-2 max-w-2xl rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        Use figures belonging to <strong>other</strong> stores. A member always sees their
        own numbers exactly as filed, so their own figures carry no mark and prove nothing.
      </p>

      <div className="mt-6 space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={r.organizationId}
              onChange={(e) => update(i, { organizationId: e.target.value })}
            >
              <option value="">Which store&apos;s figure…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={r.fieldKey}
              onChange={(e) => update(i, { fieldKey: e.target.value })}
            >
              {MEASURES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums"
              placeholder="as it appeared"
              value={r.observedValue}
              onChange={(e) => update(i, { observedValue: e.target.value })}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={run}
          disabled={running}
          className="rounded-lg bg-[#163D6D] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? "Reading the marks…" : "Trace"}
        </button>
        <button
          onClick={() => setRows((p) => [...p, { ...BLANK }])}
          className="text-sm text-gray-600 underline"
        >
          Add another figure
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {report && (
        <div className="mt-8">
          <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-800">{report.summary}</p>

          <h2 className="mt-6 text-sm font-medium uppercase text-gray-500">
            What was checked
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {report.observations.map((o, i) => (
              <li key={i} className="text-gray-700">
                <span className="font-medium">{o.organizationName}</span> ·{" "}
                {MEASURES.find((m) => m.key === o.fieldKey)?.label ?? o.fieldKey} · you
                entered{" "}
                <span className="tabular-nums">
                  ${Math.round(o.observedValue).toLocaleString("en-CA")}
                </span>
                {o.trueValue !== null && (
                  <>
                    , we hold{" "}
                    <span className="tabular-nums">
                      ${Math.round(o.trueValue).toLocaleString("en-CA")}
                    </span>
                  </>
                )}
                {o.note && <span className="block text-xs text-gray-500">{o.note}</span>}
              </li>
            ))}
          </ul>

          {report.markableCount > 0 && (
            <>
              <h2 className="mt-6 text-sm font-medium uppercase text-gray-500">
                Candidates
              </h2>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                    <th className="pb-2 font-medium">Member</th>
                    <th className="pb-2 font-medium">Fits</th>
                    <th className="pb-2 font-medium">Opened the report</th>
                    <th className="pb-2 font-medium">Reading</th>
                  </tr>
                </thead>
                <tbody>
                  {report.candidates
                    .filter((c) => c.verdict !== "excluded")
                    .map((c) => (
                      <tr key={c.organizationId} className="border-b border-gray-100">
                        <td className="py-2 pr-3 text-gray-900">{c.organizationName}</td>
                        <td className="py-2 tabular-nums text-gray-700">
                          {c.matched} of {c.markable}
                        </td>
                        <td className="py-2 text-gray-600">
                          {c.viewedReport ? "yes" : c.wasRecipient ? "invited, no view logged" : "—"}
                        </td>
                        <td className="py-2 text-gray-600">
                          {c.verdict === "explains-all"
                            ? "explains every figure"
                            : c.verdict === "partial"
                              ? "explains some"
                              : "no marked figures to judge on"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-gray-500">
                {report.candidates.filter((c) => c.verdict === "excluded").length} member
                {report.candidates.filter((c) => c.verdict === "excluded").length === 1
                  ? " is"
                  : "s are"}{" "}
                ruled out — their copy would have carried different figures. Ruled out is
                the reliable half of this; a fit is a lead.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
