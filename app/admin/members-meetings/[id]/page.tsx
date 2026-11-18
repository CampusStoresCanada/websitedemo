/**
 * /admin/members-meetings/[id] — everything about one meeting of the members.
 *
 * ⛔ This is the ONE spot, which is the whole reason the section exists. It was
 * briefly a shell that linked out to three other screens while the AGM's actual
 * controls stayed in Elections; that was the opposite of the ask. Notice, the
 * members' package and the agenda press now live here, and the event page is
 * edited here too, embedded rather than linked.
 *
 * What is NOT here, deliberately:
 *
 *  - The generators. `sendAgmNotice`, `getAgmPackageState` and
 *    `generateAgmAgenda` stay in `lib/elections/` and are called from here.
 *    Moving a control is not moving a system, and copying one would be worse.
 *  - The event form. `EventForm` is the one form this codebase has for an
 *    event; it is embedded below, with its own Google Places address lookup and
 *    its own slug pinning. Nothing here re-implements an event field.
 *  - The agenda and minutes EDITORS, which belong to the meeting record's own
 *    screen. The row is the same row; a second editor for one agenda would be
 *    two surfaces for one verb.
 *
 * Notice and the package are election-shaped today because their state is keyed
 * by election slug. A special members' meeting with no election therefore shows
 * neither, and says so, rather than growing a second notice path.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { getMembersMeeting } from "@/lib/governance/members-meetings-service";
import {
  MEMBERS_MEETING_LABELS,
  VENUE_LABELS,
  isMembersMeetingType,
  membersMeetingGaps,
  venueOf,
} from "@/lib/governance/members-meetings";
import MeetingDateForm from "@/components/admin/members-meetings/MeetingDateControls";
import EventFormClient from "@/components/admin/events/EventFormClient";
import AgmNoticePanel from "@/components/admin/elections/AgmNoticePanel";
import AgmPackagePanel from "@/components/admin/elections/AgmPackagePanel";
import ElectionTimeline from "@/components/admin/elections/ElectionTimeline";
import LocalDate from "@/components/ui/LocalDate";
import { getEvent } from "@/lib/actions/events";
import {
  getNoticeState,
  getAgmPackageState,
  getElection,
  getMeetingSpine,
  getCandidateOutcomes,
} from "@/lib/elections/service";
import { asOfDate, disableActions } from "@/lib/elections/preview";
import { publishMembersMeetingEventAction } from "@/lib/actions/members-meetings";
import {
  sendCallForNominationsAction,
  circulateBallotsAction,
  notifyCandidatesAction,
  sendAgmNoticeAction,
  sendProxyFormAction,
  uploadFinancialStatementsAction,
  sendAgmPackageAction,
  generateAgmAgendaAction,
} from "@/lib/actions/elections";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 py-2 last:border-0">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  );
}

export default async function MembersMeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    noticeSent?: string;
    published?: string;
    asOf?: string;
    proxySent?: string;
    packageError?: string;
    uploaded?: string;
    packageSent?: string;
    agendaGenerated?: string;
  }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-5 py-8 text-sm text-gray-500">
        You do not have access to this page.
      </p>
    );
  }

  const { id } = await params;
  const {
    error: pageError,
    noticeSent,
    published,
    asOf: asOfParam,
    proxySent,
    packageError,
    uploaded,
    packageSent,
    agendaGenerated,
  } = await searchParams;

  const meeting = await getMembersMeeting(id);
  if (!meeting) notFound();

  const label = isMembersMeetingType(meeting.meetingType)
    ? MEMBERS_MEETING_LABELS[meeting.meetingType]
    : meeting.meetingType;
  const gaps = membersMeetingGaps(meeting);
  const venue = meeting.event ? venueOf(meeting.event) : null;
  const electionSlug = meeting.election?.slug ?? null;

  // The full event row, for the form. The projection the meeting reader returns
  // is for display; EventForm edits the real thing.
  const eventResult = meeting.event ? await getEvent(meeting.event.id) : null;
  const fullEvent = eventResult?.success ? eventResult.data : null;

  // Notice and the package are keyed by election slug — see the file note.
  // Looking ahead without being able to act ahead — actions are stripped by
  // `disableActions` before the spine is rendered.
  const asOf = asOfDate({ asOf: asOfParam });

  // ⛔ The spine is keyed by the MEETING, not the election: a members' meeting
  // with no election still has an event page, a notice window, a proxy
  // deadline, an agenda and a package.
  const rawSpine = await getMeetingSpine(id, asOf ?? undefined);
  const spine = asOf ? disableActions(rawSpine ?? []) : rawSpine;

  const [noticeState, agmPackage, election] = electionSlug
    ? await Promise.all([
        getNoticeState(electionSlug),
        getAgmPackageState(electionSlug),
        getElection(electionSlug),
      ])
    : [null, null, null];

  // What each step sends, and how many people it would reach. ⚠️ The counts are
  // what arms the confirmation on a membership-wide send; see `sendCounts`.
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
  const { getServerAuthState } = await import("@/lib/auth/server");
  const [messages, authState] = await Promise.all([
    electionSlug ? getElectionMessagesForSlug(electionSlug) : Promise.resolve(null),
    getServerAuthState(),
  ]);
  const stageMessages: Record<string, NonNullable<typeof messages>[number][]> = {};
  for (const m of messages ?? []) {
    const stageKey = MESSAGE_STAGES[m.key];
    if (stageKey) (stageMessages[stageKey] ??= []).push(m);
  }
  const recipients = (key: string) =>
    messages?.find((m) => m.key === key)?.recipientCount ?? null;

  const candidateOutcomes =
    electionSlug && election?.status === "certified"
      ? await getCandidateOutcomes(electionSlug)
      : null;
  const candidateCount = candidateOutcomes
    ? candidateOutcomes.elected.length + candidateOutcomes.notElected.length
    : null;

  const packageConfig = (election?.config ?? {}) as {
    agmPackageSentAt?: string;
    agmPackageSendCount?: number;
  };
  const agmPackageSentAt = packageConfig.agmPackageSentAt ?? null;
  const agmPackageSendCount = packageConfig.agmPackageSendCount ?? 0;

  const back = `/admin/members-meetings/${id}`;
  const electionHref = electionSlug ? `/admin/elections/${electionSlug}` : undefined;

  async function sendCall() {
    "use server";
    if (!electionSlug) return;
    const r = await sendCallForNominationsAction(electionSlug);
    redirect(`${back}${r.ok ? "?callSent=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`);
  }

  async function circulate() {
    "use server";
    if (!electionSlug) return;
    const r = await circulateBallotsAction(electionSlug);
    redirect(`${back}${r.ok ? "?circulated=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`);
  }

  async function tellCandidates() {
    "use server";
    if (!electionSlug) return;
    const r = await notifyCandidatesAction(electionSlug);
    redirect(`${back}${r.ok ? "?candidatesTold=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`);
  }

  async function publishEvent() {
    "use server";
    const r = await publishMembersMeetingEventAction(id);
    redirect(`${back}${r.ok ? "?published=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`);
  }

  async function sendNotice(formData: FormData) {
    "use server";
    if (!electionSlug) return;
    const r = await sendAgmNoticeAction(electionSlug, formData);
    redirect(
      `${back}${r.ok ? "?noticeSent=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`,
    );
  }

  async function sendProxy() {
    "use server";
    if (!electionSlug) return;
    const r = await sendProxyFormAction(electionSlug);
    redirect(
      `${back}${r.ok ? "?proxySent=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`,
    );
  }

  async function uploadFinancials(formData: FormData) {
    "use server";
    if (!electionSlug) return;
    const r = await uploadFinancialStatementsAction(electionSlug, formData);
    redirect(
      `${back}${r.ok ? "?uploaded=1" : `?packageError=${encodeURIComponent(r.error ?? "")}`}`,
    );
  }

  async function generateAgenda(formData: FormData) {
    "use server";
    if (!electionSlug) return;
    const r = await generateAgmAgendaAction(electionSlug, formData);
    redirect(
      `${back}${r.ok ? "?agendaGenerated=1" : `?packageError=${encodeURIComponent(r.error ?? "")}`}`,
    );
  }

  async function sendPackage(formData: FormData) {
    "use server";
    if (!electionSlug) return;
    const r = await sendAgmPackageAction(electionSlug, formData);
    redirect(
      `${back}${r.ok ? "?packageSent=1" : `?packageError=${encodeURIComponent(r.error ?? "")}`}`,
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={label}
        description={formatDate(meeting.meetingDate)}
        actions={
          <Link
            href="/admin/members-meetings"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Members&apos; Meetings
          </Link>
        }
      />

      {pageError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </p>
      )}
      {noticeSent && (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Notice of the meeting has been given.
        </p>
      )}
      {published && (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          The event page is published. Members can see the meeting, and notice can be given.
        </p>
      )}
      {proxySent && (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          The proxy form has been sent.
        </p>
      )}

      {/* ── One spine, in the order things happen ─────────────────────────
          ⛔ THE spine, and the only one. The meeting and its election are one
          activity: publishing the page, giving notice, the proxy form, the
          agenda, the package, nominations, ballots and the result are stages of
          a single ordered list, and it lives HERE because the meeting is the
          thing — the election is business at it. The election screen linked
          from each of its steps is a detail view, not a second spine. It had
          one briefly, rendered from the same builder; two copies of one list is
          still two places to look.

          Keyed by the MEETING (`getMeetingSpine`), so a members' meeting with
          no election still gets its own stages.

          The event-page gaps that were once their own amber box are the DETAIL
          of the publish stage. Do not put them back beside this. */}
      {spine && spine.length > 0 && (
        <>
          {/* Look ahead without being able to act ahead: `disableActions`
              strips every action before this renders, so a date past a deadline
              shows what unlocks without offering it. */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="font-medium text-slate-700">See this meeting as of</span>
                <input
                  type="date"
                  name="asOf"
                  defaultValue={asOf ?? ""}
                  className="rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <button
                type="submit"
                className="rounded bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700"
              >
                View that day
              </button>
              {asOf && (
                <Link href={back} className="text-slate-600 underline">
                  Back to today
                </Link>
              )}
              <span className="ml-auto flex flex-wrap gap-3 text-xs text-slate-500">
                {noticeState && (
                  <Link href={`?asOf=${noticeState.window.opensOn}`} className="underline">
                    notice opens
                  </Link>
                )}
                <Link href={`?asOf=${meeting.meetingDate}`} className="underline">
                  the meeting
                </Link>
              </span>
            </form>
          </div>

          {asOf && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Showing {asOf}, not today.</strong> The calendar has moved and nothing
              else — every stage still reflects what has actually happened, and no action can
              be taken from this view. Dates the by-law fixes cannot be brought forward:
              notice sent early is as defective as notice sent late.
            </div>
          )}

          <ElectionTimeline
            stages={spine}
            title="What remains before this meeting"
            subtitle="In the order it happens. Every date is measured back from the day the meeting sits."
            testEmail={authState.user?.email ?? null}
            stageMessages={stageMessages}
            // The member-facing page each step points at, opened with
            // ?preview=1 — display-only; every write path re-checks the actor.
            stagePages={
              electionSlug
                ? {
                    call_for_nominations: [
                      { href: `/elections/${electionSlug}/nominate`, label: "nomination form" },
                      {
                        href: `/elections/accept/preview?slug=${electionSlug}`,
                        label: "nominee's page",
                      },
                      {
                        href: `/elections/cosign/preview?slug=${electionSlug}`,
                        label: "co-signer's page",
                      },
                    ],
                    circulate_ballots: [
                      { href: `/elections/${electionSlug}/ballot`, label: "ballot" },
                    ],
                    ballots_close: [{ href: `/elections/${electionSlug}/ballot`, label: "ballot" }],
                    proxy_form: [{ href: `/elections/${electionSlug}/proxy`, label: "proxy form" }],
                    agm_package: [
                      { href: `/elections/${electionSlug}/package`, label: "AGM package" },
                    ],
                  }
                : {}
            }
            // ⚠️ LOAD-BEARING. This map is what arms the confirmation on every
            // membership-wide send. It was once deleted by accident while
            // wiring the per-step messages, which silently disarmed the guard
            // added after the call for nominations went out to 39 stores on one
            // press. An action missing from here gets a plain button, so losing
            // an entry loses the protection without breaking anything visible.
            sendCounts={{
              sendCall: {
                recipients: recipients("call"),
                audience: "member administrators and staff",
              },
              circulateBallots: {
                recipients: recipients("ballots_open"),
                audience: "member administrators",
              },
              sendAgmNotice: {
                recipients: recipients("agm_notice"),
                audience: "member administrators",
              },
              sendProxyForm: {
                recipients: recipients("proxy_form"),
                audience: "member administrators",
              },
              sendAgmPackage: {
                recipients: recipients("agm_package"),
                audience: "member administrators",
              },
              // Counted from the result itself, not the electorate: these go to
              // the people who stood, and a wrong number would be obvious to
              // whoever presses it.
              notifyCandidates: {
                recipients: candidateCount,
                audience: "candidates, elected and not",
              },
            }}
            actions={{
              // The meeting's own, run from here.
              publishEvent,
              sendCall,
              circulateBallots: circulate,
              notifyCandidates: tellCandidates,
              // Panels on this page — a string that is not a path is the id of
              // the panel below that owns the real form. ⛔ Notice needs the
              // meeting's time typed in, and the proxy form shares that panel
              // (it can go WITH the notice or on its own), so both point at it
              // rather than offering a second press for the same act.
              sendAgmNotice: "agm-notice",
              sendProxyForm: "agm-notice",
              generateAgenda: "agm-package",
              sendAgmPackage: "agm-package",
              // Forms that live on the election screen: closing nominations
              // needs its confirmation ticked, and certifying is its own audit.
              closeNominations: electionHref
                ? `${electionHref}#close-nominations`
                : undefined,
              sealElection: electionHref,
              certifyElection: electionSlug
                ? `/admin/elections/${electionSlug}/audit`
                : undefined,
              announceResults: electionHref,
            }}
          />
        </>
      )}

      {spine && spine.length === 0 && gaps.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <h2 className="text-sm font-semibold text-amber-900">Still outstanding</h2>
          <ul className="mt-2 space-y-1">
            {gaps.map((g) => (
              <li key={g} className="text-sm text-amber-800">
                • {g}
              </li>
            ))}
          </ul>
        </section>
      )}

      <MeetingDateForm
        meetingId={meeting.id}
        meetingDate={meeting.meetingDate}
        electionLabel={
          meeting.election ? `${meeting.election.cycleYear} election` : null
        }
      />

      {/* ── The event page members see, edited in place ───────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">
            The event page members see
          </h2>
          {meeting.event && (
            <span className="text-xs text-gray-500">
              {meeting.event.status === "published" ? (
                <Link
                  href={`/events/${meeting.event.slug}`}
                  className="text-[#163D6D] hover:underline"
                >
                  /events/{meeting.event.slug}
                </Link>
              ) : (
                <>
                  /events/{meeting.event.slug} ({meeting.event.status})
                </>
              )}
            </span>
          )}
        </div>

        {meeting.event ? (
          <>
            <dl className="mt-3">
              {/* ⚠️ LocalDate, not a hand-rolled format. This is a server
                  component, and `toLocaleTimeString` with no `timeZone` renders
                  in whatever zone the PROCESS is in — UTC on Vercel. A
                  noon-Eastern meeting printed as "5:00 p.m." Only a client
                  render knows the reader's zone. */}
              <Row label="Time">
                {meeting.event.startsAt ? (
                  <>
                    <LocalDate
                      iso={meeting.event.startsAt}
                      format="time-only"
                    />
                    {meeting.event.endsAt && (
                      <>
                        {" – "}
                        <LocalDate
                          iso={meeting.event.endsAt}
                          format="time-only"
                        />
                      </>
                    )}
                  </>
                ) : (
                  "not set"
                )}
              </Row>
              <Row label="Attended">{venue ? VENUE_LABELS[venue] : "—"}</Row>
              <Row label="Audience">
                {meeting.event.audienceMode === "members"
                  ? "Member institutions"
                  : (meeting.event.audienceMode ?? "—")}
              </Row>
            </dl>


            <details className="mt-4 border-t border-gray-100 pt-3">
              <summary className="cursor-pointer text-sm font-medium text-[#163D6D]">
                Edit the time, the place and the page copy
              </summary>
              <p className="mt-2 text-xs text-gray-500">
                The same form as the Events section. The day cannot be changed
                here — it is set above, because the election schedule is
                measured from it.
              </p>
              <div className="mt-3">
                {fullEvent ? (
                  <EventFormClient
                    event={fullEvent}
                    isEdit
                    googleMapsApiKey={
                      process.env.GOOGLE_MAPS_API_KEY ??
                      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
                      null
                    }
                  />
                ) : (
                  <p className="text-sm text-gray-500">
                    The event page could not be loaded.
                  </p>
                )}
              </div>
            </details>
          </>
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            No event page yet. Saving the date above creates one as a draft.
          </p>
        )}
      </section>

      {/* ── Notice, moved out of Elections ────────────────────────────────── */}
      {noticeState ? (
        /* The panel carries its own heading and its own window display — a
           wrapper title here would just say the same thing twice. */
        <div id="agm-notice" className="scroll-mt-24">
          <AgmNoticePanel
            state={noticeState}
            sendNotice={sendNotice}
            sendProxy={sendProxy}
          />
        </div>
      ) : (
        <section className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Notice of the meeting
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Notice is prepared once an election is opened for this meeting — the
            21 to 35 day window under Part VII S4(b) is measured back from the
            day it sits.
          </p>
          <Link
            href="/admin/elections"
            className="mt-3 inline-block text-xs text-[#163D6D] hover:underline"
          >
            Open a cycle →
          </Link>
        </section>
      )}

      {/* ── The members' package and the agenda press, moved out of Elections ── */}
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
              agmPackage.items.find((i) => i.key === "agenda")?.state ===
              "supplied"
            }
            send={sendPackage}
            sentAt={agmPackageSentAt ? formatDate(agmPackageSentAt) : null}
            recipientCount={null}
            sendCount={agmPackageSendCount}
            error={packageError}
            uploaded={Boolean(uploaded)}
            sent={Boolean(packageSent)}
            agendaGenerated={Boolean(agendaGenerated)}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Representation ─────────────────────────────────────────────── */}
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Who is carrying whose vote
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            By-Law Part VII S7. Quorum is 33% of voting members present in
            person or by proxy.
          </p>
          <dl className="mt-3">
            <Row label="Proxies standing">{meeting.proxyCount}</Row>
          </dl>
          <Link
            href={`/admin/members-meetings/${meeting.id}/proxies`}
            className="mt-3 inline-block text-xs text-[#163D6D] hover:underline"
          >
            The proxy register →
          </Link>
        </section>

        {/* ── The election, which is business ON the agenda ──────────────── */}
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">The election</h2>
          {meeting.election ? (
            <>
              <p className="mt-1 text-xs text-gray-500">
                One item of business at this meeting: directors are elected at
                it.
              </p>
              <dl className="mt-3">
                <Row label="Cycle">{meeting.election.cycleYear}</Row>
                <Row label="Status">
                  {meeting.election.status.replace(/_/g, " ")}
                </Row>
                <Row label="Seats up">
                  {meeting.election.seatsAvailable ?? "—"}
                </Row>
              </dl>
              <Link
                href={`/admin/elections/${meeting.election.slug}`}
                className="mt-3 inline-block text-xs text-[#163D6D] hover:underline"
              >
                Nominations, ballot and results →
              </Link>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-gray-600">
                No election has been opened for this meeting.
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Open it from Elections and it binds to this date — the
                nomination, ballot and notice windows are all measured back from
                the day the meeting sits.
              </p>
              <Link
                href="/admin/elections"
                className="mt-3 inline-block text-xs text-[#163D6D] hover:underline"
              >
                Open a cycle →
              </Link>
            </>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">
          The meeting record
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Agenda, minutes, documents and action items. The agenda press is in
          the package above; this is where its wording is edited.
        </p>
        <dl className="mt-3">
          <Row label="Agenda">
            {meeting.hasAgenda ? "Drafted" : "Not drafted"}
          </Row>
          <Row label="Minutes">
            {meeting.hasMinutes ? "Filed" : "Not filed"}
          </Row>
          <Row label="Documents">{meeting.documentCount}</Row>
          <Row label="Status">{meeting.status}</Row>
        </dl>
        <Link
          href={`/admin/board/meetings/${meeting.id}`}
          className="mt-3 inline-block text-xs text-[#163D6D] hover:underline"
        >
          Open the meeting record →
        </Link>
      </section>
    </div>
  );
}
