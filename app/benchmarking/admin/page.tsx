import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { surveyState } from "@/lib/benchmarking/lifecycle";
import { formatDeadline } from "@/lib/benchmarking/deadline";
import { parseUTC } from "@/lib/utils";
import SurveyManagementCard from "@/components/benchmarking/admin/SurveyManagementCard";

export const metadata = {
  title: "Benchmarking | Admin | Campus Stores Canada",
};

/**
 * The cycles, one per line. Pick one to work on it.
 *
 * ⛔ Modelled on /admin/elections, and the shape is the point. Benchmarking had
 * a single dashboard that showed whichever survey sorted first, with a Survey
 * Management card in the MIDDLE of the page to change which. So the year you
 * were acting on was a property of a card halfway down, and a transition —
 * opening a survey, closing it — was pressed against "whatever was newest".
 *
 * An election is worked one cycle at a time, on its own page, and you are never
 * in doubt which one. This is that.
 */
export default async function BenchmarkingCyclesPage() {
  const supabase = await createClient();

  /*
    ⛔ Surveys read BEFORE the admin gate, because the bounce needs a year.

    This sent a non-admin to /benchmarking/admin/submissions, which stopped
    existing the moment the deep dives moved under the cycle — so an
    interpretation reviewer following their own task link would have landed on
    a 404. A redirect to a route that no longer exists is the quietest kind of
    broken: nothing errors, the person simply cannot get to their work.
  */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: surveys } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("id, title, fiscal_year, status, opens_at, closes_at")
    .order("fiscal_year", { ascending: false })) as { data: any[] | null };

  const auth = await requireAdmin();
  if (!auth.ok) {
    const newest = (surveys ?? [])[0]?.fiscal_year;
    redirect(
      newest
        ? `/benchmarking/admin/${newest}/submissions`
        : "/benchmarking",
    );
  }
  const rows = surveys ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Benchmarking</h1>
      <p className="text-sm text-gray-600 mb-6">
        One cycle at a time. Open a year to see where it is and what moves it on.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-5 py-6 text-sm text-gray-500">
          No cycles yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {rows.map((s) => {
            const def = surveyState(s.status ?? "draft");
            return (
              <li key={s.id as string}>
                <Link
                  href={`/benchmarking/admin/${s.fiscal_year}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      FY{s.fiscal_year} {s.title ?? "Benchmarking Survey"}
                    </p>
                    <p className="text-sm text-gray-600">
                      {def?.meaning ?? "Unrecognised state."}
                      {s.closes_at ? ` · closes ${formatDeadline(s.closes_at)}` : ""}
                      {!s.closes_at && s.opens_at
                        ? ` · opens ${parseUTC(s.opens_at).toLocaleDateString("en-CA")}`
                        : ""}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {def?.label ?? s.status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        Creating a cycle lives here, with the list, because that is the one act
        that is not about a particular year.
      */}
      <div className="mt-6">
        <SurveyManagementCard surveys={rows} />
      </div>
    </div>
  );
}
