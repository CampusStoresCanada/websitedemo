"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  grantCapability,
  searchPeopleForGrant,
} from "@/lib/actions/capability-grants";
import { WORKSTREAMS } from "@/lib/benchmarking/committee-workstreams";

interface Holder {
  subjectId: string;
  name: string;
  capability: string;
  reason: string;
  endsAt: string;
}

const MTN = "America/Edmonton";
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", {
    timeZone: MTN,
    month: "short",
    day: "numeric",
  });

export default function CommitteeConsole({
  isLead,
  isAdmin,
  canDelegateAny,
  delegableUntil,
  holders,
  progress,
}: {
  isLead: boolean;
  isAdmin: boolean;
  canDelegateAny: boolean;
  delegableUntil: Record<string, string | null>;
  holders: Holder[];
  progress: { reviewDone: number; reviewTotal: number; openFlags: number };
}) {
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byCapability = (cap: string) =>
    holders.filter((h) => h.capability === cap);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1">
          Benchmarking committee
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {isLead ? "Your committee" : "Committee overview"}
        </h1>
        <p className="text-sm text-gray-600">
          Three pieces of work. You can do any of them yourself, hand them to
          someone else, or both — plenty of people take more than one.
        </p>
      </header>

      {error && (
        <p className="text-sm text-red-600 mb-4 p-3 bg-red-50 rounded">
          {error}
        </p>
      )}

      <div className="space-y-4">
        {WORKSTREAMS.map((w) => {
          const people = byCapability(w.capability);
          const ceiling = delegableUntil[w.capability];
          const canAssign = isAdmin || ceiling != null;

          const progressLabel =
            w.capability === "benchmarking.content_review"
              ? `${progress.reviewDone} of ${progress.reviewTotal} questions answered`
              : w.capability === "benchmarking.qa_verify"
                ? progress.openFlags === 0
                  ? "No flags waiting"
                  : `${progress.openFlags} flag${progress.openFlags === 1 ? "" : "s"} waiting`
                : null;

          return (
            <section
              key={w.capability}
              className="border border-gray-200 rounded-lg bg-white overflow-hidden"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {w.title}
                    </h2>
                    <p className="text-sm text-gray-600 mt-0.5">{w.summary}</p>
                  </div>
                  {people.length > 0 && (
                    <span className="shrink-0 text-[11px] font-medium px-2 py-1 rounded bg-green-50 text-green-700">
                      {people.length} assigned
                    </span>
                  )}
                </div>

                <dl className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">
                      What you do
                    </dt>
                    <dd className="text-gray-700 mt-1">{w.whatYouDo}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">
                      Why it matters
                    </dt>
                    <dd className="text-gray-700 mt-1">{w.whyItMatters}</dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                  <span>⏱ {w.timeCommitment}</span>
                  <span>📅 {w.window}</span>
                </div>

                {/* Am I on track? */}
                {progressLabel && (
                  <div className="mt-4 rounded border border-gray-200 bg-gray-50 px-3 py-2">
                    <p className="text-xs font-medium text-gray-700">
                      {progressLabel}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Done when: {w.doneWhen}
                    </p>
                    {w.capability === "benchmarking.content_review" &&
                      progress.reviewTotal > 0 && (
                        <div className="mt-2 h-1.5 w-full rounded bg-gray-200 overflow-hidden">
                          <div
                            className="h-full bg-gray-800"
                            style={{
                              width: `${Math.round((progress.reviewDone / progress.reviewTotal) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                  </div>
                )}

                {people.length > 0 && (
                  <ul className="mt-4 space-y-1">
                    {people.map((p, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-gray-800">{p.name}</span>
                        <span className="text-xs text-gray-400">
                          until {fmt(p.endsAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    href={w.href}
                    className="text-sm font-medium px-4 py-2 rounded bg-gray-900 text-white hover:bg-gray-800"
                  >
                    I&rsquo;ll do this
                  </Link>
                  {canAssign && (
                    <button
                      onClick={() =>
                        setAssigning(
                          assigning === w.capability ? null : w.capability,
                        )
                      }
                      className="text-sm font-medium px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      {assigning === w.capability ? "Cancel" : "Assign someone"}
                    </button>
                  )}
                  {!canAssign && !isAdmin && (
                    <span className="text-xs text-gray-400">
                      You can do this yourself, but not hand it out
                    </span>
                  )}
                </div>
              </div>

              {assigning === w.capability && (
                <AssignPanel
                  capability={w.capability}
                  title={w.title}
                  ceiling={ceiling ?? null}
                  onError={setError}
                  onDone={() => setAssigning(null)}
                />
              )}
            </section>
          );
        })}
      </div>

      {!canDelegateAny && !isAdmin && (
        <p className="mt-6 text-sm text-gray-500">
          You hold committee work but not the ability to hand it out. If you
          need to bring someone in, ask the office.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function AssignPanel({
  capability,
  title,
  ceiling,
  onError,
  onDone,
}: {
  capability: string;
  title: string;
  ceiling: string | null;
  onError: (m: string | null) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; globalRole: string }[]
  >([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [reason, setReason] = useState(`CSC 2026 benchmarking — ${title}`);
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);

  const ceilingDate = ceiling ? new Date(ceiling) : null;
  const maxDate = ceilingDate
    ? ceilingDate.toISOString().slice(0, 10)
    : undefined;

  useEffect(() => {
    const q = search.trim();
    if (picked || q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await searchPeopleForGrant(q);
      setResults(r.success && r.people ? r.people : []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, picked]);

  const submit = async () => {
    setSaving(true);
    onError(null);
    const iso = endsAt
      ? new Date(`${endsAt}T23:59:59-06:00`).toISOString()
      : "";
    const result = await grantCapability({
      subjectId: picked?.id ?? "",
      capability,
      reason,
      endsAt: iso,
    });
    setSaving(false);
    if (result.success) {
      onDone();
      router.refresh();
    } else {
      onError(result.error ?? "Could not assign");
    }
  };

  return (
    <div className="border-t border-gray-200 bg-gray-50 p-5 space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Who
        </label>
        {picked ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded bg-white">
            <span className="text-sm text-gray-900">{picked.name}</span>
            <button
              onClick={() => setPicked(null)}
              className="text-xs text-gray-500 hover:text-gray-900"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
            {results.length > 0 && (
              <ul className="mt-1 border border-gray-200 rounded bg-white divide-y divide-gray-100 max-h-40 overflow-y-auto">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        setPicked(p);
                        setResults([]);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Why (appears in the contributions report)
        </label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Until
        </label>
        <input
          type="date"
          value={endsAt}
          max={maxDate}
          onChange={(e) => setEndsAt(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
        />
        {ceilingDate && (
          <p className="text-[11px] text-gray-500 mt-1">
            Your own access ends {fmt(ceiling!)}, so this cannot run past it.
          </p>
        )}
      </div>

      <button
        onClick={submit}
        disabled={saving || !picked || !reason || !endsAt}
        className="text-sm font-medium px-4 py-2 rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? "Assigning…" : "Assign"}
      </button>
    </div>
  );
}
