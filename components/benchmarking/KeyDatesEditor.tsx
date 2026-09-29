"use client";

import { useState } from "react";
import {
  addKeyDate,
  updateKeyDate,
  removeKeyDate,
  type KeyDate,
} from "@/lib/actions/benchmarking-profile";
import { KEY_DATE_KINDS, type KeyDateKind } from "@/lib/benchmarking/key-dates";

/**
 * The dates the year turns on, for the year AHEAD.
 *
 * The only forward-looking question in the survey. Everything else asks what
 * happened; this asks what is coming, which is the part a store can act on and
 * the part CSC can plan around.
 *
 * Saved against the ORGANISATION, so it is confirmed rather than retyped next
 * year, and other parts of the site can read it.
 */
export default function KeyDatesEditor({
  benchmarkingId,
  initialDates,
  isReadOnly,
  isSemesterBased,
}: {
  benchmarkingId: string;
  initialDates: KeyDate[];
  isReadOnly: boolean;
  /** Semesters are only worth asking for where the year has them. */
  isSemesterBased: boolean;
}) {
  const [dates, setDates] = useState<KeyDate[]>(initialDates);
  const [error, setError] = useState<string | null>(null);

  const kinds = KEY_DATE_KINDS.filter(
    (k) => k.value !== "semester" || isSemesterBased,
  );

  const patch = (id: string, fn: (d: KeyDate) => KeyDate) =>
    setDates((prev) => prev.map((d) => (d.id === id ? fn(d) : d)));

  async function add(kind: KeyDateKind, label: string) {
    const res = await addKeyDate({ benchmarkingId, kind, label });
    if (!res.success || !res.id) {
      setError(res.error ?? "Could not add that date.");
      return;
    }
    setDates((prev) => [
      ...prev,
      { id: res.id!, kind, label, occursOn: null, endsOn: null },
    ]);
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-gray-900">Your year ahead</h3>
      <p className="mt-1 text-xs text-gray-600">
        The dates your year turns on. These stay on your institution&apos;s profile, so
        next year you are confirming them rather than typing them again, and CSC can plan
        around them instead of guessing.
      </p>

      <div className="mt-4 space-y-3">
        {dates.map((d) => {
          const kind = KEY_DATE_KINDS.find((k) => k.value === d.kind);
          return (
            <div key={d.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem] flex-1">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    {kind?.label ?? d.kind}
                  </label>
                  <input
                    type="text"
                    value={d.label}
                    disabled={isReadOnly}
                    onChange={(e) => patch(d.id, (x) => ({ ...x, label: e.target.value }))}
                    onBlur={(e) =>
                      void updateKeyDate({
                        benchmarkingId,
                        keyDateId: d.id,
                        label: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-600">
                    {kind?.hasEnd ? "Starts" : "Date"}
                  </label>
                  <input
                    type="date"
                    value={d.occursOn ?? ""}
                    disabled={isReadOnly}
                    onChange={(e) => {
                      patch(d.id, (x) => ({ ...x, occursOn: e.target.value || null }));
                      void updateKeyDate({
                        benchmarkingId,
                        keyDateId: d.id,
                        occursOn: e.target.value || null,
                      });
                    }}
                    className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>

                {kind?.hasEnd && (
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600">
                      Ends
                    </label>
                    <input
                      type="date"
                      value={d.endsOn ?? ""}
                      disabled={isReadOnly}
                      onChange={(e) => {
                        patch(d.id, (x) => ({ ...x, endsOn: e.target.value || null }));
                        void updateKeyDate({
                          benchmarkingId,
                          keyDateId: d.id,
                          endsOn: e.target.value || null,
                        });
                      }}
                      className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                )}

                {!isReadOnly && (
                  <button
                    onClick={async () => {
                      const res = await removeKeyDate({ benchmarkingId, keyDateId: d.id });
                      if (res.success) setDates((p) => p.filter((x) => x.id !== d.id));
                    }}
                    className="pb-1.5 text-xs text-gray-500 underline hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!isReadOnly && (
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-700">Add a date</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {kinds.map((k) => (
              <button
                key={k.value}
                title={k.help}
                onClick={() => void add(k.value, k.label)}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:border-[#163D6D] hover:text-[#163D6D]"
              >
                + {k.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            Add as many of each as you need — one adoption deadline per term, every
            buyback window, each semester.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
