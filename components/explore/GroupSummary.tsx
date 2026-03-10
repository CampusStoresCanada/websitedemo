"use client";

import type { HomeMapOrg } from "@/lib/homepage";
import type { ExploreLens } from "@/lib/explore/types";
import { computeGroupSummary } from "@/lib/explore/filters";

interface GroupSummaryProps {
  orgs: HomeMapOrg[];
  lens: ExploreLens;
}

/** Group summary stats — shows aggregate info above filtered results */
export function GroupSummary({ orgs, lens }: GroupSummaryProps) {
  if (orgs.length === 0) return null;

  const { count, provinceCount, avgEnrollment, topPos } = computeGroupSummary(orgs, lens);

  return (
    <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600">
        <span>
          <span className="font-semibold text-gray-900">{count}</span> institution{count !== 1 ? "s" : ""}
        </span>
        {provinceCount > 0 && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span>
              <span className="font-semibold text-gray-900">{provinceCount}</span> province{provinceCount !== 1 ? "s" : ""}
            </span>
          </>
        )}
        {avgEnrollment != null && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span>
              Avg <span className="font-semibold text-gray-900">{avgEnrollment.toLocaleString()}</span> FTE
            </span>
          </>
        )}
        {topPos && (
          <>
            <span className="text-gray-300">&middot;</span>
            <span>
              Top POS: <span className="font-semibold text-gray-900">{topPos}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
