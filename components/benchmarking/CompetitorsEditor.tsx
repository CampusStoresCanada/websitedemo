"use client";

import { useState } from "react";
import BusyButton from "./BusyButton";
import {
  addCompetitor,
  updateCompetitor,
  removeCompetitor,
  type CompetitorRow,
} from "@/lib/actions/benchmarking-competitors";
import { COMPETITOR_KINDS } from "@/lib/benchmarking/competitor-kinds";

/**
 * Who else is selling to your students — one store at a time.
 *
 * Was a count plus a free-text "who are they?", which asked a store to
 * compress four answers into one box and gave back a sentence nobody can group
 * by. Every other list in this survey works a row at a time; this one now does
 * too, and the kind beside each name is what makes it answerable: whether a
 * member is up against a national chain, another campus department or a
 * publisher selling direct changes what its margin means.
 */
export default function CompetitorsEditor({
  benchmarkingId,
  initialRows,
  isReadOnly,
}: {
  benchmarkingId: string;
  initialRows: CompetitorRow[];
  isReadOnly: boolean;
}) {
  const [rows, setRows] = useState<CompetitorRow[]>(initialRows);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const patch = (id: string, fn: (r: CompetitorRow) => CompetitorRow) =>
    setRows((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));

  async function add() {
    const name = newName.trim();
    if (!name) return;
    const res = await addCompetitor({ benchmarkingId, name });
    if (!res.success || !res.id) {
      setError(res.error ?? "Could not add that.");
      return;
    }
    setRows((p) => [...p, { id: res.id!, name, kind: null }]);
    setNewName("");
    setError(null);
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-gray-900">Who competes with you</h3>
      <p className="mt-1 text-xs text-gray-600">
        Stores on campus, or close enough that a student would go there instead. Add them
        one at a time. Two stores with the same enrolment are not in the same market if
        one of them has a chain bookstore across the road.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.id} data-flaggable className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={r.name}
              disabled={isReadOnly}
              onChange={(e) => patch(r.id, (x) => ({ ...x, name: e.target.value }))}
              onBlur={(e) =>
                void updateCompetitor({
                  benchmarkingId,
                  competitorId: r.id,
                  name: e.target.value,
                })
              }
              className="min-w-[14rem] flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <select
              value={r.kind ?? ""}
              disabled={isReadOnly}
              onChange={(e) => {
                const kind = e.target.value || null;
                patch(r.id, (x) => ({ ...x, kind }));
                void updateCompetitor({ benchmarkingId, competitorId: r.id, kind });
              }}
              aria-label={`What kind of competitor is ${r.name}`}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">What kind?</option>
              {COMPETITOR_KINDS.map((k) => (
                <option key={k.value} value={k.value} title={k.help}>
                  {k.label}
                </option>
              ))}
            </select>
            {!isReadOnly && (
              <button
                onClick={async () => {
                  const res = await removeCompetitor({
                    benchmarkingId,
                    competitorId: r.id,
                  });
                  if (res.success) setRows((p) => p.filter((x) => x.id !== r.id));
                }}
                className="text-xs text-gray-400 hover:text-red-700"
                aria-label={`Remove ${r.name}`}
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
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              void add();
            }}
            placeholder="Name a store, then press Enter"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <BusyButton
            onClick={add}
            busyLabel="Adding…"
            disabled={!newName.trim()}
            className="rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white"
          >
            Add
          </BusyButton>
        </div>
      )}

      {rows.length === 0 && (
        <p className="mt-2 text-xs text-gray-500">
          None at all is an answer too — leave it empty if nobody else is selling to your
          students.
        </p>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
