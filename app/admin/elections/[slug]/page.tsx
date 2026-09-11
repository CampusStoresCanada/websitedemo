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
import AgmNoticePanel from "@/components/admin/elections/AgmNoticePanel";
import ReminderSchedulePanel from "@/components/admin/elections/ReminderSchedulePanel";
import AgmPackagePanel from "@/components/admin/elections/AgmPackagePanel";
import ElectionTimeline from "@/components/admin/elections/ElectionTimeline";
import ConfirmSendButton from "@/components/admin/elections/ConfirmSendButton";
import {
  getCommitteeReview,
  getNoticeState,
  countOutstandingBallots,
  getAgmPackageState,
  getElectionTimeline,
} from "@/lib/elections/service";
import {
  requestWithdrawalAction,
  sendCallForNominationsAction,
  sendAgmNoticeAction,
  sendProxyFormAction,
  chaseIncompleteAction,
  mintElectionActionItemsAction,
  closeNominationsAction,
  circulateBallotsAction,
  saveReminderScheduleAction,
  uploadFinancialStatementsAction,
  sendAgmPackageAction,
  generateAgmAgendaAction,
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
    packageError?: string;
    uploaded?: string;
    packageSent?: string;
    agendaGenerated?: string;
  }>;
}) {
  const { slug } = await params;
  const {
    error: closeError,
    closed,
    circulated,
    reminderError,
    remindersSaved,
    packageError,
    uploaded,
    packageSent,
    agendaGenerated,
  } = await searchParams;
  const review = await getCommitteeReview(slug);
  if (!review) notFound();
  const noticeState = await getNoticeState(slug);

  // Loaded after the review, which is what persists the eligibility rows this
  // reads — see getElectionMessagesForSlug.
  const MESSAGE_STAGES: Record<string, string> = {
    call: "call_for_nominations",
    ballots_open: "circulate_ballots",
    ballot_reminder: "ballots_close",
    agm_notice: "agm_notice",
    proxy_form: "proxy_form",
    agm_package: "agm_package",
    results: "announce_result",
  };

  const { getElectionMessagesForSlug } = await import("@/lib/elections/messages");
  const { getServerAuthState } = await import("@/lib/auth/server");
  const [messages, auth] = await Promise.all([
    getElectionMessagesForSlug(slug),
    getServerAuthState(),
  ]);

  const stageMessages: Record<string, (typeof messages extends null ? never : NonNullable<typeof messages>)[number]> = {};
  for (const m of messages ?? []) {
    const stageKey = MESSAGE_STAGES[m.key];
    if (stageKey) stageMessages[stageKey] = m;
  }

  const { election, eligibility, nominations, validated, incomplete, representation, projected, daysUntilNominationsClose } =
    review;
  const callSentAt = (election.config as unknown as { callSentAt?: string }).callSentAt ?? null;
  const ballotConfig = election.config as unknown as {
    ballotsCirculatedAt?: string;
    ballotCirculationCount?: number;
  };
  const ballotsCirculatedAt = ballotConfig.ballotsCirculatedAt ?? null;
  const ballotCirculationCount = ballotConfig.ballotCirculationCount ?? 0;
  const packageConfig = election.config as unknown as {
    agmPackageSentAt?: string;
    agmPackageSendCount?: number;
  };
  const agmPackageSentAt = packageConfig.agmPackageSentAt ?? null;
  const agmPackageSendCount = packageConfig.agmPackageSendCount ?? 0;

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
  async function sendCall() {
    "use server";
    const r = await sendCallForNominationsAction(slug);
    redirect(
      `/admin/elections/${slug}${r.ok ? "?callSent=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
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

  async function sendNotice(formData: FormData) {
    "use server";
    const r = await sendAgmNoticeAction(slug, formData);
    redirect(
      `/admin/elections/${slug}${r.ok ? "?noticeSent=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  async function sendProxy() {
    "use server";
    const r = await sendProxyFormAction(slug);
    redirect(
      `/admin/elections/${slug}${r.ok ? "?proxySent=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  async function circulate() {
    "use server";
    const r = await circulateBallotsAction(slug);
    redirect(
      `/admin/elections/${slug}${r.ok ? "?circulated=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  async function uploadFinancials(formData: FormData) {
    "use server";
    const r = await uploadFinancialStatementsAction(slug, formData);
    redirect(
      `/admin/elections/${slug}${
        r.ok ? "?uploaded=1" : `?packageError=${encodeURIComponent(r.error ?? "")}`
      }`
    );
  }

  async function generateAgenda(formData: FormData) {
    "use server";
    const r = await generateAgmAgendaAction(slug, formData);
    redirect(
      `/admin/elections/${slug}${
        r.ok ? "?agendaGenerated=1" : `?packageError=${encodeURIComponent(r.error ?? "")}`
      }`
    );
  }

  async function sendPackage(formData: FormData) {
    "use server";
    const r = await sendAgmPackageAction(slug, formData);
    redirect(
      `/admin/elections/${slug}${
        r.ok ? "?packageSent=1" : `?packageError=${encodeURIComponent(r.error ?? "")}`
      }`
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
  const reminderPlan = planReminders(election.schedule, election.config);
  const agmPackage = await getAgmPackageState(slug);
  const timeline = await getElectionTimeline(slug);

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
      {circulated && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          Ballot links are on their way. Delivery tracking is not recording anything yet, so
          treat this as &ldquo;attempted&rdquo; — ballots arriving is the reliable signal.
        </div>
      )}

      {timeline && (
        <ElectionTimeline
          stages={timeline}
          testEmail={auth.user?.email ?? null}
          // Keyed by STAGE, so each step carries the message it sends. The
          // reminder hangs off "ballots close" because that is the step it
          // belongs to in the cycle, even though it reuses the ballot template.
          stageMessages={stageMessages}
          // The member-facing page each step points at. Opened with ?preview=1,
          // which an admin sees as an eligible member would — and which is
          // display-only: every write path re-checks the actor independently.
          stagePages={{
            call_for_nominations: [
              { href: `/elections/${slug}/nominate`, label: "nomination form" },
              // Token-scoped, so there is no URL until a nomination exists.
              // These render against a clearly-labelled stand-in.
              { href: `/elections/accept/preview?slug=${slug}`, label: "nominee's page" },
              { href: `/elections/cosign/preview?slug=${slug}`, label: "co-signer's page" },
            ],
            circulate_ballots: [{ href: `/elections/${slug}/ballot`, label: "ballot" }],
            ballots_close: [{ href: `/elections/${slug}/ballot`, label: "ballot" }],
            proxy_form: [{ href: `/elections/${slug}/proxy`, label: "proxy form" }],
            agm_package: [{ href: `/elections/${slug}/package`, label: "AGM package" }],
          }}
          // ⚠️ RESTORED. This prop was deleted by accident while wiring the
          // per-step messages, which silently disarmed the confirmation on
          // every membership-wide send — the guard added after the call went
          // out to 39 stores by one press. An action missing from this map
          // gets a plain button, so losing an entry loses the protection
          // without breaking anything visible.
          sendCounts={{
            sendCall: {
              recipients: messages?.find((m) => m.key === "call")?.recipientCount ?? null,
              audience: "member administrators and staff",
            },
            circulateBallots: {
              recipients: messages?.find((m) => m.key === "ballots_open")?.recipientCount ?? null,
              audience: "member administrators",
            },
            sendAgmNotice: {
              recipients: messages?.find((m) => m.key === "agm_notice")?.recipientCount ?? null,
              audience: "member administrators",
            },
            sendProxyForm: {
              recipients: messages?.find((m) => m.key === "proxy_form")?.recipientCount ?? null,
              audience: "member administrators",
            },
            sendAgmPackage: {
              recipients: messages?.find((m) => m.key === "agm_package")?.recipientCount ?? null,
              audience: "member administrators",
            },
          }}
          actions={{
            sendCall,
            // Not `close` — that form needs its confirmation ticked, so the
            // timeline sends you to it rather than posting an empty one.
            closeNominations: "close-nominations",
            circulateBallots: circulate,
            sendAgmNotice: "agm-notice",
            sendProxyForm: sendProxy,
            sendAgmPackage: "agm-package",
          }}
        />
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

      {noticeState && (
        <div id="agm-notice" className="scroll-mt-24">
          <AgmNoticePanel state={noticeState} sendNotice={sendNotice} sendProxy={sendProxy} />
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
      <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">Email</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {callSentAt ? (
            <p className="text-sm text-gray-600">
              Call for nominations sent {formatDate(callSentAt)}. It cannot be sent again — the
              membership receiving it twice reads as disorganisation.
            </p>
          ) : (
            // The same send as the timeline's, and it was the UNGUARDED one —
            // the confirmation only ever covered the timeline, so this panel
            // still fired on a single press. Two buttons for one irreversible
            // act is bad enough; one armed and the other not is how somebody
            // presses the wrong one.
            <div className="flex items-center gap-3">
              <ConfirmSendButton
                action={sendCall}
                label="Send the call for nominations"
                recipients={messages?.find((m) => m.key === "call")?.recipientCount ?? null}
                audience="member administrators and staff"
              />
              <span className="text-xs text-gray-500">
                Emails every administrator at the {eligibility.eligible} currently eligible
                institutions. Sends once.
              </span>
            </div>
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
            <div className="flex flex-wrap items-center gap-3">
              <ConfirmSendButton
                action={circulate}
                label={ballotsCirculatedAt ? "Remind those who have not voted" : "Tell members voting is open"}
                recipients={messages?.find((m) => m.key === "ballots_open")?.recipientCount ?? null}
                audience="member administrators"
              />
              <span className="text-xs text-gray-500">
                {ballotsCirculatedAt ? (
                  <>
                    Last circulated {formatDate(ballotsCirculatedAt)}
                    {ballotCirculationCount > 1 && ` (${ballotCirculationCount} times)`}. A
                    reminder goes only to institutions with no ballot on file — nobody who has
                    already voted is contacted again.
                  </>
                ) : (
                  <>
                    Emails every administrator at each eligible institution with a link to the
                    ballot. The ballot itself is never in the email.
                  </>
                )}
              </span>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Election mail is transactional, so it reaches members who have unsubscribed from
          marketing — being unable to receive your own nomination would be disenfranchisement by
          mailing-list preference. Note that delivery and open tracking is not currently recording
          anything, so treat &ldquo;sent&rdquo; as &ldquo;attempted&rdquo;; whether a nomination is
          progressing is the reliable signal.
        </p>
      </section>

      {agmPackage && (
        <div id="agm-package" className="scroll-mt-24">
        <AgmPackagePanel
          items={agmPackage.items}
          outstanding={agmPackage.outstanding}
          complete={agmPackage.complete}
          summary={agmPackage.summary}
          hasMeeting={agmPackage.meetingId !== null}
          financialsSupplied={agmPackage.financialDocumentId !== null}
          upload={uploadFinancials}
          generateAgenda={generateAgenda}
          agendaSupplied={
            agmPackage.items.find((i) => i.key === "agenda")?.state === "supplied"
          }
          send={sendPackage}
          sentAt={agmPackageSentAt ? formatDate(agmPackageSentAt) : null}
          recipientCount={messages?.find((m) => m.key === "agm_package")?.recipientCount ?? null}
          sendCount={agmPackageSendCount}
          error={packageError}
          uploaded={Boolean(uploaded)}
          sent={Boolean(packageSent)}
          agendaGenerated={Boolean(agendaGenerated)}
        />
        </div>
      )}

      <ReminderSchedulePanel
        plan={reminderPlan}
        minimumGapDays={election.config.reminders.minimumGapDays}
        save={saveReminders}
        error={reminderError}
        saved={Boolean(remindersSaved)}
        outstandingCount={outstandingBallots}
      />

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
                    <Link
                      href={`/elections/accept/${n.acceptToken}`}
                      className="text-xs text-gray-500 underline hover:text-gray-700"
                    >
                      View their page
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <RepresentationPanel snapshot={representation} />
      </div>
    </div>
  );
}
