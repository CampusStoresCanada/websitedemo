import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/guards";
import SurveyManagementCard from "@/components/benchmarking/admin/SurveyManagementCard";
import ResponseRateCard from "@/components/benchmarking/admin/ResponseRateCard";
import { createAdminClient } from "@/lib/supabase/admin";
import CommitteeCard from "@/components/benchmarking/admin/CommitteeCard";

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
  let responseRate = { totalMemberOrgs: 0, drafts: 0, submitted: 0, verified: 0 };

  if (latestSurvey) {
    /*
      Active member stores, counted live on every render.

      This used to count `type = "Member"` and nothing else: 81 organisations,
      of which 25 are cancelled, one is archived and one is a test org. A
      response rate against 81 is not a low response rate, it is a wrong one,
      and it would have gone to the board looking like a failure before a single
      store had been invited.

      Deliberately NOT the recipient list, and deliberately not counting grace.
      Grace is a state that resolves — those stores either renew or lapse — and
      it resolves before the survey goes out, so freezing a denominator that
      includes them bakes in a number that is wrong by the time anyone reads it.
      Counting live means the figure follows the membership as it settles.
    */
    const { count: activeMembers } = await supabase
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("type", "Member")
      .eq("membership_status", "active")
      .is("archived_at", null)
      .not("is_test", "is", true);

    const totalOrgs = activeMembers ?? 0;

    /*
      The numerator has to exclude the same stores the denominator does, or a
      staff member walking the survey as Test Org (Member) shows up as a
      submission against a denominator that never counted them — 1/50 from a
      store that does not exist. Same reason cancelled and archived orgs come
      out: a submission from a store outside the active roster is not part of
      this year's response.
    */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: submissions } = (await (supabase as any)
      .from("benchmarking")
      .select("status, verified_by, organizations!inner(type, membership_status, archived_at, is_test)")
      .eq("fiscal_year", latestSurvey.fiscal_year)
      .eq("organizations.type", "Member")
      .eq("organizations.membership_status", "active")
      .is("organizations.archived_at", null)
      .not("organizations.is_test", "is", true)) as { data: any[] | null };

    const drafts = submissions?.filter((s) => s.status === "draft").length ?? 0;
    const submitted = submissions?.filter((s) => s.status === "submitted").length ?? 0;
    const verified = submissions?.filter((s) => s.verified_by !== null).length ?? 0;

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
      .select("id, benchmarking!inner(fiscal_year)", { count: "exact", head: true })
      .eq("committee_status", "pending")
      .eq("benchmarking.fiscal_year", latestSurvey.fiscal_year)) as { count: number | null };
    pendingFlagCount = count ?? 0;
  }

  // Who holds a benchmarking capability right now.
  //
  // Read with the admin client on purpose. The previous version queried
  // governance_role_assignments through the session client — and those tables
  // have RLS enabled with no policies at all, so it came back empty with
  // error:null and rendered "no reviewers" no matter who was appointed.
  //
  // capability_contributions is the canonical answer to "who holds what": it
  // already resolves ex officio holders and appointed ones through the same
  // view, which a query on one role_key never did.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: holderRows } = (await (createAdminClient() as any)
    .from("capability_contributions")
    .select("subject_id, display_name, capability, appointable")
    .like("capability", "benchmarking.%")
    .eq("is_active", true)
    .order("display_name")) as { data: any[] | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const holders = (holderRows ?? []).map((h: any) => ({
    subjectId: h.subject_id as string,
    name: (h.display_name as string) ?? "Unknown",
    capability: h.capability as string,
    // appointable:false means they hold it by office (the Secretary carries
    // all four). Worth marking, so nobody goes looking for a Remove button.
    exOfficio: h.appointable === false,
  }));

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
                  href="/benchmarking/recipients"
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-medium text-gray-700">
                    Recipients &amp; beta stores
                  </span>
                  <span className="text-xs text-gray-400">who gets it, and who goes first</span>
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

        <CommitteeCard holders={holders} />
      </div>
    </div>
  );
}
