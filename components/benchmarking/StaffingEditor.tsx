"use client";

import { useEffect, useState } from "react";
import BusyButton from "./BusyButton";
import {
  seedStaffFromContacts,
  addStaff,
  updateStaff,
  removeStaff,
  type StaffRow,
} from "@/lib/actions/benchmarking-financials";
import { EMPLOYMENT_TYPES } from "@/lib/benchmarking/systems";

/**
 * §6 Staffing — the bench, not just the headcount.
 *
 * ICBA asks how long the manager has been in post. That is one number about one
 * person. A store with four people averaging fifteen years in campus retail is
 * a different operation from one with four in their first year, and no headcount
 * can tell them apart.
 *
 * Starts from the people we already hold for this store. ⛔ De-duplicated for
 * display; the underlying contact rows are never merged.
 */
export default function StaffingEditor({
  benchmarkingId,
  initialStaff,
  isReadOnly,
}: {
  benchmarkingId: string;
  initialStaff: StaffRow[];
  isReadOnly: boolean;
}) {
  const [staff, setStaff] = useState<StaffRow[]>(initialStaff);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isReadOnly || initialStaff.length > 0) return;
    let cancelled = false;
    void seedStaffFromContacts(benchmarkingId).then((r) => {
      // ⛔ Never a page reload. Saves in this form are debounced by 800ms, so
      // reloading to reveal seeded rows can discard the figure somebody just
      // typed in another section.
      if (!cancelled && r.rows.length > 0) setStaff(r.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [benchmarkingId, isReadOnly, initialStaff.length]);

  const patch = (id: string, fn: (s: StaffRow) => StaffRow) =>
    setStaff((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));

  const counted = staff.filter((s) => s.employmentType);
  const experienced = staff.filter((s) => typeof s.yearsInCampusRetail === "number");
  const avgYears =
    experienced.length > 0
      ? experienced.reduce((a, s) => a + (s.yearsInCampusRetail ?? 0), 0) / experienced.length
      : null;

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-gray-900">Your team</h3>
      <p className="mt-1 text-xs text-gray-600">
        Started from the people we already have on file for your store. Add anyone missing,
        remove anyone who has left, and say how long each has worked in campus retail
        anywhere, not just with you.
      </p>

      <div className="mt-3 space-y-2">
        {staff.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-[12rem] flex-1 text-sm text-gray-800">{s.name}</span>

            <select
              value={s.employmentType ?? ""}
              disabled={isReadOnly}
              onChange={(e) => {
                const v = e.target.value || null;
                patch(s.id, (x) => ({ ...x, employmentType: v }));
                void updateStaff({ benchmarkingId, staffId: s.id, employmentType: v });
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">Employment type…</option>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <select
              value={s.yearsInCampusRetail ?? ""}
              disabled={isReadOnly}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                patch(s.id, (x) => ({ ...x, yearsInCampusRetail: v }));
                void updateStaff({ benchmarkingId, staffId: s.id, yearsInCampusRetail: v });
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
              aria-label={`Years in campus retail for ${s.name}`}
            >
              <option value="">Years in campus retail…</option>
              <option value="0">Less than a year</option>
              {Array.from({ length: 45 }, (_, i) => i + 1).map((y) => (
                <option key={y} value={y}>
                  {y} {y === 1 ? "year" : "years"}
                </option>
              ))}
            </select>

            {!isReadOnly && (
              <button
                onClick={async () => {
                  const res = await removeStaff({ benchmarkingId, staffId: s.id });
                  if (res.success) setStaff((p) => p.filter((x) => x.id !== s.id));
                }}
                className="text-xs text-gray-400 hover:text-red-700"
                aria-label={`Remove ${s.name}`}
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
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add someone we don't have"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <BusyButton
            busyLabel="Adding…"
            onClick={async () => {
              const res = await addStaff({ benchmarkingId, name: newName });
              if (!res.success || !res.id) {
                setError(res.error ?? "Could not add them.");
                return;
              }
              setStaff((p) => [
                ...p,
                {
                  id: res.id!,
                  contactId: null,
                  name: newName.trim(),
                  employmentType: null,
                  yearsInCampusRetail: null,
                },
              ]);
              setNewName("");
            }}
            disabled={!newName.trim()}
            className="rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white"
          >
            Add
          </BusyButton>
        </div>
      )}

      {staff.length > 0 && (
        <p className="mt-3 text-xs text-gray-600">
          {counted.length} of {staff.length} assigned an employment type
          {avgYears !== null && (
            <> · average {avgYears.toFixed(1)} years in campus retail</>
          )}
        </p>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
