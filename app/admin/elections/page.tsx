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
