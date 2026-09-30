"use client";

import { useState } from "react";
import {
  addKeyDate,
  updateKeyDate,
  removeKeyDate,
  type KeyDate,
} from "@/lib/actions/benchmarking-profile";
import { KEY_DATE_KINDS, type KeyDateKind } from "@/lib/benchmarking/key-dates";

/** How many count dates an inventory style implies, or null if it implies none. */
function countsExpected(style: string | null): number | null {
  if (!style) return null;
  const s = style.toLowerCase();
  if (s.startsWith("annual")) return 1;
  if (s.startsWith("bi-annual")) return 2;
  // Cycle counts run continuously and have no date to name.
  return null;
}

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
  inventoryCountStyle,
}: {
  benchmarkingId: string;
  initialDates: KeyDate[];
  isReadOnly: boolean;
  /** Semesters are only worth asking for where the year has them. */
  isSemesterBased: boolean;
  /**
   * How the store said it counts stock, two questions up.
   *
   * Answering "bi-annual" and then never being asked WHEN is the gap this
   * closes: the style on its own tells a reader nothing they can plan around,
   * and the store has the dates in front of it at exactly this moment.
   */
  inventoryCountStyle: string | null;
}) {
  const [dates, setDates] = useState<KeyDate[]>(initialDates);
  const [error, setError] = useState<string | null>(null);

  const kinds = KEY_DATE_KINDS.filter(
    (k) => k.value !== "semester" || isSemesterBased,
  );

  const have = (kind: KeyDateKind) => dates.some((d) => d.kind === kind);

  /*
    What their own answers imply we should have, and do not.

    Only ever a prompt — nothing here blocks the section. A store that counts
    stock continuously has no count date to give, and a store that has not set
    next year's semester dates yet should not be stuck on this screen for it.
  */
  const expectedCounts = countsExpected(inventoryCountStyle);
  const countDates = dates.filter((d) => d.kind === "inventory_count").length;
  const prompts: { kind: KeyDateKind; label: string; why: string }[] = [];

  if (isSemesterBased && !have("semester")) {
    prompts.push({
      kind: "semester",
      label: "Semester",
      why: "You told us your year runs in semesters. Add each one for the year ahead, with its first and last day.",
    });
  }
  if (expectedCounts !== null && countDates < expectedCounts) {
    prompts.push({
      kind: "inventory_count",
      label: "Inventory count",
      why:
        expectedCounts === 1
          ? `You count ${(inventoryCountStyle ?? "").toLowerCase()}. When is it?`
          : `You count ${(inventoryCountStyle ?? "").toLowerCase()}, so we are expecting ${expectedCounts} dates and have ${countDates}.`,
    });
  }

  /*
    Semester rows held by a store that has since said it does not run semesters.
    Shown rather than deleted: the store entered them, and quietly removing a
    person's own answer because a different answer changed is not ours to do.
  */
  const orphanedSemesters = !isSemesterBased && have("semester");

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

      {prompts.length > 0 && !isReadOnly && (
        <div className="mt-3 rounded-lg border-l-4 border-[#163D6D] bg-[#163D6D]/5 p-3">
          <p className="text-xs font-semibold text-[#163D6D]">
            Your answers above suggest we are missing something
          </p>
          <ul className="mt-2 space-y-2">
            {prompts.map((p) => (
              <li key={p.kind} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-700">{p.why}</span>
                <button
                  onClick={() => void add(p.kind, p.label)}
                  className="rounded-full border border-[#163D6D] px-2.5 py-0.5 text-xs font-medium text-[#163D6D]"
                >
                  + Add {p.label.toLowerCase()}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {orphanedSemesters && (
        <p className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-900">
          You have semester dates below, but you told us your year does not run in
          semesters. We have left them alone rather than deleting your own entries —
          remove any that no longer apply, or change that answer above.
        </p>
      )}

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
