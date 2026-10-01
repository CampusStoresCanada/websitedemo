import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { loginWithNext } from "@/lib/auth/login-redirect";
import { CAPABILITIES } from "@/lib/auth/capability-names";
import { createClient } from "@/lib/supabase/server";
import { surveyState } from "@/lib/benchmarking/lifecycle";
import {
  formatDeadline,
  formatOpening,
  boundaryFromLastDay,
  openingFromDay,
} from "@/lib/benchmarking/deadline";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { createBenchmarkingSurvey } from "@/lib/actions/benchmarking-admin";

export const metadata = {
  title: "Benchmarking | Admin | Campus Stores Canada",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  beta: "bg-purple-100 text-purple-700",
  open: "bg-green-100 text-green-700",
  closed: "bg-amber-100 text-amber-800",
  processing: "bg-blue-100 text-blue-700",
  complete: "bg-gray-100 text-gray-600",
};

/**
 * /benchmarking/admin — every cycle, past and upcoming.
 *
 * ⛔ The same page as /admin/elections, down to the shape: a header, the one
 * act that is not about a particular year, then the list. Thin by design — the
 * work happens on a single cycle's page.
 *
 * What used to be here instead was a dashboard for whichever survey sorted
 * first, with a "Survey Management" card in the MIDDLE listing the surveys
 * again. So the page named a year at the top, listed the years again halfway
 * down, and the year you were acting on was a property of neither.
 */
export default async function BenchmarkingCyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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

  /*
    ⛔ requireAuthenticated, not requireAdmin, because a denial here needs to
    know what the person DOES hold. The layout has already admitted them, so
    everyone reaching this line has a page inside the shell — they just do not
    own the cycle list, and sending them to a year is only half an answer if it
    is the wrong page within it. Interpretation's whole job is the flag queue.
  */
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect(loginWithNext("/benchmarking/admin"));

  if (!isGlobalAdmin(auth.ctx.globalRole)) {
    const newest = (surveys ?? [])[0]?.fiscal_year;
    if (!newest) redirect("/benchmarking");
    redirect(
      auth.ctx.capabilities.includes(CAPABILITIES.BENCHMARKING_QA_VERIFY)
        ? `/benchmarking/admin/${newest}/flags`
        : `/benchmarking/admin/${newest}/submissions`,
    );
  }
  const rows = surveys ?? [];

  async function openCycle(formData: FormData) {
    "use server";
    const fiscalYear = Number(formData.get("fiscalYear"));
    const title = String(formData.get("title") ?? "").trim();
    /*
      ⛔ A date input gives a bare day; closes_at is an EXCLUSIVE boundary
      instant. Stored raw, "2026-11-20" would shut the survey at 4pm Pacific on
      the 19th out west while every surface went on saying the 20th.
      deadline.ts converts in both directions — see formatDeadline.
    */
    const opensAt = openingFromDay(String(formData.get("opensAt") ?? "").trim());
    const closesAt = boundaryFromLastDay(String(formData.get("closesAt") ?? "").trim());

    const result = await createBenchmarkingSurvey(
      fiscalYear,
      title || `CSC ${fiscalYear} Benchmarking Survey`,
      opensAt,
      closesAt,
    );
    if (!result.success) {
      redirect(`/benchmarking/admin?error=${encodeURIComponent(result.error ?? "Could not open the cycle.")}`);
    }
    revalidatePath("/benchmarking/admin", "layout");
    redirect(`/benchmarking/admin/${fiscalYear}`);
  }

  /*
    The years not already open, newest first — the same offer elections makes,
    for the same reason: a free-text year field is how you end up with FY2062.

    ⛔ No derived dates beside them, unlike elections. Elections' offsets encode
    the by-law; benchmarking's are an annual committee decision, so suggesting
    one here would be inventing policy. The wizard that asks for them is the
    2027 job.
  */
  const taken = new Set(rows.map((s) => s.fiscal_year as number));
  const thisYear = new Date().getUTCFullYear();
  const offerable = [thisYear, thisYear + 1, thisYear + 2].filter((y) => !taken.has(y));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Benchmarking"
        description="Collection, interpretation, and results. Each cycle keeps the dates it ran under."
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {offerable.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Open a cycle</h2>
          <p className="mt-1 text-xs text-gray-500">
            Creates the survey in draft and opens its page. Nothing is sent and nobody is
            appointed — the cycle&apos;s own timeline does that, a step at a time.
          </p>
          <form action={openCycle} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-600">
              <span className="block font-medium text-gray-900">Fiscal year</span>
              <select
                name="fiscalYear"
                className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {offerable.map((y) => (
                  <option key={y} value={y}>
                    FY{y}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              <span className="block font-medium text-gray-900">Title</span>
              <input
                type="text"
                name="title"
                placeholder={`CSC ${offerable[0]} Benchmarking Survey`}
                className="mt-1 w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-gray-600">
              <span className="block font-medium text-gray-900">Collection opens</span>
              <input
                type="date"
                name="opensAt"
                className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-gray-600">
              <span className="block font-medium text-gray-900">Last day to file</span>
              <input
                type="date"
                name="closesAt"
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
            The closing date is what every member sees as their deadline, and it sets when
            appointed reviewers and beta testers lose access. Confirm it with the committee
            before opening.
          </p>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-5 py-8 text-sm text-gray-500">
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
                        ? ` · opens ${formatOpening(s.opens_at)}`
                        : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[s.status as string] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {def?.label ?? s.status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
