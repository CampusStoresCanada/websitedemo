"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignRegion } from "@/lib/actions/benchmarking-recipients";

/**
 * Handing a region to a regional rep.
 *
 * The queue already scopes itself — a rep sees their own region, the office
 * sees everything — but nothing put a rep on a region in the first place, so
 * every rep saw nothing and the scoping had no effect. This is the missing half.
 *
 * Assigning writes `assigned_to` across every active member store in that
 * region, so the rep's queue fills the moment it is set and empties when it is
 * cleared. Reassigning is the same act as assigning: the last person named owns
 * the region, and there is no half-state where two reps both think a store is
 * theirs.
 */

// Four patches, not the five the comparison uses. Quebec's two stores ride
// with Atlantic: a province is a peer group, but it is not a rep's round.
const REGIONS = ["Atlantic & Quebec", "Ontario", "Prairies", "West"] as const;

interface Person {
  id: string;
  name: string;
}

interface RegionRow {
  region: string;
  storeCount: number;
  repId: string | null;
  repName: string | null;
}

export default function RegionAssignment({
  surveyId,
  regions,
  people,
}: {
  surveyId: string;
  regions: RegionRow[];
  people: Person[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  async function assign(region: string, repId: string) {
    setBusy(region);
    setError(null);
    const res = await assignRegion(surveyId, region, repId || null);
    setBusy(null);
    if (!res.success) {
      setError(res.error ?? "Could not assign that region.");
      return;
    }
    setResult((p) => ({
      ...p,
      [region]: repId
        ? `${res.assigned ?? 0} store${res.assigned === 1 ? "" : "s"} assigned.`
        : "Region cleared.",
    }));
    router.refresh();
  }

  const byRegion = new Map(regions.map((r) => [r.region, r]));

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">Regions</h2>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        A rep sees only the stores in their region. Until a region has someone on it,
        that rep&rsquo;s queue is empty — which looks like nothing to do rather than
        nobody assigned.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}

      <ul className="mt-4 divide-y divide-gray-100">
        {REGIONS.map((region) => {
          const row = byRegion.get(region);
          return (
            <li key={region} className="flex flex-wrap items-center gap-3 py-3">
              <span className="w-24 font-medium text-gray-900">{region}</span>
              <span className="w-28 text-sm text-gray-500">
                {row?.storeCount ?? 0} store{row?.storeCount === 1 ? "" : "s"}
              </span>
              <select
                defaultValue={row?.repId ?? ""}
                disabled={busy === region}
                onChange={(e) => assign(region, e.target.value)}
                className="min-w-[200px] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Nobody assigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-500">
                {busy === region ? "Saving…" : result[region] ?? ""}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-gray-500">
        Only people holding the regional-rep capability appear here. Appoint one on{" "}
        <span className="font-medium">/admin/access</span> first.
      </p>
    </section>
  );
}
