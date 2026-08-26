/**
 * /admin/elections — every election, past and upcoming.
 *
 * Thin by design: the work happens on a single election's review page. This
 * exists so the breadcrumb resolves and so a past cycle stays reachable, which
 * matters more than it sounds — each election pins the config it ran under, so
 * old rows are the record of what the rules were at the time.
 */

import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { startElectionCycleAction } from "@/lib/actions/elections";
import { CSC_ELECTIONS_CONFIG } from "@/lib/elections/config";
import { resolveAgmDate, deriveSchedule } from "@/lib/elections/schedule";

export const metadata = { title: "Elections | Admin | Campus Stores Canada" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  nominating: "bg-blue-100 text-blue-700",
  nominations_closed: "bg-amber-100 text-amber-800",
  balloting: "bg-blue-100 text-blue-700",
  sealed: "bg-purple-100 text-purple-700",
  certified: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ElectionsIndexPage() {
  const db = createAdminClient();

  async function startCycle(formData: FormData) {
    "use server";
    await startElectionCycleAction(formData);
  }

  // Offer the next two cycles that are not already open, with the rule-derived
  // AGM date shown so nobody has to work out which Thursday it is. Only cycles
  // whose AGM is still AHEAD — offering to "open" an election for a meeting that
  // happened seven months ago is an invitation to create a mess.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const nowYear = new Date().getUTCFullYear();
  const { data: openCycles } = await db.from("elections").select("cycle_year");
  const taken = new Set((openCycles ?? []).map((e) => e.cycle_year as number));
  const offerable = [nowYear, nowYear + 1, nowYear + 2]
    .filter((y) => !taken.has(y))
    .map((y) => {
      const agm = resolveAgmDate(CSC_ELECTIONS_CONFIG, y);
      return {
        year: y,
        agm,
        nominationsOpen: agm ? deriveSchedule(agm, CSC_ELECTIONS_CONFIG).nominationsOpenAt : null,
      };
    })
    .filter((c) => !!c.agm && c.agm > today)
    .slice(0, 2);
  const { data: elections } = await db
    .from("elections")
    .select("slug, cycle_year, agm_date, seats_available, status, outcome, governance_bodies(name)")
    .order("cycle_year", { ascending: false });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Elections"
        description="Nominations, ballots, and results. Each election keeps the rules it ran under."
      />

      {offerable.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Open a cycle</h2>
          <p className="mt-1 text-xs text-gray-500">
            Creates the election, publishes the members-only AGM event, and puts the cycle&apos;s
            obligations on the board&apos;s list assigned to the officers who hold them. The AGM
            date comes from the rule; override it if the board has moved the meeting.
          </p>
          <form action={startCycle} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-600">
              <span className="block font-medium text-gray-900">Cycle</span>
              <select name="cycleYear" className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {offerable.map((c) => (
                  <option key={c.year} value={c.year}>
                    {c.year} — AGM {c.agm}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              <span className="block font-medium text-gray-900">Seats up</span>
              <input
                type="number"
                name="seatsAvailable"
                min={1}
                max={20}
                defaultValue={4}
                className="mt-1 w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-gray-600">
              <span className="block font-medium text-gray-900">AGM date override</span>
              <input
                type="date"
                name="agmDateOverride"
                className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-[#B92026] px-4 py-2 text-sm font-medium text-white hover:bg-[#9c1b20]"
            >
              Open the cycle
            </button>
          </form>
          <p className="mt-3 text-xs text-amber-700">
            Confirm the seat count against the term register before opening. CSC alternates four and
            five, but a seat filled mid-term by appointment shifts the pattern.
          </p>
        </section>
      )}

      {!elections || elections.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-5 py-8 text-sm text-gray-500">
          No elections yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {elections.map((e) => (
            <li key={e.slug as string}>
              <Link
                href={`/admin/elections/${e.slug}`}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {e.cycle_year} {(e.governance_bodies as { name: string } | null)?.name ?? "Election"}
                  </p>
                  <p className="text-sm text-gray-600">
                    {e.seats_available} seat{e.seats_available === 1 ? "" : "s"} · AGM{" "}
                    {formatDate(e.agm_date as string)}
                    {e.outcome ? ` · ${e.outcome}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[e.status as string] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {(e.status as string).replace(/_/g, " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
