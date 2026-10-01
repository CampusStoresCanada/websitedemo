import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/guards";
import ResponseRateCard from "@/components/benchmarking/admin/ResponseRateCard";
import { createAdminClient } from "@/lib/supabase/admin";
import CommitteeCard from "@/components/benchmarking/admin/CommitteeCard";
import CycleTimeline from "@/components/admin/elections/ElectionTimeline";
import { getBenchmarkingTimeline } from "@/lib/benchmarking/timeline";
import type { TimelineStage } from "@/lib/elections/timeline";
import { updateSurveyStatus } from "@/lib/actions/benchmarking-admin";
import SendPanel from "@/components/benchmarking/recipients/SendPanel";
import ConfirmSendButton from "@/components/admin/elections/ConfirmSendButton";
import { termEndsFor } from "@/lib/benchmarking/lifecycle";
import { CAPABILITIES } from "@/lib/auth/capability-names";
import { notFound } from "next/navigation";

export default async function BenchmarkingCyclePage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
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
  /*
    ⛔ One gatherer, not a second set of the same queries.

    This assembled the facts inline while getBenchmarkingTimeline assembled
    them for the calendar, so the two could disagree — and did: the recipient
    count here included a test store the queue excluded.
  */
  const timeline: TimelineStage[] | null = latestSurvey
    ? await getBenchmarkingTimeline(latestSurvey.id as string)
    : null;

  const surveyId = latestSurvey?.id as string | undefined;

  const send = (kind: "invitation" | "reminder") => async () => {
    "use server";
    if (!surveyId) return;
    const { sendInvitations, sendReminders } = await import(
      "@/lib/actions/benchmarking-recipients"
    );
    if (kind === "invitation") await sendInvitations({ surveyId });
    else await sendReminders({ surveyId });
  };

  const move = (to: string) => async () => {
    "use server";
    if (surveyId) await updateSurveyStatus(surveyId, to);
  };

  /*
    ⛔ Keyed by ACTION key, not stage key — actions[act.key] is the lookup.

    Every one of these either runs here or opens a panel ON THIS PAGE. A link
    carries the query that OPENS the panel rather than only scrolling to it,
    because a step that says "appoint someone" should leave you appointing
    someone, not looking at the control that would.

    The three that do navigate — question review, the recipient queue, the flag
    queue — are working queues somebody sits in for an hour, the same way
    elections keeps proxies and audit on their own pages. They are destinations,
    not the action the step names.
  */
  /*
    What each step sends, and the member-facing page it affects.

    ⛔ Both reuse the elections machinery rather than resembling it:
    StageMessage, the same preview modal, and the same ?preview=1 convention
    the timeline adds to every stagePages href. The preview is display-only —
    every write path re-checks the actor independently.
  */
  const stageMessages = latestSurvey
    ? await (await import("@/lib/benchmarking/notify")).benchmarkingStageMessages(
        latestSurvey.id as string,
      )
    : {};

  const stagePages: Record<string, { href: string; label: string }[]> = {
    question_review: [{ href: "/benchmarking/review", label: "reviewer's page" }],
    recipients: [{ href: "/benchmarking/recipients", label: "recipient queue" }],
    appoint_testers: [{ href: "/benchmarking/survey", label: "survey they will open" }],
    beta: [
      { href: "/benchmarking/survey", label: "survey" },
      { href: "/benchmarking/worksheet", label: "printable worksheet" },
    ],
    open: [
      { href: "/benchmarking/survey", label: "survey" },
      { href: "/benchmarking/worksheet", label: "printable worksheet" },
    ],
    interpretation: [{ href: "/benchmarking/admin/flags", label: "flag queue" }],
    complete: [{ href: "/benchmarking/compare", label: "what members will see" }],
  };

  /*
    How many a step would mail, so the confirmation names a number instead of
    asking a generic "are you sure". Read from the same planners the send panel
    uses — not a second count that can disagree with it.
  */
  const sendCounts: Record<string, { recipients: number | null; audience: string }> = {
    openSendPanel: {
      recipients: stageMessages.invitations?.[0]?.recipientCount ?? null,
      audience: "every store with a confirmed respondent that has not been invited",
    },
    openReminders: {
      recipients: stageMessages.reminders?.[0]?.recipientCount ?? null,
      audience: "invited stores that have not filed",
    },
  };

  /*
    The control lives IN the step.

    ⛔ Not an anchor to a panel further down. Pressing "Appoint someone" and
    being scrolled somewhere, to find a control and start again, is the step
    describing an act rather than containing one. Appointing is typing a name,
    so the name box is in the step.

    Same components, scoped: CommitteeCard renders only the beta slot, and
    SendPanel is locked to the one message the step names.
  */
  /*
    The cycle's answer to "how long does this appointment last", declared once
    in lifecycle.ts rather than typed per person.
  */
  const termEnds = latestSurvey
    ? Object.fromEntries(
        [
          CAPABILITIES.BENCHMARKING_CONTENT_REVIEW,
          CAPABILITIES.BENCHMARKING_BETA_TESTER,
          CAPABILITIES.BENCHMARKING_RECIPIENT_CONFIRM,
          CAPABILITIES.BENCHMARKING_QA_VERIFY,
          CAPABILITIES.BENCHMARKING_COMMITTEE_LEAD,
        ].map((c) => [
          c,
          termEndsFor(c, {
            opensAt: (latestSurvey.opens_at as string | null) ?? null,
            closesAt: (latestSurvey.closes_at as string | null) ?? null,
          }),
        ]),
      )
    : {};

  const stageControls: Record<string, React.ReactNode> = latestSurvey
    ? {
        appoint_testers: (
          <CommitteeCard
            holders={holders}
            only="benchmarking.beta_tester"
            termEnds={termEnds}
          />
        ),
        /*
          ⛔ The whole send panel used to sit here, so the step contained the
          plan, every blocked store and its reason. That is the work you do
          BEFORE sending, not the act — it belongs in the anchored panel below,
          the way elections keeps its readiness list in AgmPackagePanel.

          The act is one control: arm, then confirm naming the number.
        */
        invitations: (
          <ConfirmSendButton
            action={send("invitation")}
            label="Invite the stores"
            recipients={sendCounts.openSendPanel?.recipients ?? null}
            audience="stores with a confirmed respondent that have not been invited"
          />
        ),
        reminders: (
          <ConfirmSendButton
            action={send("reminder")}
            label="Send the reminder"
            recipients={sendCounts.openReminders?.recipients ?? null}
            audience="invited stores that have not filed"
          />
        ),
      }
    : {};

  const timelineActions: Record<string, ((formData: FormData) => Promise<void>) | string | undefined> = {
    openReview: "/benchmarking/admin/review",
    openQueue: "/benchmarking/recipients",

    startBeta: move("beta"),
    openSurvey: move("open"),


    closeSurvey: move("closed"),
    openFlagReview: "/benchmarking/admin/flags",
    beginProcessing: move("processing"),
    markComplete: move("complete"),
  };

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/benchmarking/admin"
          className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-900"
        >
          ← All cycles
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">
          FY{latestSurvey.fiscal_year} Benchmarking
        </h1>
      </div>

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
            stageMessages={stageMessages}
            stageControls={stageControls}
            stagePages={stagePages}
            sendCounts={sendCounts}
            // requireAdmin's context carries userId, not an address. This only
            // pre-fills the test-send box, so it is not worth a lookup.
            testEmail={null}
          />
        )}

        {/*
          Below the spine: the information and configuration a step points at.
          Which stores cannot be mailed and why is the work to do before
          sending, so it reads here rather than inside the act.
        */}
        {latestSurvey && (
          <div id="send">
            <SendPanel
              surveyId={latestSurvey.id as string}
              surveyStatus={(latestSurvey.status as string) ?? "draft"}
            />
          </div>
        )}


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
          <CommitteeCard holders={holders} termEnds={termEnds} />
        </div>
      </div>
    </div>
  );
}
