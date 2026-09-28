"use client";

/**
 * Entering a nominee's board service history.
 *
 * Opens by itself when there is nothing recorded, because that is the state the
 * nomination screen is complaining about and the whole point is to close the
 * gap between seeing the flag and fixing it.
 *
 * ⚠️ Every date here is EXCLUSIVE at the end, matching the 19 rows already in
 * the table. The hint says so on the field rather than in a tooltip: an
 * off-by-one changes whether somebody has hit the four-term limit.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDirectorTerm,
  recordNoPriorService,
  removeDirectorTerm,
} from "@/lib/actions/director-terms";

export interface TermRow {
  id: string;
  termStart: string;
  termEnd: string | null;
  countsTowardCap: boolean;
  organizationName: string | null;
  notes: string | null;
  isNoServiceMarker: boolean;
}

export default function DirectorTermsEditor({
  bodyId,
  personContactId,
  personProfileId,
  organizationId,
  personName,
  terms,
  revalidate,
}: {
  bodyId: string;
  personContactId: string;
  personProfileId: string | null;
  organizationId: string | null;
  personName: string;
  terms: TermRow[];
  revalidate: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(terms.length === 0);
  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");
  const [counts, setCounts] = useState(true);
  const [notes, setNotes] = useState("");

  const counting = terms.filter((t) => t.countsTowardCap).length;
  const recorded = terms.length > 0;

  const run = (fn: () => Promise<{ success: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.success) setError(r.error ?? "That did not save.");
      else {
        setTermStart("");
        setTermEnd("");
        setNotes("");
        router.refresh();
      }
    });

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-xs font-medium text-gray-900"
      >
        <span>
          Board service history
          {recorded ? (
            <span className="ml-2 font-normal text-gray-600">
              {counting} counting term{counting === 1 ? "" : "s"} recorded
            </span>
          ) : (
            <span className="ml-2 font-normal text-amber-700">nothing recorded</span>
          )}
        </span>
        <span className="text-gray-400">{open ? "Hide" : "Edit"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {recorded ? (
            <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
              {terms.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    {t.isNoServiceMarker ? (
                      <p className="text-gray-700">
                        No prior service, recorded {t.termStart}.
                      </p>
                    ) : (
                      <p className="text-gray-900">
                        {t.termStart} to {t.termEnd ?? "open"}
                        {t.organizationName ? ` · ${t.organizationName}` : ""}
                        {t.countsTowardCap ? "" : " · does not count toward the cap"}
                      </p>
                    )}
                    {t.notes && <p className="mt-0.5 text-gray-500">{t.notes}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removeDirectorTerm({ assignmentId: t.id, revalidate }))}
                    className="shrink-0 text-gray-500 underline hover:text-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-600">
              Nothing is recorded for {personName}, so the term limit cannot be checked. Add the
              terms they have served, or record that they have not served before. Both are
              statements you are making, not guesses the system will fill in.
            </p>
          )}

          <div className="rounded border border-gray-200 bg-white p-3">
            <p className="text-xs font-medium text-gray-900">Add a term</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-gray-600">
                Started
                <input
                  type="date"
                  value={termStart}
                  onChange={(e) => setTermStart(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-600">
                Ended (exclusive)
                <input
                  type="date"
                  value={termEnd}
                  onChange={(e) => setTermEnd(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-1.5 pb-1 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={counts}
                  onChange={(e) => setCounts(e.target.checked)}
                />
                Counts toward the limit
              </label>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              The end date is exclusive: a term running through 2027 ends 2028-01-01. Untick
              &ldquo;counts toward the limit&rdquo; for a mid-term appointment filling a vacancy.
            </p>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Where this came from (minute, resolution, roster)"
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending || !termStart || !termEnd}
                onClick={() =>
                  run(() =>
                    addDirectorTerm({
                      bodyId,
                      personContactId,
                      personProfileId,
                      organizationId,
                      termStart,
                      termEnd,
                      countsTowardCap: counts,
                      notes,
                      revalidate,
                    })
                  )
                }
                className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                Add term
              </button>
              {!recorded && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      recordNoPriorService({
                        bodyId,
                        personContactId,
                        personProfileId,
                        asOf: new Date().toISOString().slice(0, 10),
                        notes,
                        revalidate,
                      })
                    )
                  }
                  className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  They have not served before
                </button>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
