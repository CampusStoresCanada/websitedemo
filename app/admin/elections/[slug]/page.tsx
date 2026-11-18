/**
 * /admin/elections/[slug] — the nominating committee's working view.
 *
 * Deliberately NOT an approval screen. By-Law Part V has no slate-approval gate:
 * an election happens if more validated nominees stand than there are seats, and
 * otherwise the slate is acclaimed. What the committee actually does is talk to
 * people — about withdrawing where they are unlikely to be elected, and about
 * whether the slate reflects the membership. That is continuous work, so this
 * page is a picture to return to, not a decision to make once.
 *
 * The only action offered is "ask to withdraw", and it is worded as a request
 * because that is all it is — the nominee decides.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import RepresentationPanel from "@/components/admin/elections/RepresentationPanel";
import ReminderSchedulePanel from "@/components/admin/elections/ReminderSchedulePanel";
import PhaseSection from "@/components/admin/elections/PhaseSection";
import DirectorTermsEditor from "@/components/admin/elections/DirectorTermsEditor";
import {
  getCommitteeReview,
  countOutstandingBallots,
} from "@/lib/elections/service";
import { getMembersMeetingByDate } from "@/lib/governance/members-meetings-service";
import {
  requestWithdrawalAction,
  chaseIncompleteAction,
  chaseCosignaturesAction,
  mintElectionActionItemsAction,
  closeNominationsAction,
  saveReminderScheduleAction,
} from "@/lib/actions/elections";
import { ELECTION_TASKS } from "@/lib/elections/action-items";
import { canCloseNominations } from "@/lib/elections/schedule";
import { planReminders } from "@/lib/elections/reminders";

export const metadata = { title: "Election | Admin | Campus Stores Canada" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "warn" | "good";
  hint?: string;
}) {
  const tones = {
    neutral: "text-gray-900",
    warn: "text-amber-700",
    good: "text-green-700",
  } as const;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export default async function ElectionReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    error?: string;
    closed?: string;
    circulated?: string;
    reminderError?: string;
    remindersSaved?: string;
    cosignersChased?: string;
  }>;
}) {
  const { slug } = await params;
  const {
    error: closeError,
    closed,
    circulated,
    reminderError,
    remindersSaved,
    cosignersChased,
  } = await searchParams;

  const review = await getCommitteeReview(slug);
  if (!review) notFound();

  // Loaded after the review, which is what persists the eligibility rows this
  // reads — see getElectionMessagesForSlug.
  const MESSAGE_STAGES: Record<string, string> = {
    call: "call_for_nominations",
    ballots_open: "circulate_ballots",
    ballot_reminder: "ballots_close",
    nomination_reminder: "nominations_close",
    agm_notice: "agm_notice",
    proxy_form: "proxy_form",
    agm_package: "agm_package",
    results: "announce_result",
    candidate_elected: "tell_candidates",
    candidate_not_elected: "tell_candidates",
  };

  const { getElectionMessagesForSlug } = await import("@/lib/elections/messages");
  const messages = await getElectionMessagesForSlug(slug);

  // A stage can carry more than one message — "tell the candidates" is two,
  // and dropping either would hide the half somebody most needs to read.
  const stageMessages: Record<
    string,
    (typeof messages extends null ? never : NonNullable<typeof messages>)[number][]
  > = {};
  for (const m of messages ?? []) {
    const stageKey = MESSAGE_STAGES[m.key];
    if (stageKey) (stageMessages[stageKey] ??= []).push(m);
  }

  const { election, eligibility, nominations, validated, incomplete, representation, projected, daysUntilNominationsClose } =
    review;
  const callSentAt = (election.config as unknown as { callSentAt?: string }).callSentAt ?? null;

  // The meeting these directors are elected at. Notice, the package and the
  // proxy register live there now — see the note further down.
  const membersMeeting = await getMembersMeetingByDate(election.schedule.agmDate);
  const meetingLink = membersMeeting ? `/admin/members-meetings/${membersMeeting.id}` : null;
  const ballotConfig = election.config as unknown as {
    ballotsCirculatedAt?: string;
    ballotCirculationCount?: number;
  };
  const ballotsCirculatedAt = ballotConfig.ballotsCirculatedAt ?? null;
  const ballotCirculationCount = ballotConfig.ballotCirculationCount ?? 0;

  async function askToWithdraw(formData: FormData) {
    "use server";
    const r = await requestWithdrawalAction(String(formData.get("nominationId")));
    redirect(
      `/admin/elections/${slug}${r.ok ? "?withdrawalAsked=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  // Every one of these refuses for real reasons — an already-sent call, an
  // unpublished event page, an empty electorate. Discarding the Result made a
  // refusal indistinguishable from success: the POST returned 200, the page
  // re-rendered unchanged, and the only way to find out nothing had happened
  // was to read the database. Surface it the way `close` and `circulate` do.


  async function chaseCosigners() {
    "use server";
    const r = await chaseCosignaturesAction(slug);
    redirect(
      `/admin/elections/${slug}${r.ok ? "?cosignersChased=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  async function chase() {
    "use server";
    const r = await chaseIncompleteAction(slug);
    redirect(
      `/admin/elections/${slug}${r.ok ? "?chased=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  async function mintTasks() {
    "use server";
    const r = await mintElectionActionItemsAction(slug);
    redirect(
      `/admin/elections/${slug}${r.ok ? "?tasksMinted=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }







  async function saveReminders(formData: FormData) {
    "use server";
    const r = await saveReminderScheduleAction(slug, formData);
    redirect(
      `/admin/elections/${slug}${
        r.ok ? "?remindersSaved=1" : `?reminderError=${encodeURIComponent(r.error ?? "")}`
      }`
    );
  }

  async function close(formData: FormData) {
    "use server";
    const r = await closeNominationsAction(slug, formData);
    redirect(
      `/admin/elections/${slug}${r.ok ? "?closed=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  // Today in the association's timezone. A UTC "today" flips five hours early
  // and would let the close run the evening before the window shuts.
  const todayHere = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const closeReadiness = canCloseNominations(election.schedule, todayHere);
  const reminderPlan = planReminders(election.schedule, election.config, "ballot");
  // The nomination window had no reminder at all: the call refuses to send
  // twice and the chase only reaches nominations that already exist.
  const nominationReminderPlan = planReminders(
    election.schedule,
    election.config,
    "nominations"
  );
  // Only once certified — before that countElection refuses and there is no
  // "elected" to count, so asking earlier would be a query that always fails.
  // The service history behind the term-limit check, per nominee. Loaded here
  // rather than inside the row so the editor can render what is already on
  // record instead of only offering to add to it.
  const { listDirectorTerms } = await import("@/lib/elections/service");
  const termsByNomination = Object.fromEntries(
    await Promise.all(
      nominations.map(async (n) => [
        n.id,
        await listDirectorTerms(election.bodyId, n.nomineeProfileId, n.nomineeContactId),
      ])
    )
  ) as Record<string, Awaited<ReturnType<typeof listDirectorTerms>>>;

  // Unsigned, unrevoked requests on nominations that are still alive.
  const outstandingCosignatures = nominations
    .filter((n) => !n.withdrawnAt && !n.candidateDeclinedAt)
    .reduce((total, n) => total + (n.cosignatures.required - n.cosignatures.valid > 0
      ? n.cosignatures.required - n.cosignatures.valid
      : 0), 0);


  // Where the cycle is, so each section below can decide how much of the screen
  // it deserves. Status-driven: reading it from dates would move the screen on
  // at midnight on the closing date whether or not anybody had closed anything.
  const { cyclePhase, sectionState, phaseApplies } = await import("@/lib/elections/phases");
  const phase = cyclePhase(election, todayHere);
  const sect = (s: Parameters<typeof sectionState>[0]) => sectionState(s, phase);


  // How many institutions a "not yet voted" reminder would reach today. Only
  // computed while balloting: before then every eligible store is outstanding,
  // which is true but tells the admin nothing.
  const outstandingBallots =
    election.status === "balloting" ? await countOutstandingBallots(slug) : null;

  // What the close will actually do. `incomplete` counts only those who accepted
  // and are still missing something; the close also marks ineligible anyone who
  // never responded, so the honest figure is everything that is not complete.
  const willValidate = validated.length;
  const willExclude = nominations.length - validated.length;

  const closing =
    daysUntilNominationsClose > 0
      ? `${daysUntilNominationsClose} day${daysUntilNominationsClose === 1 ? "" : "s"} left`
      : daysUntilNominationsClose === 0
        ? "closes today"
        : "closed";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`${election.cycleYear} Board election`}
        description={`${election.seatsAvailable} seats · AGM ${formatDate(election.schedule.agmDate)} · nominations ${formatDate(election.schedule.nominationsOpenAt)} – ${formatDate(election.schedule.nominationsCloseAt)} (${closing})`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/elections/${slug}/proxies`}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Proxy register
            </Link>
            <Link
              href={`/admin/elections/${slug}/audit`}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Ballots &amp; audit
            </Link>
          </div>
        }
      />

      {closeError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {closeError}
        </div>
      )}
      {closed && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          Nominations are closed. The nominee list is frozen and the election has moved to{" "}
          {election.status === "balloting" ? "balloting" : "acclamation"}.
        </div>
      )}
      {cosignersChased && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          Signature requests re-sent, to every administrator at the institutions asked. Delivery
          tracking records nothing, so a signature arriving is the reliable signal.
        </div>
      )}

      {circulated && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          Ballot links are on their way. Delivery tracking is not recording anything yet, so
          treat this as &ldquo;attempted&rdquo; — ballots arriving is the reliable signal.
        </div>
      )}

      {/* ⛔ NO SPINE HERE. The ordered list of what remains — notice, the
          package, the agenda, nominations, ballots, the result — lives on the
          MEETING, because the meeting is the activity and this election is
          business at it. This screen briefly rendered its own copy from the
          same builder; one list in two places is still two places to look.
          This page is the committee's detail view: who has stood, who is
          validated, what the field looks like. Do not re-add a timeline. */}
      {meetingLink && (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Where this sits in the meeting
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Directors are elected at the {election.cycleYear} annual general meeting. What
            remains before it — notice, the proxy form, the agenda, the members&rsquo; package
            and these nomination and ballot steps — is one ordered list, on the meeting.
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <Link href={meetingLink} className="text-[#163D6D] hover:underline">
              What remains before the meeting →
            </Link>
            <Link href={`${meetingLink}/proxies`} className="text-[#163D6D] hover:underline">
              Proxy register →
            </Link>
          </div>
        </section>
      )}

      {/* The electorate, which during a renewal cycle is a moving number. */}
      <div className="grid gap-3 sm:grid-cols-4">
        {/* Denominator is CURRENT members, not every org ever in the program —
            "19 of 80" would read as a collapse when 28 of that 80 left years ago. */}
        <Stat
          label="Eligible to vote"
          value={`${eligibility.eligible} / ${eligibility.currentMembers}`}
          tone={eligibility.recoverableByRenewing > 0 ? "warn" : "good"}
          hint={
            eligibility.notCurrentMembers > 0
              ? `${eligibility.notCurrentMembers} former members not counted`
              : undefined
          }
        />
        <Stat
          label="One renewal away"
          value={eligibility.recoverableByRenewing}
          tone={eligibility.recoverableByRenewing > 0 ? "warn" : "good"}
          hint="Eligible the day they renew"
        />
        <Stat label="Validated nominees" value={validated.length} />
        <Stat
          label="Projected"
          value={projected.outcome === "balloted" ? "Ballot" : "Acclaimed"}
          tone={projected.outcome === "balloted" ? "neutral" : "good"}
        />
      </div>

      {eligibility.recoverableByRenewing > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{eligibility.recoverableByRenewing}</strong> member institutions have not completed
          their renewal and cannot nominate, co-sign, or vote until they do. They are not lapsed —
          each becomes eligible the day it pays. This number is re-checked every time this page loads.
        </div>
      )}


      {/* The election's obligations belong on the board's own list, assigned to
          whoever holds each office — not in anyone's private notes. */}
      <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">Board action items</h2>
        <p className="mt-1 text-xs text-gray-500">
          {ELECTION_TASKS.length} obligations across the cycle, each assigned to the officer who
          holds it and raised at the last board meeting before it is due. Safe to press again —
          it adds only what is missing.
        </p>
        <form action={mintTasks} className="mt-3">
          <button
            type="submit"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Create or refresh the election&apos;s action items
          </button>
        </form>
      </section>

      {/* Outbound mail. Both are buttons a person presses, not crons: the
          by-law fixes the earliest date, not the latest, and someone should be
          looking at the eligibility numbers when the call goes out. */}
      <PhaseSection
        state={sect("nominating")}
        title="Email"
        summary={
          callSentAt
            ? `Call sent ${formatDate(callSentAt)} · ${nominations.length} nomination${nominations.length === 1 ? "" : "s"} received`
            : "the call has not gone out"
        }
      >
        <h2 className="text-sm font-semibold text-gray-900">Email</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {/* ⛔ The SEND is not here. It is a stage of the meeting's spine, which
              is the one place an irreversible membership-wide send is offered
              and the only one with the confirmation armed. This panel had its
              own copy and it was the UNGUARDED one — it fired on a single
              press while the confirmation covered only the spine, which is how
              somebody presses the wrong one. What is left here are the chases,
              which are repeatable nudges rather than stages. */}
          {callSentAt ? (
            <p className="text-sm text-gray-600">
              Call for nominations sent {formatDate(callSentAt)}. It cannot be sent again — the
              membership receiving it twice reads as disorganisation.
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              The call for nominations has not gone out.{" "}
              {meetingLink ? (
                <Link href={meetingLink} className="text-[#163D6D] hover:underline">
                  Send it from the meeting&rsquo;s list of what remains →
                </Link>
              ) : (
                "It is sent from the meeting's list of what remains."
              )}
            </p>
          )}

          {/* The gap this closes: the chase below emails the NOMINEE about what
              they are missing. A missing signature is the one thing on that
              list the nominee cannot supply, and nothing had ever reached the
              institution holding it. */}
          {outstandingCosignatures > 0 && (
            <form action={chaseCosigners} className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Chase {outstandingCosignatures} outstanding signature
                {outstandingCosignatures === 1 ? "" : "s"}
              </button>
              <span className="text-xs text-gray-500">
                Goes to every administrator at the institutions asked, not to the nominees. Safe
                to repeat.
              </span>
            </form>
          )}

          {incomplete.length > 0 && (
            <form action={chase} className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Chase {incomplete.length} incomplete nomination
                {incomplete.length === 1 ? "" : "s"}
              </button>
              <span className="text-xs text-gray-500">Safe to repeat.</span>
            </form>
          )}

          {election.status === "balloting" && (
            <p className="text-sm text-gray-600">
              {ballotsCirculatedAt ? (
                <>
                  Ballot links last circulated {formatDate(ballotsCirculatedAt)}
                  {ballotCirculationCount > 1 && ` (${ballotCirculationCount} times)`}. A
                  reminder goes only to institutions with no ballot on file.{" "}
                </>
              ) : (
                <>Members have not been told that voting is open. </>
              )}
              {meetingLink && (
                <Link href={meetingLink} className="text-[#163D6D] hover:underline">
                  Send it from the meeting&rsquo;s list of what remains →
                </Link>
              )}
            </p>
          )}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Election mail is transactional, so it reaches members who have unsubscribed from
          marketing — being unable to receive your own nomination would be disenfranchisement by
          mailing-list preference. Note that delivery and open tracking is not currently recording
          anything, so treat &ldquo;sent&rdquo; as &ldquo;attempted&rdquo;; whether a nomination is
          progressing is the reliable signal.
        </p>
      </PhaseSection>

      <PhaseSection
        state={sect("nominating")}
        title="Nomination reminders"
        summary={
          nominationReminderPlan.steps.length === 0
            ? "none scheduled"
            : `${nominationReminderPlan.steps.length} steps · ${nominationReminderPlan.steps
                .map((st) => st.sendOn)
                .join(", ")}`
        }
      >
        <ReminderSchedulePanel
          plan={nominationReminderPlan}
          minimumGapDays={election.config.reminders.minimumGapDays}
          save={saveReminders}
          error={reminderError}
          saved={Boolean(remindersSaved)}
          outstandingCount={null}
        />
      </PhaseSection>

      {phaseApplies("balloting", election) ? (
        <PhaseSection
          state={sect("balloting")}
          title="Ballot reminders"
          summary={`${reminderPlan.steps.length} steps, counted back from ${election.schedule.ballotsCloseAt}`}
        >
          <ReminderSchedulePanel
            plan={reminderPlan}
            minimumGapDays={election.config.reminders.minimumGapDays}
            save={saveReminders}
            error={reminderError}
            saved={Boolean(remindersSaved)}
            outstandingCount={outstandingBallots}
          />
        </PhaseSection>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-3 text-sm text-gray-500">
          <span className="font-medium text-gray-600">Ballot reminders</span> — the slate is
          acclaimed, so no ballot is circulated and these never run.
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">As things stand</h2>
        <p className="mt-1 text-sm text-gray-600">{projected.reason}</p>
        {election.status === "draft" ? (
          <p className="mt-2 text-xs text-gray-500">
            Nominations have not opened yet — they run{" "}
            {formatDate(election.schedule.nominationsOpenAt)} to{" "}
            {formatDate(election.schedule.nominationsCloseAt)}. This is what the outcome would
            be if nobody stood.
          </p>
        ) : election.status === "nominating" ? (
          <p className="mt-2 text-xs text-gray-500">
            This is a projection from what would count today, not a decision. It settles when
            you close nominations below.
          </p>
        ) : (
          <p className="mt-2 text-xs text-gray-500">
            Nominations are closed — these figures are frozen.
          </p>
        )}

        {election.status === "nominating" &&
          (closeReadiness.ready ? (
            <form id="close-nominations" action={close} className="mt-4 border-t border-gray-200 pt-4 scroll-mt-24">
              <p className="text-sm font-medium text-gray-900">Close nominations</p>
              <p className="mt-1 text-sm text-gray-600">
                {willValidate} nominee{willValidate === 1 ? "" : "s"} will be frozen onto the
                ballot
                {willExclude > 0 && (
                  <>
                    {" "}
                    and {willExclude} incomplete nomination{willExclude === 1 ? "" : "s"} will be
                    marked ineligible
                  </>
                )}
                . {projected.reason}
              </p>
              {!closeReadiness.onTime && (
                <p className="mt-1 text-xs text-amber-700">
                  This is {closeReadiness.daysLate} day
                  {closeReadiness.daysLate === 1 ? "" : "s"} after the published close date of{" "}
                  {formatDate(election.schedule.nominationsCloseAt)}.
                </p>
              )}
              <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" name="confirm" value="1" className="mt-0.5" />
                <span>
                  I understand this cannot be undone from here — the nominee list is frozen and
                  the election moves to{" "}
                  {projected.outcome === "balloted" ? "balloting" : "acclamation"}.
                </span>
              </label>
              <button
                type="submit"
                className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Close nominations
              </button>
            </form>
          ) : (
            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-sm font-medium text-gray-900">
                Nominations cannot be closed yet
              </p>
              <p className="mt-1 text-sm text-gray-600">{closeReadiness.reason}</p>
            </div>
          ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* The biggest section on the page, and once the field is fixed every
            control in it is spent — the chases, the term editors, the search.
            It stays as the record of who stood and what they were missing. */}
        <PhaseSection
          state={sect("nominating")}
          title={`Nominees (${nominations.length})`}
          summary={
            validated.length > 0
              ? `${validated.length} validated · ${projected.outcome}`
              : `${incomplete.length} still incomplete`
          }
        >
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">
              Nominees ({nominations.length})
            </h2>
            {incomplete.length > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                {incomplete.length} accepted but still missing something — these are the ones to
                chase before {formatDate(election.schedule.nominationsCloseAt)}.
              </p>
            )}
          </div>

          {nominations.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-500">
              No nominations yet. The call goes out{" "}
              {formatDate(election.schedule.nominationsOpenAt)}.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {nominations.map((n) => (
                <li key={n.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{n.nomineeName}</p>
                      <p className="text-sm text-gray-600">{n.organizationName}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {n.source === "nominating_committee" ? "Committee slate" : "Member nomination"}
                        {" · "}
                        {n.cosignatures.required > 0
                          ? `${n.cosignatures.valid}/${n.cosignatures.required} signatures`
                          : "no signatures required"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        n.completeness.complete
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {n.completeness.complete ? "Ready" : "Incomplete"}
                    </span>
                  </div>

                  {!n.completeness.complete && (
                    <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-gray-600">
                      {n.completeness.missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  )}

                  {/* The one item on that list nobody could act on. The term
                      limit refuses to guess from missing history, which is
                      right, and until now it left a flag with nothing to
                      press. */}
                  <DirectorTermsEditor
                    bodyId={election.bodyId}
                    personContactId={n.nomineeContactId}
                    personProfileId={n.nomineeProfileId}
                    organizationId={n.nomineeOrganizationId}
                    personName={n.nomineeName}
                    terms={termsByNomination[n.id] ?? []}
                    revalidate={`/admin/elections/${slug}`}
                  />

                  {/* Permitted, and on the record for the same reason directors
                      co-signing is: most eligible institutions have a single
                      administrator, so a nominee granting their own store's
                      permission is ordinary rather than suspicious. The
                      committee should still be able to see which it was. */}
                  {n.storePermissionSelfGranted && (
                    <p className="mt-2 text-xs text-gray-500">
                      Permission to serve was granted by the nominee, who administers{" "}
                      {n.organizationName}.
                    </p>
                  )}

                  {/* Directors co-signing is permitted — every CSC director is
                      also an org admin — but it belongs on the record. */}
                  {n.cosignatures.signedByDirectors.length > 0 && (
                    <p className="mt-2 text-xs text-gray-500">
                      {n.cosignatures.signedByDirectors.length} signature
                      {n.cosignatures.signedByDirectors.length === 1 ? "" : "s"} from sitting
                      directors.
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-3">
                    {/* The ask appears on the nominee's own page — requestWithdrawal
                        stamps the nomination and the accept page then reads "the
                        nominating committee has asked whether you would consider
                        withdrawing". What it does NOT do is deliver it: there is no
                        withdrawal email template, so the nominee sees the question
                        only if they happen to reopen their link. The old label,
                        "Ask if they would withdraw", let the committee believe
                        somebody had been told. Say where the ask actually lands. */}
                    {n.withdrawalRequestedAt ? (
                      <span className="text-xs text-gray-500">
                        Asked on their page {formatDate(n.withdrawalRequestedAt)} — awaiting the
                        nominee&apos;s decision. No message was sent; follow up directly.
                      </span>
                    ) : (
                      <form action={askToWithdraw}>
                        <input type="hidden" name="nominationId" value={n.id} />
                        <button
                          type="submit"
                          title="Puts the question on the nominee's own nomination page. It sends no email — tell them yourself as well."
                          className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Ask on their nomination page
                        </button>
                      </form>
                    )}
                    {/* ?preview=1 — without it this lands on "this nomination
                        belongs to someone else", because the committee is
                        neither the nominee nor an administrator of their
                        institution. Read-only: see lib/elections/preview.ts. */}
                    <Link
                      href={`/elections/accept/${n.acceptToken}?preview=1`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-gray-500 underline hover:text-gray-700"
                      title="Their page, with their real progress. You cannot change anything from it."
                    >
                      See where they are
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        </PhaseSection>

        <PhaseSection
          state={sect("nominating")}
          title="Representation"
          summary={`${representation.nomineeCount} from ${representation.nomineeOrgCount} of ${representation.eligibleOrgCount} institutions`}
        >
          <RepresentationPanel snapshot={representation} />
        </PhaseSection>
      </div>
    </div>
  );
}
