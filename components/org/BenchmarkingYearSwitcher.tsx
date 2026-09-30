"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * Look at a different year of this store's own filings.
 *
 * ⛔ Only offers years this reader is entitled to. The list arrives already
 * filtered: an unreleased year reaches the store itself and CSC staff and
 * nobody else, and asking for one in the URL is checked against the same rule
 * rather than trusted.
 *
 * The unreleased year is marked rather than hidden from its own store. Reading
 * back what you filed is the whole reason to come here between submitting and
 * the committee's release.
 */
export default function BenchmarkingYearSwitcher({
  years,
  current,
}: {
  years: { fiscalYear: number; released: boolean }[];
  current: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (years.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Year
      </span>
      {years.map((year) => {
        const active = year.fiscalYear === current;
        return (
          <button
            key={year.fiscalYear}
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              next.set("fy", String(year.fiscalYear));
              router.push(`${pathname}?${next.toString()}`, { scroll: false });
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? "border-[#163D6D] bg-[#163D6D] text-white"
                : "border-gray-300 text-gray-700 hover:border-[#163D6D] hover:text-[#163D6D]"
            }`}
          >
            FY{year.fiscalYear}
            {!year.released && (
              <span className={active ? " text-white/80" : " text-gray-500"}>
                {" "}
                · not yet released
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
