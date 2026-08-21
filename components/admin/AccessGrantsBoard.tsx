"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  grantCapability,
  revokeCapability,
  searchPeopleForGrant,
} from "@/lib/actions/capability-grants";

interface Row {
  id: string;
  subjectId: string;
  name: string;
  capability: string;
  reason: string;
  grantedByName: string | null;
  startsAt: string;
  endsAt: string;
  revokedAt: string | null;
  isActive: boolean;
}

const CAPABILITY_LABEL: Record<string, string> = {
  "benchmarking.content_review": "Benchmarking — question review",
  "benchmarking.qa_verify": "Benchmarking — QA verification",
  "benchmarking.recipient_confirm": "Benchmarking — recipient confirmation",
};

// Mountain time — every stored timestamp is UTC.
const MTN = "America/Edmonton";
function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: MTN,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
function daysLeft(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function AccessGrantsBoard({
  rows,
  year,
}: {
  rows: Row[];
  year: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "contributions">("active");

  const active = useMemo(() => rows.filter((r) => r.isActive), [rows]);
  const expiringSoon = active.filter((r) => daysLeft(r.endsAt) <= 14);

  // The AGM answer: everyone who held a grant during the year.
  const contributions = useMemo(() => {
    const start = new Date(`${year}-01-01T00:00:00Z`).getTime();
    const end = new Date(`${year + 1}-01-01T00:00:00Z`).getTime();
    const inYear = rows.filter((r) => {
      const s = new Date(r.startsAt).getTime();
      const e = new Date(r.endsAt).getTime();
      return s < end && e > start;
    });
    const byPerson = new Map<string, { name: string; items: Row[] }>();
    for (const r of inYear) {
      const entry = byPerson.get(r.subjectId) ?? { name: r.name, items: [] };
      entry.items.push(r);
      byPerson.set(r.subjectId, entry);
    }
    return Array.from(byPerson.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [rows, year]);

  const revoke = async (id: string) => {
    setBusy(id);
    setError(null);
    const result = await revokeCapability(id);
    if (result.success) router.refresh();
    else setError(result.error ?? "Failed");
    setBusy(null);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Access Grants</h1>
      <p className="text-sm text-gray-500 mb-6">
        Narrow capabilities with an end date. Everything here dissolves on its
        own — permanent access is a role, not a grant.
      </p>

      {expiringSoon.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">
              {expiringSoon.length} grant
              {expiringSoon.length === 1 ? "" : "s"}
            </span>{" "}
            expire in the next two weeks. If the work is still going, extend
            before it lapses.
          </p>
        </div>
      )}

      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {(
          [
            ["active", `Active (${active.length})`],
            ["contributions", `${year} contributions`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4 p-3 bg-red-50 rounded">
          {error}
        </p>
      )}

      {tab === "active" && (
        <>
          <GrantForm onDone={() => router.refresh()} onError={setError} />
          {active.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center bg-gray-50 rounded-lg">
              Nobody currently holds a grant.
            </p>
          ) : (
            <div className="space-y-2">
              {active.map((r) => {
                const left = daysLeft(r.endsAt);
                return (
                  <div
                    key={r.id || `${r.subjectId}-${r.startsAt}`}
                    className="flex items-start justify-between gap-4 p-4 bg-white border border-gray-200 rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">
                          {r.name}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                          {CAPABILITY_LABEL[r.capability] ?? r.capability}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{r.reason}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Until {fmt(r.endsAt)} ·{" "}
                        <span
                          className={
                            left <= 14 ? "text-amber-700 font-medium" : ""
                          }
                        >
                          {left} day{left === 1 ? "" : "s"} left
                        </span>
                        {r.grantedByName
                          ? ` · granted by ${r.grantedByName}`
                          : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => revoke(r.id)}
                      disabled={busy === r.id || !r.id}
                      className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      {busy === r.id ? "…" : "Revoke"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "contributions" && (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Everyone who held a grant during {year}, including grants that have
            since expired or been revoked — the work still happened. This is the
            AGM thank-you list.
          </p>
          {contributions.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center bg-gray-50 rounded-lg">
              No grants held during {year}.
            </p>
          ) : (
            <div className="space-y-3">
              {contributions.map((person) => (
                <div
                  key={person.name}
                  className="p-4 bg-white border border-gray-200 rounded-lg"
                >
                  <p className="text-sm font-semibold text-gray-900">
                    {person.name}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {person.items.map((i, idx) => (
                      <li key={idx} className="text-xs text-gray-600">
                        {CAPABILITY_LABEL[i.capability] ?? i.capability} —{" "}
                        {i.reason}{" "}
                        <span className="text-gray-400">
                          ({fmt(i.startsAt)} to {fmt(i.endsAt)})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function GrantForm({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; globalRole: string }[]
  >([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [capability, setCapability] = useState("benchmarking.content_review");
  const [reason, setReason] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);

  // Search as you type. An Enter-only binding is invisible, and this form is
  // used a handful of times a year by people who will not guess it.
  useEffect(() => {
    const q = search.trim();
    if (picked || q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const result = await searchPeopleForGrant(q);
      if (result.success && result.people) setResults(result.people);
      else setResults([]);
    }, 250);
    return () => clearTimeout(t);
  }, [search, picked]);

  const submit = async () => {
    setSaving(true);
    onError(null);
    // datetime-local / date inputs parse in the runtime's timezone. Pin to
    // end-of-day Mountain so a grant lasts the whole day it names.
    const iso = endsAt
      ? new Date(`${endsAt}T23:59:59-06:00`).toISOString()
      : "";
    const result = await grantCapability({
      subjectId: subjectId.trim(),
      capability,
      reason,
      endsAt: iso,
    });
    setSaving(false);
    if (result.success) {
      setSubjectId("");
      setPicked(null);
      setSearch("");
      setResults([]);
      setReason("");
      setEndsAt("");
      setOpen(false);
      onDone();
    } else {
      onError(result.error ?? "Could not grant");
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 text-sm font-medium px-4 py-2 rounded bg-gray-900 text-white hover:bg-gray-800"
      >
        Grant a capability
      </button>
    );
  }

  return (
    <div className="mb-5 p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Person
          </label>
          {picked ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded bg-white">
              <span className="text-sm text-gray-900">{picked.name}</span>
              <button
                onClick={() => {
                  setPicked(null);
                  setSubjectId("");
                }}
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
                          setSubjectId(p.id);
                          setResults([]);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        {p.name}{" "}
                        <span className="text-xs text-gray-400">
                          {p.globalRole}
                        </span>
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
            Capability
          </label>
          <select
            value={capability}
            onChange={(e) => setCapability(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white"
          >
            {Object.entries(CAPABILITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Why (appears in the contributions report)
        </label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="CSC 2026 benchmarking question review panel"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Until (end of that day, Mountain)
        </label>
        <input
          type="date"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving || !subjectId || !reason || !endsAt}
          className="text-sm font-medium px-4 py-2 rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Granting…" : "Grant"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-sm font-medium px-4 py-2 rounded border border-gray-300 text-gray-600 hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
