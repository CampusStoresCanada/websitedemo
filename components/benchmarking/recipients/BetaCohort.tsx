"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setRecipientBeta } from "@/lib/actions/benchmarking-recipients";

/**
 * Picking the stores that go first.
 *
 * The send path has always been able to address the beta cohort on its own
 * (`betaOnly`), but nothing could put a store in it. This is that control.
 *
 * Deliberately a search-and-pick rather than a checkbox beside all 52 rows:
 * the cohort is meant to be small, and a list of 52 checkboxes invites you to
 * treat it as a mailing list. What matters on screen is who is already in it.
 */

interface Store {
  id: string;
  orgName: string;
  province: string;
  isBeta: boolean;
  invited: boolean;
  participatedLastYear: boolean;
  /** Somebody at this store holds benchmarking.beta_tester. */
  hasBetaTester: boolean;
}

export default function BetaCohort({ stores }: { stores: Store[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inCohort = useMemo(
    () =>
      stores
        .filter((s) => s.isBeta)
        .sort((a, b) => a.orgName.localeCompare(b.orgName)),
    [stores],
  );

  // Never offer a store that is already in the cohort — removing one is what
  // the list above is for, and showing it twice makes the state ambiguous.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return stores
      .filter((s) => !s.isBeta && s.orgName.toLowerCase().includes(q))
      .sort((a, b) => a.orgName.localeCompare(b.orgName))
      .slice(0, 8);
  }, [stores, query]);

  async function set(recipientId: string, isBeta: boolean) {
    setSaving(recipientId);
    setError(null);
    const res = await setRecipientBeta({ recipientId, isBeta });
    if (res.success) {
      router.refresh();
      setQuery("");
    } else {
      setError(res.error ?? "Could not update the beta cohort");
    }
    setSaving(null);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-500">
        Beta stores
      </h3>
      <p className="mb-4 text-xs text-gray-500">
        These stores receive the survey first, with the going-first copy. Keep
        it small: the point is to find a question that reads two ways before
        the whole membership sees it.
      </p>

      {inCohort.some((s) => !s.hasBetaTester) && (
        <div className="mb-4 rounded-lg border-l-4 border-red-500 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-900">
            Some of these stores cannot open the survey yet
          </p>
          <p className="mt-1 text-xs text-red-900">
            Being in the cohort decides who gets the going-first email. Opening the
            survey before it is public is a separate appointment, made on the{" "}
            <a href="/benchmarking/admin" className="underline">
              benchmarking admin page
            </a>{" "}
            under Beta tester. Send without it and they get a link to a locked door.
            The send panel below will refuse those stores until somebody is appointed.
          </p>
        </div>
      )}

      {inCohort.length > 0 ? (
        <ul className="mb-5 space-y-2">
          {inCohort.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-lg bg-gray-50 p-3"
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {s.orgName}
                </span>
                <span className="text-xs text-gray-400">{s.province}</span>
                {/* An invited store cannot be un-invited by unticking it, and
                    saying so here is cheaper than explaining it afterwards. */}
                {/*
                  ⛔ The half the operator cannot see from here otherwise.
                  Flagging a store and appointing a person are two acts on two
                  pages; without this, sending the invitation mails a link to a
                  door that will not open.
                */}
                {!s.hasBetaTester && (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                    Nobody appointed
                  </span>
                )}
                {s.invited && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                    Already invited
                  </span>
                )}
              </span>
              <button
                onClick={() => set(s.id, false)}
                disabled={saving === s.id}
                className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {saving === s.id ? "..." : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mb-5 rounded-lg bg-gray-50 p-4 text-center">
          <p className="text-sm text-gray-500">
            No stores in the beta cohort. A beta send right now would reach
            nobody.
          </p>
        </div>
      )}

      <label
        htmlFor="beta-store-search"
        className="mb-2 block text-xs font-medium text-gray-700"
      >
        Add a store
      </label>
      <input
        id="beta-store-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by store name..."
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {matches.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-gray-100 p-2">
          {matches.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-gray-50"
            >
              <span className="flex items-center gap-2">
                <span className="text-sm text-gray-900">{s.orgName}</span>
                <span className="text-xs text-gray-400">{s.province}</span>
                {/* A store that skipped last year is usually the one you most
                    want early feedback from, so it is worth flagging here. */}
                {!s.participatedLastYear && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                    Did not take part last year
                  </span>
                )}
              </span>
              <button
                onClick={() => set(s.id, true)}
                disabled={saving === s.id}
                className="rounded border border-gray-200 px-2 py-1 text-xs font-medium text-[#EE2A2E] transition-colors hover:bg-gray-50 hover:text-[#D92327] disabled:opacity-50"
              >
                {saving === s.id ? "..." : "Add"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length >= 2 && matches.length === 0 && (
        <p className="mt-2 text-xs text-gray-500">
          No stores match that, or they are already in the cohort.
        </p>
      )}
    </div>
  );
}
