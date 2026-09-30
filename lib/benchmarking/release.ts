import { createAdminClient } from "@/lib/supabase/admin";
import { isYearClosedToWrites } from "@/lib/benchmarking/metrics";

/*
  ⛔ No `import "server-only"`, despite this being server code.

  lib/data.ts imports releasedFiscalYears, and a dozen client components import
  types from lib/data.ts, so the marker put server-only into their bundles and
  the build refused. lib/data.ts already reaches createAdminClient under the
  same constraint; fixing it properly means splitting types out of lib/data,
  which is a change to a file the whole site imports and not this one's job.
*/

/**
 * Which years the committee has actually released.
 *
 * ⛔ Filing is not publishing. Before this, a figure went live on a store's own
 * page and into everyone else's peer set the moment a row existed — and because
 * nothing filtered on status, that included a row a store had merely OPENED. A
 * store clicking into the survey replaced a full year of verified figures with
 * an empty one before typing anything.
 *
 * `complete` on benchmarking_surveys is the switch. It is the same status
 * isYearClosedToWrites already treats as final, so the release is one fact with
 * one name rather than a second flag that can disagree with the first.
 */
export async function releasedFiscalYears(): Promise<number[]> {
  const { data } = await createAdminClient()
    .from("benchmarking_surveys")
    .select("fiscal_year, status")
    .order("fiscal_year", { ascending: false });

  return (data ?? [])
    .filter((s) => isYearClosedToWrites(s.status as string | null))
    .map((s) => s.fiscal_year as number);
}

/**
 * Whether a row may be shown to somebody other than the store that filed it.
 *
 * A store sees its own figures whatever state they are in: they are its own
 * answers and it should be able to read back what it filed. Everyone else waits
 * for the committee.
 */
export function isReleased(
  fiscalYear: number | null | undefined,
  released: number[],
): boolean {
  return typeof fiscalYear === "number" && released.includes(fiscalYear);
}
