"use client";

/**
 * Writing the elected directors onto the board register.
 *
 * Shown after certification, before the announcement, because that is the real
 * order: the result is established, the register is updated, then the
 * membership is told. Until this existed the middle step did not happen at
 * all — a director was certified as elected and still held the role on no
 * date, so the term-limit check, the governance mailing list and every "who is
 * on the board" reader carried on as though the seat were empty.
 *
 * ⛔ The proposal is shown in full before anything is written. The dates are
 * the system's (the nominal convention every existing row uses) but the one
 * judgement it cannot make — whether a term counts against the four-term cap —
 * is a tick box per person, defaulting to the ordinary case of a full term.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordElectedTerms } from "@/lib/actions/director-terms";

export interface ProposedTermView {
  nominationId: string;
  name: string;
  organizationName: string | null;
  termStart: string;
  termEnd: string;
  alreadyRecorded: boolean;
}

export default function ElectedTermsPanel({
  slug,
  cycleYear,
  terms,
  revalidate,
}: {
  slug: string;
  cycleYear: number;
  terms: ProposedTermView[];
  revalidate: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notCounting, setNotCounting] = useState<Set<string>>(new Set());

  // Derived from server props only. The write revalidates and `router.refresh()`
  // brings the new state back; a local "done" flag would be a second source of
  // truth for whether the register was written, and the whole point of this
  // panel is that there is exactly one.
  const outstanding = terms.filter((t) => !t.alreadyRecorded);
  const recorded = terms.filter((t) => t.alreadyRecorded);

  const toggle = (id: string) =>
    setNotCounting((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await recordElectedTerms({
        slug,
        notCountingNominationIds: [...notCounting],
        revalidate,
      });
      if (!r.success) setError(r.error ?? "That did not save.");
      else router.refresh();
    });

  if (terms.length === 0) return null;

  // Everything already on the register. Say so and stop — a button that would
  // write nothing is worse than no button.
  if (outstanding.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">Board register</h2>
        <p className="mt-1 text-sm text-gray-700">
          All {recorded.length} elected director{recorded.length === 1 ? " is" : "s are"} on the
          register for {cycleYear}, written when the result was certified.
        </p>
        <ul className="mt-2 space-y-1 text-xs text-gray-600">
          {recorded.map((t) => (
            <li key={t.nominationId}>
              {t.name} · {t.termStart} to {t.termEnd}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">Terms still to record</h2>
      <p className="mt-1 text-xs text-gray-700">
        Certifying writes these by itself, so this should normally be empty. Seeing names here
        means the result was certified before it did — press it once and they are on the register.
        Nothing that asks &ldquo;who is on the board&rdquo; can see them until they are: the
        term-limit check and the governance mailing list included.
      </p>

      <ul className="mt-3 divide-y divide-amber-200 rounded border border-amber-200 bg-white">
        {outstanding.map((t) => (
          <li key={t.nominationId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{t.name}</p>
              <p className="text-xs text-gray-600">
                {t.organizationName ? `${t.organizationName} · ` : ""}
                {t.termStart} to {t.termEnd}
              </p>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={!notCounting.has(t.nominationId)}
                onChange={() => toggle(t.nominationId)}
                disabled={pending}
              />
              Counts toward the four-term limit
            </label>
          </li>
        ))}
      </ul>

      {recorded.length > 0 && (
        <p className="mt-2 text-xs text-gray-600">
          {recorded.length} already recorded and left alone.
        </p>
      )}

      <p className="mt-2 text-[11px] text-gray-600">
        Dates are nominal January 1, matching every term already on the register — a director
        elected at the {cycleYear} meeting serves to the second annual meeting following (By-Law
        Part IV S2). The real meeting date is not used, because a term starting after the outgoing
        one ends would leave the seat with no holder in between. Untick anyone taking over the
        remainder of somebody else&rsquo;s term rather than a fresh one.
      </p>

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-3 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending
          ? "Recording…"
          : `Record ${outstanding.length} term${outstanding.length === 1 ? "" : "s"}`}
      </button>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}
