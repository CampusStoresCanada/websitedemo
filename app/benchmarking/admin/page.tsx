import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/guards";
import SurveyManagementCard from "@/components/benchmarking/admin/SurveyManagementCard";
import ResponseRateCard from "@/components/benchmarking/admin/ResponseRateCard";
import { createAdminClient } from "@/lib/supabase/admin";
import CommitteeCard from "@/components/benchmarking/admin/CommitteeCard";
import CycleTimeline from "@/components/admin/elections/ElectionTimeline";
import { buildBenchmarkingTimeline, STAGE_TRANSITIONS } from "@/lib/benchmarking/timeline";
import type { TimelineStage } from "@/lib/elections/timeline";
import { updateSurveyStatus } from "@/lib/actions/benchmarking-admin";

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

  /*
    The cycle as one ordered spine, the way the election admin reads.

    ⛔ Facts gathered here and passed in; buildBenchmarkingTimeline is pure,
    exactly like buildElectionTimeline. One extra query, for the recipient
    queue — everything else is already loaded above for the cards.
  */
  let timeline: TimelineStage[] | null = null;
  if (latestSurvey) {
    const db = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: recipientRows } = (await (db as any)
      .from("benchmarking_recipients")
      .select("status, invited_at")
      .eq("survey_id", latestSurvey.id)) as { data: { status: string; invited_at: string | null }[] | null };

    const recips = recipientRows ?? [];
    const betaTesters = holders.filter(
      (h) => h.capability === "benchmarking.beta_tester",
    ).length;

    timeline = buildBenchmarkingTimeline(
      {
        fiscalYear: latestSurvey.fiscal_year,
        status: (latestSurvey.status as string) ?? "draft",
        opensAt: (latestSurvey.opens_at as string | null) ?? null,
        closesAt: (latestSurvey.closes_at as string | null) ?? null,
        recipientsTotal: recips.length,
        recipientsConfirmed: recips.filter(
          (r) => r.status === "confirmed" || r.status === "corrected",
        ).length,
        betaTestersAppointed: betaTesters,
        invited: recips.filter((r) => r.invited_at !== null).length,
        drafts: responseRate.drafts,
        submitted: responseRate.submitted,
        openFlags: pendingFlagCount,
        // Question review reads the newest survey whatever its status; its
        // progress is not on this page, so the stage reports what it knows.
        reviewDone: 0,
        reviewTotal: 0,
      },
      new Date().toISOString().slice(0, 10),
    );
  }

  /*
    Where each step goes. A path navigates; a function runs here.

    ⛔ Keyed by STAGE, the way the component expects, so a step and its action
    cannot drift apart. Every transition goes through updateSurveyStatus, which
    enforces the ladder server-side — the timeline offering a move is not the
    same as the server accepting it, and that gap is exactly what made `beta`
    unreachable.
  */
  const surveyId = latestSurvey?.id as string | undefined;
  const move = (to: string) => async () => {
    "use server";
    if (surveyId) await updateSurveyStatus(surveyId, to);
  };

  // ⛔ Keyed by ACTION key, not stage key — actions[act.key] is the lookup.
  const timelineActions: Record<string, ((formData: FormData) => Promise<void>) | string | undefined> = {
    openReview: "/benchmarking/admin/review",
    openQueue: "/benchmarking/recipients",
    appoint: "committee",
    startBeta: move("beta"),
    openSurvey: move("open"),
    openSendPanel: "/benchmarking/recipients",
    openReminders: "/benchmarking/recipients",
    closeSurvey: move("closed"),
    openFlagReview: "/benchmarking/admin/flags",
    beginProcessing: move("processing"),
    markComplete: move("complete"),
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Benchmarking Dashboard
      </h1>

      <div className="grid gap-6">
        {/*
          First, because it is the only thing on this screen that says what
          happens next. The cards below answer questions you already know to
          ask; the spine is for the eleven months a year when you do not.
        */}
        {timeline && (
          <CycleTimeline
            stages={timeline}
            title={`The FY${latestSurvey?.fiscal_year} cycle`}
            subtitle="Everything in the order it happens. Each step says what it is waiting for."
            actions={timelineActions}
          />
        )}

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
                    Walk the survey
                  </span>
                  {/* Says what it does now: the real form, as the test store. */}
                  <span className="text-xs text-gray-400">as the test store</span>
                </Link>
              </div>
            </div>
          </div>
        )}

        <div id="committee">
          <CommitteeCard holders={holders} />
        </div>
      </div>
    </div>
  );
}
