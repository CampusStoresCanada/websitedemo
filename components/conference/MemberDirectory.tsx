"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { filterListings, type DirectoryListing } from "@/lib/conference/member-directory-filter";

/**
 * Browsing the floor by what people sell.
 *
 * The map's other half. Search matches name, description and booth number in
 * one box, because a reader holding a booth number and a reader holding half a
 * company name are the same person thirty seconds apart.
 *
 * Department chips are additive: picking two shows both, not the intersection.
 * Nobody looking for apparel AND drinkware wants the empty set — they want
 * both aisles.
 */
export default function MemberDirectory({
  listings,
  departments,
  mapHref,
}: {
  listings: DirectoryListing[];
  departments: string[];
  mapHref: string;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const shown = useMemo(
    () => filterListings(listings, query, picked),
    [listings, query, picked]
  );

  function toggle(dept: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by company, booth number or what they sell"
        // 16px minimum, or iOS zooms the page on focus.
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base"
        aria-label="Search the exhibitor directory"
      />

      {departments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {departments.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggle(d)}
              aria-pressed={picked.has(d)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                picked.has(d)
                  ? "bg-[#163D6D] text-white"
                  : "border border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {d}
            </button>
          ))}
          {picked.size > 0 && (
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="px-2 py-1.5 text-sm font-medium text-gray-500 underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <p className="text-sm text-gray-500">
        {shown.length} of {listings.length} exhibitors
      </p>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          Nothing matches that. Try a shorter search, or clear the filters.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((l) => (
            <li key={l.orgId} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-start gap-3">
                {l.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.logoUrl} alt="" className="h-10 w-10 flex-shrink-0 object-contain" />
                ) : (
                  <div className="h-10 w-10 flex-shrink-0 rounded bg-gray-100" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className="text-base font-semibold text-gray-900">{l.name}</p>
                    {l.booths.length > 0 && (
                      <span className="text-sm font-medium tabular-nums text-[#163D6D]">
                        {l.booths.length === 1 ? "Booth" : "Booths"} {l.booths.join(", ")}
                      </span>
                    )}
                  </div>
                  {l.description && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">{l.description}</p>
                  )}
                  {l.departments.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">{l.departments.join(" · ")}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    {l.slug && (
                      <Link href={`/org/${l.slug}`} className="font-medium text-[#163D6D] hover:underline">
                        Profile
                      </Link>
                    )}
                    {l.booths.length > 0 && (
                      // Straight to the map with the search already filled in —
                      // the reader's next move is almost always "where is that".
                      <Link
                        href={`${mapHref}?find=${encodeURIComponent(l.name)}`}
                        className="font-medium text-[#163D6D] hover:underline"
                      >
                        Find on map
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
