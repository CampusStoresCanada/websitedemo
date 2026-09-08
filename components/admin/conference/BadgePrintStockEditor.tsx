"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  previewBadgePrintStock,
  saveBadgePrintStock,
  type BadgePrintStockOptions,
} from "@/lib/actions/badge-print-stock";
import type { BadgePrintStock } from "@/lib/conference/badges/print-stock";

/**
 * How much blank stock a print run holds back for the desk.
 *
 * ⛔ Every percentage is shown WITH THE NUMBER IT COMES TO, recomputed by the
 * same function the printer calls. "20%" is not something an operator can sanity
 * check; "20% of 240 = 48 cards" is. The two bases behave differently enough
 * that the arithmetic is the whole decision — exhibitors follow the larger of
 * the floor and sales, members hit a floor because a percentage of a small
 * roster is meaningless — and neither is visible from the number you type in.
 *
 * ⛔ Off by default, and it says so. Adding a hundred blank cards to a print
 * bill is not something a conference should discover on an invoice.
 */
export function BadgePrintStockEditor({
  conferenceId,
  options,
}: {
  conferenceId: string;
  options: BadgePrintStockOptions;
}) {
  const [stock, setStock] = useState<BadgePrintStock>(options.stock);
  const [preview, setPreview] = useState(options.preview);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const basis = options.preview.basis;
  const firstRender = useRef(true);

  // Recompute on the server as they type — cheap, and it keeps one copy of the
  // arithmetic. Debounced so a held-down arrow key does not queue a request per
  // repeat.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      previewBadgePrintStock(stock, basis).then((res) => {
        if (res.ok) setPreview(res.preview);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [stock, basis]);

  function set<K extends keyof BadgePrintStock>(key: K, value: BadgePrintStock[K]) {
    setSaved(false);
    setError(null);
    setStock((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveBadgePrintStock(conferenceId, stock);
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Reprint stock</h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-600">
            Unbranded blank cards printed at the end of the run and held by the desk, for
            a badge that gets damaged or somebody who walks up. Separate from the blanks
            for seats nobody has been named to yet — those carry the company&apos;s name
            and map, these carry neither.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={stock.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-medium text-gray-900">Print spares</span>
        </label>
      </div>

      {!stock.enabled ? (
        <p className="mt-3 rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
          Off — this run will contain no spare stock. Everything below is what would be
          printed if you turned it on.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Basis
          title="Exhibitors"
          rows={[
            ["Booth capacity", `${basis.possibleExhibitorSeats}`],
            ["Seats sold", `${basis.soldExhibitorSeats}`],
            [
              "Sized against",
              `${basis.exhibitorBasis} — the larger${
                basis.soldExhibitorSeats > basis.possibleExhibitorSeats ? " (sales)" : " (capacity)"
              }`,
            ],
          ]}
          note="Booth allocation is not a ceiling — staff registrations sell separately — so once sales overtake the floor, sales becomes the number spares are sized against."
        >
          <Percent
            label="Spare percentage"
            value={stock.exhibitorSparePercent}
            onChange={(v) => set("exhibitorSparePercent", v)}
          />
          <Result n={preview.exhibitor} of={`${stock.exhibitorSparePercent}% of ${basis.exhibitorBasis}`} />
        </Basis>

        <Basis
          title="Members"
          rows={[["Named on the roster now", `${basis.memberRoster}`]]}
          note="The roster grows every time somebody is named, so this number moves right up until print day. It is snapshotted onto the job when you generate the file."
        >
          <Percent
            label="Spare percentage"
            value={stock.memberSparePercent}
            onChange={(v) => set("memberSparePercent", v)}
          />
          <label className="mt-2 block text-xs font-medium text-gray-700">
            Never fewer than
            <input
              type="number"
              min={0}
              value={stock.memberSpareMinimum}
              onChange={(e) => set("memberSpareMinimum", Math.max(0, Number(e.target.value) || 0))}
              className="ml-2 w-20 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <Result
            n={preview.member}
            of={
              preview.basis.minimumApplied
                ? `the floor — ${stock.memberSparePercent}% of ${basis.memberRoster} is only ${Math.ceil(
                    (basis.memberRoster * stock.memberSparePercent) / 100
                  )}`
                : `${stock.memberSparePercent}% of ${basis.memberRoster}`
            }
          />
        </Basis>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-3">
        <p className="text-sm text-gray-900">
          <strong>{stock.enabled ? preview.total : 0}</strong> spare cards
          {stock.enabled ? ` (${preview.exhibitor} exhibitor, ${preview.member} member)` : ""} on
          top of the named badges and seat blanks.
        </p>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="ml-auto rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved ? <span className="text-sm text-green-700">Saved</span> : null}
        {error ? <span className="text-sm text-red-700">{error}</span> : null}
      </div>
    </div>
  );
}

function Basis({
  title,
  rows,
  note,
  children,
}: {
  title: string;
  rows: Array<[string, string]>;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-gray-200 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700">{title}</h4>
      <dl className="mt-2 space-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 text-xs">
            <dt className="text-gray-600">{k}</dt>
            <dd className="font-medium text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">{children}</div>
      <p className="mt-2 text-[11px] leading-snug text-gray-500">{note}</p>
    </div>
  );
}

function Percent({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs font-medium text-gray-700">
      {label}
      <span className="ml-2 inline-flex items-center">
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
          className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <span className="ml-1 text-gray-600">%</span>
      </span>
    </label>
  );
}

/** The arithmetic, spelled out. This is the part that makes the setting checkable. */
function Result({ n, of }: { n: number; of: string }) {
  return (
    <p className="mt-2 text-sm text-gray-900">
      <strong>{n}</strong> cards <span className="text-xs text-gray-600">— {of}</span>
    </p>
  );
}

export default BadgePrintStockEditor;
