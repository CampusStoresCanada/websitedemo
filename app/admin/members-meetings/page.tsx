/**
 * /admin/members-meetings — every meeting of the members.
 *
 * A members' meeting is not a board meeting, and it stopped being findable the
 * moment it was filed as one: the AGM sat in the board meeting list between
 * December's and February's, and the only way to bring one into being was to
 * open an election and let the meeting appear as a side effect. This is its own
 * place.
 */

import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { listMembersMeetings } from "@/lib/governance/members-meetings-service";
import {
  MEMBERS_MEETING_LABELS,
  VENUE_LABELS,
  isMembersMeetingType,
  membersMeetingGaps,
  venueOf,
  type MembersMeeting,
} from "@/lib/governance/members-meetings";

export const metadata = {
  title: "Members' Meetings | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function typeLabel(meeting: MembersMeeting): string {
  return isMembersMeetingType(meeting.meetingType)
    ? MEMBERS_MEETING_LABELS[meeting.meetingType]
    : meeting.meetingType;
}

function EventBadge({ meeting }: { meeting: MembersMeeting }) {
  if (!meeting.event)
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
        No event page
      </span>
    );

  const styles: Record<string, string> = {
    draft: "bg-amber-100 text-amber-800",
    published: "bg-green-100 text-green-700",
    completed: "bg-gray-100 text-gray-500",
    cancelled: "bg-red-100 text-red-600",
    pending_review: "bg-blue-100 text-blue-700",
  };
  const label = meeting.event.status === "draft" ? "Event is a draft" : `Event ${meeting.event.status}`;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[meeting.event.status] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {label}
    </span>
  );
}

export default async function MembersMeetingsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-5 py-8 text-sm text-gray-500">
        You do not have access to this page.
      </p>
    );
  }

  const meetings = await listMembersMeetings();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = meetings.filter((m) => m.meetingDate >= today && m.status !== "cancelled");
  const past = meetings.filter((m) => !upcoming.includes(m));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Members' Meetings"
        description="Meetings of the member institutions, under By-Law Part VII. The annual general meeting is the standing one: directors are elected at it, the financial statements are presented, and proxies are exercised."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/members-meetings/new"
              className="rounded-lg bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#163D6D]/90"
            >
              + Schedule a meeting
            </Link>
            <Link
              href="/admin/board"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ← Board Portal
            </Link>
          </div>
        }
      />

      {meetings.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-8">
          <p className="text-sm text-gray-600">No members&apos; meeting is scheduled.</p>
          <p className="mt-2 text-xs text-gray-500">
            Schedule the meeting first, then open the election for it — the nomination, ballot and
            notice windows are all measured back from the date it sits.
          </p>
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Coming up</h2>
          {upcoming.map((m) => {
            const gaps = membersMeetingGaps(m);
            return (
              <Link
                key={m.id}
                href={`/admin/members-meetings/${m.id}`}
                className="block rounded-lg border border-gray-200 bg-white px-5 py-4 hover:border-[#163D6D]/40 hover:shadow-sm transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{typeLabel(m)}</p>
                    <p className="mt-0.5 text-sm text-gray-600">{formatDate(m.meetingDate)}</p>
                    {m.event && (
                      <p className="mt-1 text-xs text-gray-500">
                        {VENUE_LABELS[venueOf(m.event)]}
                        {m.event.location ? ` · ${m.event.location}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <EventBadge meeting={m} />
                    {m.election ? (
                      <span className="text-xs text-gray-500">
                        {m.election.cycleYear} election · {m.election.status.replace(/_/g, " ")}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-700">No election opened for it yet</span>
                    )}
                    {m.proxyCount > 0 && (
                      <span className="text-xs text-gray-500">
                        {m.proxyCount} {m.proxyCount === 1 ? "proxy" : "proxies"}
                      </span>
                    )}
                  </div>
                </div>

                {gaps.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                    {gaps.map((g) => (
                      <li key={g} className="text-xs text-amber-700">
                        • {g}
                      </li>
                    ))}
                  </ul>
                )}
              </Link>
            );
          })}
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Held</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <tbody className="divide-y divide-gray-100">
                {past.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/members-meetings/${m.id}`}
                        className="font-medium text-[#163D6D] hover:underline"
                      >
                        {typeLabel(m)}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{formatDate(m.meetingDate)}</td>
                    <td className="px-5 py-3 text-gray-500">{m.status}</td>
                    <td className="px-5 py-3 text-right text-xs text-gray-500">
                      {m.hasMinutes ? "Minutes filed" : "No minutes"}
                      {m.documentCount > 0 ? ` · ${m.documentCount} document${m.documentCount === 1 ? "" : "s"}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
