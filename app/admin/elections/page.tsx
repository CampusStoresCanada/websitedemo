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
import { resolveAgmDate } from "@/lib/elections/schedule";
import { listMembersMeetings } from "@/lib/governance/members-meetings-service";

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

  // Offer the next two cycles that are not already open.
  //
  // ⛔ No longer filtered by whether the AGM is still ahead. There is no AGM
  // date to filter on until a meeting is connected, and an election is a
  // perfectly sensible thing to open before anyone has fixed the day.
  const nowYear = new Date().getUTCFullYear();
  const { data: openCycles } = await db.from("elections").select("cycle_year");
  const taken = new Set((openCycles ?? []).map((e) => e.cycle_year as number));

  // ⛔ Opening a cycle no longer touches a meeting, so nothing here derives a
  // date, pins an override, or filters on when the AGM would fall. An election
  // is created with NO calendar and gets one when a members' meeting is
  // connected to it — from either screen. The by-law's suggestion is shown as
  // context only, and a year whose meeting already exists says so, because that
  // is useful to know before you open the cycle rather than after.
  const membersMeetings = await listMembersMeetings();
  const scheduledByYear = new Map(
    membersMeetings
      .filter((m) => m.status !== "cancelled")
      .map((m) => [m.meetingDate.slice(0, 4), m] as const)
  );

  // ⛔ A year whose members' meeting has ALREADY SAT is not offered. I removed
  // this filter when decoupling, on the reasoning that there is no AGM date to
  // filter on any more — true of the election, but the offer is per YEAR, and
  // the screen then offered a 2026 cycle whose AGM was in January. The old
  // comment had it right: offering to open an election for a meeting that
  // happened seven months ago is an invitation to create a mess.
  //
  // A year with no meeting yet is still offered, because opening the election
  // before anyone has fixed the day is exactly what the decoupling allows.
  const today = new Date().toISOString().slice(0, 10);
  const offerable = [nowYear, nowYear + 1, nowYear + 2]
    .filter((y) => !taken.has(y))
    .map((y) => ({
      year: y,
      scheduled: scheduledByYear.get(String(y)) ?? null,
      suggested: resolveAgmDate(CSC_ELECTIONS_CONFIG, y),
    }))
    .filter((c) => !c.scheduled || c.scheduled.meetingDate >= today)
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
            This creates the election and nothing else. It does not schedule, move or imply a
            meeting of the members. An election has no calendar until a meeting is connected to
            it, because when nominations open and close, when ballots go out, and when notice is
            due are all measured back from the day that meeting sits.
          </p>

          <div className="mt-4 space-y-3">
            {offerable.map((c) => (
              <div
                key={c.year}
                className="rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{c.year} cycle</p>
                    {c.scheduled ? (
                      <p className="mt-0.5 text-xs text-green-700">
                        A members&apos; meeting is already scheduled for {c.year} on{" "}
                        {formatDate(c.scheduled.meetingDate)} — you can connect this election to
                        it once it is open.{" "}
                        <Link
                          href={`/admin/members-meetings/${c.scheduled.id}`}
                          className="underline"
                        >
                          See the meeting
                        </Link>
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-gray-500">
                        No members&apos; meeting is scheduled for {c.year} yet
                        {c.suggested ? ` — the by-law puts it around ${formatDate(c.suggested)}` : ""}
                        .{" "}
                        <Link href="/admin/members-meetings/new" className="underline">
                          Schedule one
                        </Link>
                      </p>
                    )}
                  </div>

                  <form action={startCycle} className="flex items-end gap-3">
                    <input type="hidden" name="cycleYear" value={c.year} />
                    <label className="text-xs text-gray-600">
                      <span className="block font-medium text-gray-900">Seats up</span>
                      <input
                        type="number"
                        name="seatsAvailable"
                        min={1}
                        max={20}
                        defaultValue={4}
                        className="mt-1 w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-lg bg-[#B92026] px-4 py-2 text-sm font-medium text-white hover:bg-[#9c1b20]"
                    >
                      Open the cycle
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>

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
                    {e.seats_available} seat{e.seats_available === 1 ? "" : "s"} ·{" "}
                    {/* ⛔ Was `formatDate(e.agm_date as string)`, which renders
                        "Invalid Date" for an election in setup. An election with
                        no meeting connected has no AGM date to show, and saying
                        so is the useful thing to say. */}
                    {e.agm_date
                      ? `AGM ${formatDate(e.agm_date as string)}`
                      : "no meeting connected"}
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
