"use client";

import { useState } from "react";
import Link from "next/link";
import AssignPanel from "@/components/benchmarking/committee/AssignPanel";
import { CAPABILITIES, CAPABILITY_LABELS } from "@/lib/auth/capability-names";

/**
 * Staffing the benchmarking committee, from the benchmarking dashboard.
 *
 * The office appoints the lead; the lead then hands out the three workstreams
 * from their own console. Both need to be possible from where the work is, so
 * this card carries all four capabilities rather than sending the office to a
 * governance screen in a different part of the admin console.
 *
 * It reuses the console's AssignPanel and the same server action. A second
 * appointment form would be a second place for the rules about terms, reasons
 * and delegation ceilings to drift.
 *
 * Appointing only. Ending someone's term is a governance edit with an audit
 * trail of its own, and it stays on the grants board.
 */

const SLOTS = [
  {
    capability: CAPABILITIES.BENCHMARKING_COMMITTEE_LEAD,
    blurb:
      "Appoints the rest of the committee and keeps the three workstreams moving.",
  },
  {
    capability: CAPABILITIES.BENCHMARKING_CONTENT_REVIEW,
    blurb: "Reviews question wording and writes the worked examples.",
  },
  {
    capability: CAPABILITIES.BENCHMARKING_QA_VERIFY,
    blurb: "Decides whether flagged numbers are real, a typo, or unusable.",
  },
  {
    capability: CAPABILITIES.BENCHMARKING_RECIPIENT_CONFIRM,
    blurb: "Confirms who actually runs each store in their region.",
  },
] as const;

export interface CommitteeHolder {
  subjectId: string;
  name: string;
  capability: string;
  exOfficio: boolean;
}

export default function CommitteeCard({
  holders,
}: {
  holders: CommitteeHolder[];
}) {
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="flex items-start justify-between p-6 pb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Benchmarking Committee
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Appoint the lead and the three workstreams. The lead can hand out
            the workstreams themselves from their own console.
          </p>
        </div>
        <Link
          href="/benchmarking/committee"
          className="shrink-0 text-xs font-medium text-gray-600 hover:text-gray-900 underline"
        >
          Committee console
        </Link>
      </div>

      {error && (
        <p className="px-6 pb-2 text-xs text-red-600">{error}</p>
      )}

      <div className="divide-y divide-gray-100 border-t border-gray-100">
        {SLOTS.map((slot) => {
          const people = holders.filter(
            (h) => h.capability === slot.capability,
          );
          const open = assigning === slot.capability;
          const label =
            CAPABILITY_LABELS[
              slot.capability as keyof typeof CAPABILITY_LABELS
            ] ?? slot.capability;

          return (
            <div key={slot.capability}>
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{slot.blurb}</p>
                  </div>
                  <button
                    onClick={() => {
                      setError(null);
                      setAssigning(open ? null : slot.capability);
                    }}
                    className="shrink-0 text-xs font-medium px-3 py-1.5 rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                  >
                    {open ? "Cancel" : "Assign someone"}
                  </button>
                </div>

                {people.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {people.map((p) => (
                      <li
                        key={`${p.subjectId}-${p.capability}`}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="text-gray-800">{p.name}</span>
                        {/* Held by office, so there is no term to end here. */}
                        {p.exOfficio && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                            ex officio
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-gray-400">Nobody yet.</p>
                )}
              </div>

              {open && (
                <AssignPanel
                  capability={slot.capability}
                  title={label}
                  // Admin-only surface, so there is no delegation ceiling to
                  // respect — the office is not handing out its own access.
                  ceiling={null}
                  onError={setError}
                  onDone={() => setAssigning(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="px-6 py-3 border-t border-gray-100">
        <Link
          href="/admin/access"
          className="text-xs text-gray-500 hover:text-gray-900 underline"
        >
          End a term or see every capability grant
        </Link>
      </div>
    </div>
  );
}
