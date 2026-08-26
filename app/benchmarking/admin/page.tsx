import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/guards";
import SurveyManagementCard from "@/components/benchmarking/admin/SurveyManagementCard";
import ResponseRateCard from "@/components/benchmarking/admin/ResponseRateCard";

export default async function BenchmarkingAdminPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect("/benchmarking/admin/submissions");
  }

  const supabase = await createClient();

  // Fetch all surveys
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: surveys } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("*")
    .order("fiscal_year", { ascending: false })) as { data: any[] | null };

  const latestSurvey = surveys?.[0] ?? null;

  // Response rate for latest survey
  let responseRate = {
    totalMemberOrgs: 0,
    drafts: 0,
    submitted: 0,
    verified: 0,
  };

  if (latestSurvey) {
    // Count active member orgs
    const { count: totalOrgs } = await supabase
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("type", "Member");

    // Count submissions by status for this fiscal year
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: submissions } = (await (supabase as any)
      .from("benchmarking")
      .select("status, verified_by")
      .eq("fiscal_year", latestSurvey.fiscal_year)) as { data: any[] | null };

    const drafts = submissions?.filter((s) => s.status === "draft").length ?? 0;
    const submitted =
      submissions?.filter((s) => s.status === "submitted").length ?? 0;
    const verified =
      submissions?.filter((s) => s.verified_by !== null).length ?? 0;

    responseRate = {
      totalMemberOrgs: totalOrgs ?? 0,
      drafts,
      submitted,
      verified,
    };
  }

  // Pending flags count
  let pendingFlagCount = 0;
  if (latestSurvey) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = (await (supabase as any)
      .from("delta_flags")
      .select("id, benchmarking!inner(fiscal_year)", {
        count: "exact",
        head: true,
      })
      .eq("committee_status", "pending")
      .eq("benchmarking.fiscal_year", latestSurvey.fiscal_year)) as {
      count: number | null;
    };
    pendingFlagCount = count ?? 0;
  }

  // Who currently holds benchmarking capabilities. Granting happens in
  // /admin/access, where a grant carries an end date and a reason.
  const nowIso = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: benchmarkingGrants } = (await (createAdminClient() as any)
    .from("capability_contributions")
    .select("display_name, capability, reason, ends_at")
    .like("capability", "benchmarking.%")
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .is("revoked_at", null)
    .order("display_name")) as { data: any[] | null };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Benchmarking Dashboard
      </h1>

      <div className="grid gap-6">
        <SurveyManagementCard surveys={surveys ?? []} />

        {latestSurvey && (
          <div className="grid md:grid-cols-2 gap-6">
            <ResponseRateCard
              fiscalYear={latestSurvey.fiscal_year}
              totalMemberOrgs={responseRate.totalMemberOrgs}
              drafts={responseRate.drafts}
              submitted={responseRate.submitted}
              verified={responseRate.verified}
            />

            {/* Quick Stats */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                Quick Actions
              </h3>
              <div className="space-y-3">
                <Link
                  href="/benchmarking/admin/submissions"
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-medium text-gray-700">
                    View All Submissions
                  </span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                    {responseRate.drafts + responseRate.submitted} total
                  </span>
                </Link>
                <Link
                  href="/benchmarking/admin/flags"
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-medium text-gray-700">
                    Review Flagged Values
                  </span>
                  {pendingFlagCount > 0 ? (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                      {pendingFlagCount} pending
                    </span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                      All clear
                    </span>
                  )}
                </Link>
                <Link
                  href="/benchmarking/admin/preview"
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-medium text-gray-700">
                    Preview Survey
                  </span>
                  <span className="text-xs text-gray-400">8 sections</span>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Who holds benchmarking capabilities right now */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              Committee Access
            </h3>
            <Link
              href="/admin/access"
              className="text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2"
            >
              Manage grants
            </Link>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Everyone holding a benchmarking capability right now. Each grant has
            an end date and dissolves on its own.
          </p>
          {(benchmarkingGrants ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">Nobody currently holds one.</p>
          ) : (
            <ul className="space-y-2">
              {(benchmarkingGrants ?? []).map((g, i) => (
                <li
                  key={i}
                  className="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {g.display_name ?? "Unknown"}
                    </span>
                    <p className="text-xs text-gray-500">{g.reason}</p>
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0">
                    until{" "}
                    {new Date(g.ends_at).toLocaleDateString("en-CA", {
                      timeZone: "America/Edmonton",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
