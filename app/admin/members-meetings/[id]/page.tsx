/**
 * /admin/members-meetings/[id] — one meeting of the members.
 *
 * Setting it up lives here, and so does publishing its event page, because
 * publishing is what calls the meeting in public. The agenda, minutes,
 * documents and action items are still served by the meeting record's own
 * screen and are linked rather than copied — the row is the same row, and a
 * second editor for the same agenda would be two surfaces for one verb.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
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
import MembersMeetingSetup from "@/components/admin/members-meetings/MembersMeetingSetup";
import LocalDate from "@/components/ui/LocalDate";

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 py-2 last:border-0">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  );
}

export default async function MembersMeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
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
  const meeting = await getMembersMeeting(id);
  if (!meeting) notFound();

  const label = isMembersMeetingType(meeting.meetingType)
    ? MEMBERS_MEETING_LABELS[meeting.meetingType]
    : meeting.meetingType;
  const gaps = membersMeetingGaps(meeting);
  const venue = meeting.event ? venueOf(meeting.event) : null;

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

      {gaps.length > 0 && (
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

      <MembersMeetingSetup
        meetingId={meeting.id}
        meetingDate={meeting.meetingDate}
        startsAt={meeting.event?.startsAt ?? null}
        endsAt={meeting.event?.endsAt ?? null}
        isVirtual={meeting.event?.isVirtual ?? null}
        location={meeting.event?.location ?? null}
        virtualLink={meeting.event?.virtualLink ?? null}
        eventStatus={meeting.event?.status ?? null}
        electionLabel={
          meeting.election ? `${meeting.election.cycleYear} election` : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">What members see</h2>
          {meeting.event ? (
            <>
              <dl className="mt-3">
                <Row label="Event page">
                  {meeting.event.status === "published" ? (
                    <Link
                      href={`/events/${meeting.event.slug}`}
                      className="text-[#163D6D] hover:underline"
                    >
                      /events/{meeting.event.slug}
                    </Link>
                  ) : (
                    <span className="text-gray-500">
                      /events/{meeting.event.slug} ({meeting.event.status})
                    </span>
                  )}
                </Row>
                {/* ⚠️ LocalDate, not a hand-rolled format. This is a server
                    component, and `toLocaleTimeString` with no `timeZone`
                    renders in whatever zone the PROCESS is in — UTC on Vercel.
                    A noon-Eastern meeting printed as "5:00 p.m." Only a client
                    render knows the reader's zone, and `timeZoneName` means it
                    is never guessed at. */}
                <Row label="Time">
                  {meeting.event.startsAt ? (
                    <>
                      <LocalDate iso={meeting.event.startsAt} format="time-only" />
                      {meeting.event.endsAt && (
                        <>
                          {" \u2013 "}
                          <LocalDate iso={meeting.event.endsAt} format="time-only" />
                        </>
                      )}
                    </>
                  ) : (
                    "not set"
                  )}
                </Row>
                <Row label="Attended">{venue ? VENUE_LABELS[venue] : "—"}</Row>
                {meeting.event.location && <Row label="Address">{meeting.event.location}</Row>}
                <Row label="Audience">
                  {meeting.event.audienceMode === "members"
                    ? "Member institutions"
                    : meeting.event.audienceMode ?? "—"}
                </Row>
              </dl>
              <Link
                href={`/admin/events/${meeting.event.id}`}
                className="mt-3 inline-block text-xs text-[#163D6D] hover:underline"
              >
                Edit the page copy in Events →
              </Link>
            </>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              No event page yet. Saving the details above creates one as a draft.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">The election</h2>
          {meeting.election ? (
            <>
              <dl className="mt-3">
                <Row label="Cycle">{meeting.election.cycleYear}</Row>
                <Row label="Status">{meeting.election.status.replace(/_/g, " ")}</Row>
                <Row label="Seats up">{meeting.election.seatsAvailable ?? "—"}</Row>
                <Row label="Proxies standing">{meeting.proxyCount}</Row>
              </dl>
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <Link
                  href={`/admin/elections/${meeting.election.slug}`}
                  className="text-[#163D6D] hover:underline"
                >
                  Nominations, ballot and notice →
                </Link>
                <Link
                  href={`/admin/elections/${meeting.election.slug}/proxies`}
                  className="text-[#163D6D] hover:underline"
                >
                  Proxies →
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-gray-600">
                No election has been opened for this meeting.
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Open it from Elections and it binds to this date — the nomination, ballot and
                notice windows are all measured back from the day the meeting sits.
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
        <h2 className="text-sm font-semibold text-gray-900">The meeting record</h2>
        <p className="mt-1 text-xs text-gray-500">
          Agenda, minutes, documents and action items for this meeting.
        </p>
        <dl className="mt-3">
          <Row label="Agenda">{meeting.hasAgenda ? "Drafted" : "Not drafted"}</Row>
          <Row label="Minutes">{meeting.hasMinutes ? "Filed" : "Not filed"}</Row>
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
