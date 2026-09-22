"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  appointToCapability,
  searchPeopleForAppointment,
} from "@/lib/actions/capability-appointments";

/**
 * Appointing one person to one capability.
 *
 * Lives on its own because two surfaces need it: the committee console, where
 * a lead hands out their own workstreams, and the benchmarking dashboard,
 * where the office appoints the lead in the first place. One form, one server
 * action — a second appointment path is how two screens start disagreeing
 * about who holds what.
 */

/**
 * The last day someone still holds the capability.
 *
 * term_end is an EXCLUSIVE boundary — has_capability() and
 * capability_contributions.is_active both test `term_end > today`, so a row
 * ending 2027-01-01 is held through Dec 31. The appointment form writes it
 * that way too: picking Dec 31 stores Jan 1. So "until" means term_end minus
 * one day, and saying so beats a timezone trick that happens to subtract a
 * day because Mountain is behind UTC.
 */
export const fmt = (termEnd: string) => {
  const [y, m, d] = termEnd.slice(0, 10).split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1, d));
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return lastDay.toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
};

export default function AssignPanel({
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
    { id: string; name: string; email: string | null }[]
  >([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [reason, setReason] = useState(`CSC 2026 benchmarking — ${title}`);
  const [endsAt, setEndsAt] = useState("");
  const [dueDate, setDueDate] = useState("");
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
      setResults(await searchPeopleForAppointment(q));
    }, 250);
    return () => clearTimeout(t);
  }, [search, picked]);

  const submit = async () => {
    setSaving(true);
    onError(null);
    const iso = endsAt
      ? new Date(`${endsAt}T23:59:59-06:00`).toISOString()
      : "";
    const result = await appointToCapability({
      subjectId: picked?.id ?? "",
      capability,
      reason,
      endsAt: iso,
      dueDate: dueDate || undefined,
    });
    setSaving(false);
    if (result.success) {
      // The appointment stands either way, but "we could not reach them" is
      // the difference between someone who knows they have work and someone
      // who never finds out.
      if (result.inviteWarning) {
        onError(
          `Appointed, but the invitation email did not send: ${result.inviteWarning}. Let them know yourself.`,
        );
      }
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
          Finish by (goes in their invitation)
        </label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
        />
        <p className="text-[11px] text-gray-500 mt-1">
          When the work is wanted. Not the same as access below, which can run
          much longer. Leave blank and the invitation names no date.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Access until
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
