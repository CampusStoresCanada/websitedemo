"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setRecipientBeta } from "@/lib/actions/benchmarking-recipients";
import {
  peopleAtOrgForAppointment,
  appointToCapability,
} from "@/lib/actions/capability-appointments";

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
  /** The ORGANISATION, not the recipient row — appointments are per store. */
  orgId: string;
  orgName: string;
  province: string;
  isBeta: boolean;
  invited: boolean;
  participatedLastYear: boolean;
  /** Somebody at this store holds benchmarking.beta_tester. */
  hasBetaTester: boolean;
}

export default function BetaCohort({
  stores,
  appointmentEndsOn,
  fiscalYear,
}: {
  stores: Store[];
  /**
   * When a beta appointment lapses. ⛔ EXCLUSIVE: capability_contributions
   * tests `term_end > today`, so this must be the day AFTER their last.
   */
  appointmentEndsOn: string;
  fiscalYear: number;
}) {
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
            Being in the cohort decides who gets the going-first email. Somebody
            at the store also has to be named, or the email arrives before anyone
            there can open the survey. Name them on the store below. The send
            panel will refuse any store without one.
          </p>
        </div>
      )}

      {inCohort.length > 0 ? (
        <ul className="mb-5 space-y-2">
          {inCohort.map((s) => (
            <li key={s.id} className="rounded-lg bg-gray-50 p-3">
              <div className="flex items-center justify-between">
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
              </div>
              {/*
                ⛔ Naming the person happens HERE, not on another page.

                The cohort and the appointment were two controls on two pages
                pointing in opposite directions: one invites a store, the other
                appoints a person, and nothing on either said they were halves
                of the same act. The operator had to know that sending without
                the second mails a link to a locked door.

                Same appointToCapability the committee console calls, so there
                is still one appointment mechanism. What is different here is
                the CANDIDATE LIST: only people with an active link to this
                store, because a beta tester unblocks their own store and
                nobody else's.
              */}
              {!s.invited && (
                <NameTheTester
                  store={s}
                  endsOn={appointmentEndsOn}
                  fiscalYear={fiscalYear}
                  onError={setError}
                />
              )}
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

// ─────────────────────────────────────────────────────────────────

/**
 * Naming the person who will go first at one store.
 *
 * Loads candidates only when opened: the cohort is small but the page already
 * does enough work, and nobody needs 52 stores' staff lists fetched to render
 * four rows.
 */
function NameTheTester({
  store,
  endsOn,
  fiscalYear,
  onError,
}: {
  store: Store;
  endsOn: string;
  fiscalYear: number;
  onError: (m: string | null) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<
    { id: string; name: string; alreadyHolds: boolean }[] | null
  >(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function openPicker() {
    setOpen(true);
    if (people) return;
    setLoading(true);
    const rows = await peopleAtOrgForAppointment(store.orgId);
    setPeople(rows);
    setLoading(false);
  }

  async function appoint(subjectId: string, name: string) {
    setBusy(subjectId);
    onError(null);
    const result = await appointToCapability({
      subjectId,
      capability: "benchmarking.beta_tester",
      reason: `Beta tester for the FY${fiscalYear} benchmarking survey`,
      endsAt: endsOn,
    });
    setBusy(null);
    if (!result.success) {
      onError(result.error ?? `Could not appoint ${name}.`);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (store.hasBetaTester && !open) {
    return (
      <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
        <span className="text-xs text-green-700">Someone here is named</span>
        <button
          onClick={openPicker}
          className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-900"
        >
          Name someone else
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-gray-200 pt-2">
      {!open ? (
        <button
          onClick={openPicker}
          className="text-xs font-medium text-[#163D6D] underline underline-offset-2"
        >
          Name who goes first here
        </button>
      ) : (
        <div>
          {loading && <p className="text-xs text-gray-500">Loading people…</p>}
          {people && people.length === 0 && (
            <p className="text-xs text-amber-800">
              Nobody at this store has a login yet, so there is nobody who could
              open the survey. Invite someone from the store&rsquo;s own page
              first.
            </p>
          )}
          {people && people.length > 0 && (
            <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
              {people.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-sm text-gray-900">{p.name}</span>
                  {p.alreadyHolds ? (
                    <span className="text-xs text-green-700">already named</span>
                  ) : (
                    <button
                      onClick={() => appoint(p.id, p.name)}
                      disabled={busy !== null}
                      className="text-xs font-medium text-[#163D6D] underline underline-offset-2 disabled:opacity-50"
                    >
                      {busy === p.id ? "…" : "Name them"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setOpen(false)}
            className="mt-2 text-xs text-gray-500 underline underline-offset-2"
          >
            Never mind
          </button>
        </div>
      )}
    </div>
  );
}
