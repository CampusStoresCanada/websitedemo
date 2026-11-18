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
import MeetingDateForm, {
  PublishEventButton,
} from "@/components/admin/members-meetings/MeetingDateControls";
import EventFormClient from "@/components/admin/events/EventFormClient";
import AgmNoticePanel from "@/components/admin/elections/AgmNoticePanel";
import AgmPackagePanel from "@/components/admin/elections/AgmPackagePanel";
import LocalDate from "@/components/ui/LocalDate";
import { getEvent } from "@/lib/actions/events";
import {
  getNoticeState,
  getAgmPackageState,
  getElection,
} from "@/lib/elections/service";
import {
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
  const [noticeState, agmPackage, election] = electionSlug
    ? await Promise.all([
        getNoticeState(electionSlug),
        getAgmPackageState(electionSlug),
        getElection(electionSlug),
      ])
    : [null, null, null];

  const packageConfig = (election?.config ?? {}) as {
    agmPackageSentAt?: string;
    agmPackageSendCount?: number;
  };
  const agmPackageSentAt = packageConfig.agmPackageSentAt ?? null;
  const agmPackageSendCount = packageConfig.agmPackageSendCount ?? 0;

  const back = `/admin/members-meetings/${id}`;

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
      {proxySent && (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          The proxy form has been sent.
        </p>
      )}

      {gaps.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Still outstanding
          </h2>
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

            {meeting.event.status === "draft" && (
              <PublishEventButton meetingId={meeting.id} />
            )}

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
