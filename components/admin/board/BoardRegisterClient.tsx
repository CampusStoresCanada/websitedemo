"use client";

/**
 * Changing the board between elections.
 *
 * A resignation in March used to have nowhere to go: the only screen that
 * touched the register was an election's nomination list, so the board could
 * only change once a year on the one path the software knew about. This is the
 * other path — the ordinary one, which the by-law has always had and the
 * software never did.
 *
 * ⚠️ `term_end` is EXCLUSIVE everywhere here, so the departure date is the
 * first day the person no longer holds the seat. Said on the field, not in a
 * tooltip: an off-by-one puts somebody on the board for a day they were not.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resignDirector, appointToVacancy } from "@/lib/actions/director-terms";
import { searchContactsForSlot } from "@/lib/actions/site-content";

export interface RegisterTermView {
  assignmentId: string;
  name: string;
  organizationName: string | null;
  termStart: string;
  termEnd: string | null;
  countsTowardCap: boolean;
  appointingResolution: string | null;
  notes: string | null;
}

interface ContactHit {
  id: string;
  name: string | null;
  organization_id: string | null;
}

export default function BoardRegisterClient({
  bodyId,
  asOf,
  holding,
  incoming,
  seatCount,
  minSeatCount,
  vacancies,
  belowMinimum,
  revalidate,
}: {
  bodyId: string;
  asOf: string;
  holding: RegisterTermView[];
  incoming: RegisterTermView[];
  seatCount: number | null;
  minSeatCount: number | null;
  vacancies: number | null;
  belowMinimum: boolean;
  revalidate: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [effectiveOn, setEffectiveOn] = useState("");
  const [stillCounts, setStillCounts] = useState(true);
  const [departureNote, setDepartureNote] = useState("");

  const [appointOpen, setAppointOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [picked, setPicked] = useState<ContactHit | null>(null);
  const [apptStart, setApptStart] = useState(asOf);
  const [apptEnd, setApptEnd] = useState("");
  const [apptCounts, setApptCounts] = useState(false);
  const [resolution, setResolution] = useState("");

  // The end dates currently in use. A vacancy runs to the end of the term it
  // is filling, so offering the live cohort dates beats typing one out.
  const cohortEnds = [
    ...new Set([...holding, ...incoming].map((t) => t.termEnd).filter((d): d is string => !!d)),
  ].sort();

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, done: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.success) setError(r.error ?? "That did not save.");
      else {
        done();
        router.refresh();
      }
    });

  const search = (q: string) => {
    setQuery(q);
    setPicked(null);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    start(async () => {
      const r = await searchContactsForSlot(q);
      setHits(r.success ? ((r.data ?? []) as ContactHit[]) : []);
    });
  };

  return (
    <div className="space-y-5">
      {belowMinimum && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <strong>Below the minimum.</strong> {holding.length} director
          {holding.length === 1 ? "" : "s"} hold a seat as at {asOf}, and the by-law sets a floor of{" "}
          {minSeatCount}. Either terms have not been recorded yet, or seats need filling.
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Holding a seat as at {asOf}
            <span className="ml-2 font-normal text-gray-600">
              {holding.length}
              {seatCount === null ? "" : ` of ${seatCount}`}
            </span>
          </h2>
          {vacancies !== null && vacancies > 0 && (
            <button
              type="button"
              onClick={() => setAppointOpen((v) => !v)}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {appointOpen ? "Cancel" : `Fill a vacancy (${vacancies})`}
            </button>
          )}
        </div>

        {holding.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500">Nobody holds a seat on this date.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {holding.map((t) => (
              <li key={t.assignmentId} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-600">
                      {t.organizationName ? `${t.organizationName} · ` : ""}
                      {t.termStart} to {t.termEnd ?? "open"}
                      {t.countsTowardCap ? "" : " · does not count toward the cap"}
                    </p>
                    {t.appointingResolution && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        Appointed: {t.appointingResolution}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      setLeavingId((id) => {
                        const next = id === t.assignmentId ? null : t.assignmentId;
                        setEffectiveOn("");
                        setDepartureNote("");
                        setStillCounts(t.countsTowardCap);
                        return next;
                      })
                    }
                    className="shrink-0 text-xs text-gray-500 underline hover:text-red-700 disabled:opacity-50"
                  >
                    {leavingId === t.assignmentId ? "Cancel" : "Record a departure"}
                  </button>
                </div>

                {leavingId === t.assignmentId && (
                  <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-medium text-gray-900">
                      {t.name} leaves the board
                    </p>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1 text-xs text-gray-600">
                        First day no longer on the board
                        <input
                          type="date"
                          value={effectiveOn}
                          onChange={(e) => setEffectiveOn(e.target.value)}
                          className="rounded border border-gray-300 px-2 py-1"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 pb-1 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={stillCounts}
                          onChange={(e) => setStillCounts(e.target.checked)}
                        />
                        The part served still counts toward the limit
                      </label>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      The date is exclusive, so it is the first day they are off the board, not
                      their last day on it. The term is shortened, never deleted — they did serve,
                      and the minutes say so.
                    </p>
                    <input
                      value={departureNote}
                      onChange={(e) => setDepartureNote(e.target.value)}
                      placeholder="The minute, resolution or letter of resignation"
                      className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={pending || !effectiveOn || !departureNote.trim()}
                      onClick={() =>
                        run(
                          () =>
                            resignDirector({
                              assignmentId: t.assignmentId,
                              effectiveOn,
                              countsTowardCap: stillCounts,
                              note: departureNote,
                              revalidate,
                            }),
                          () => setLeavingId(null)
                        )
                      }
                      className="mt-2 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      Record the departure
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {appointOpen && (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Appoint to an unexpired term</h2>
          <p className="mt-1 text-xs text-gray-600">
            The board fills a vacancy and the appointee serves what is left of the term, not a
            fresh one — which is why the end date is the vacated term&rsquo;s end, and why this
            does not count toward the four-term limit unless you say it does.
          </p>

          <input
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Search people by name"
            className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          {picked ? (
            <p className="mt-2 text-xs text-gray-800">
              Appointing <strong>{picked.name}</strong>.{" "}
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="underline text-gray-500"
              >
                change
              </button>
            </p>
          ) : (
            hits.length > 0 && (
              <ul className="mt-2 divide-y divide-gray-100 rounded border border-gray-200">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(h);
                        setHits([]);
                      }}
                      className="w-full px-3 py-1.5 text-left text-xs text-gray-800 hover:bg-gray-50"
                    >
                      {h.name ?? "Unnamed"}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              Takes the seat
              <input
                type="date"
                value={apptStart}
                onChange={(e) => setApptStart(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              Term runs to (exclusive)
              <input
                type="date"
                value={apptEnd}
                onChange={(e) => setApptEnd(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-1.5 pb-1 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={apptCounts}
                onChange={(e) => setApptCounts(e.target.checked)}
              />
              Counts toward the four-term limit
            </label>
          </div>

          {cohortEnds.length > 0 && (
            <p className="mt-1 text-[11px] text-gray-500">
              Terms currently on the register end{" "}
              {cohortEnds.map((d, i) => (
                <span key={d}>
                  {i > 0 ? ", " : ""}
                  <button
                    type="button"
                    onClick={() => setApptEnd(d)}
                    className="underline hover:text-gray-800"
                  >
                    {d}
                  </button>
                </span>
              ))}
              . Pick the end of the term being filled.
            </p>
          )}

          <input
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="The board resolution that made this appointment"
            className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
          />

          <button
            type="button"
            disabled={pending || !picked || !apptStart || !apptEnd || !resolution.trim()}
            onClick={() =>
              run(
                () =>
                  appointToVacancy({
                    bodyId,
                    personContactId: picked!.id,
                    personProfileId: null,
                    organizationId: picked!.organization_id ?? null,
                    termStart: apptStart,
                    termEnd: apptEnd,
                    countsTowardCap: apptCounts,
                    appointingResolution: resolution,
                    revalidate,
                  }),
                () => {
                  setAppointOpen(false);
                  setPicked(null);
                  setQuery("");
                  setApptEnd("");
                  setResolution("");
                }
              )
            }
            className="mt-3 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            Record the appointment
          </button>
        </section>
      )}

      {incoming.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Not yet seated</h2>
          <p className="mt-1 text-xs text-gray-600">
            Recorded, with a term that starts after {asOf}.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-gray-700">
            {incoming.map((t) => (
              <li key={t.assignmentId}>
                {t.name} · {t.termStart} to {t.termEnd ?? "open"}
                {t.organizationName ? ` · ${t.organizationName}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
