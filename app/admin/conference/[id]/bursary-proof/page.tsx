import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBursaryApplications } from "@/lib/conference/bursary-widget";
import { getConferenceScheduleTimeline } from "@/lib/conference/schedule-service";
import { loadMeetingConfirmations } from "@/lib/conference/schedule-ops";
import { loadDoorRoster } from "@/lib/conference/attendance";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { formatCalendarDate } from "@/lib/time/supabase-timestamp";
import PrintButton from "@/components/benchmarking/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bursary proof | Conference Admin" };

/**
 * The CANCOLL travel bursary's proof: for each institution that applied, its
 * people's scheduled meetings and which were confirmed as having happened.
 *
 * Confirmed = a booth check-in card scan for that meeting, by the delegate or by
 * the exhibitor (check-in-cards.ts). This is the report the cards were built
 * for: proof the meetings happened without staff walking the room. Read through
 * the same confirmation reader as the meeting grid and the War Room.
 */
export default async function BursaryProofPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return <main className="p-6 text-sm text-red-700">Admins only.</main>;
  const { id } = await params;
  const db = createAdminClient();

  const [applications, timeline, roster, { seats }, { data: conference }] = await Promise.all([
    loadBursaryApplications(id),
    getConferenceScheduleTimeline(id, { viewerRole: "admin" }),
    loadDoorRoster(db, id, null),
    loadSeatHoldings(db, { conferenceId: id, assigned: true }),
    db.from("conference_instances").select("name").eq("id", id).maybeSingle(),
  ]);
  const meetings = timeline.meetingAssignmentItems
    .filter((item) => item.meetingAssignment)
    .map((item) => ({ ...item.meetingAssignment!, date: item.dayKeyLocal ?? null }));
  const confirmations = await loadMeetingConfirmations(
    db,
    meetings.map((m) => m.scheduleId)
  );
  const rosterByPerson = new Map(roster.map((r) => [r.personId, r] as const));
  const printedAt = new Date().toLocaleString("en-CA", { timeZone: "America/Edmonton" });

  return (
    <main className="mx-auto max-w-4xl bg-white px-6 py-8 text-gray-900 print:max-w-none print:p-0">
      <style>{`
        @media print {
          header, footer { display: none !important; }
          @page { size: letter; margin: 0.5in; }
          .org { break-inside: avoid; }
        }
      `}</style>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Travel bursary: meeting proof</h1>
          <p className="text-sm text-gray-600">
            {(conference?.name as string | undefined) ?? "Conference"} · {applications.length} institutions ·
            printed {printedAt} (Mountain)
          </p>
        </div>
        <span className="print:hidden">
          <PrintButton label="Print" />
        </span>
      </div>
      <p className="mb-6 text-sm text-gray-600">
        A meeting counts as confirmed when the delegate or the exhibitor scanned the booth&apos;s check-in card
        during it.
      </p>

      {applications.length === 0 ? <p className="text-sm text-gray-500">No institution has applied.</p> : null}

      {applications.map((app) => {
        const people = new Set(
          seats.filter((s) => s.organizationId === app.organizationId && s.holderPersonId).map((s) => s.holderPersonId!)
        );
        const seatToPerson = new Map(
          seats.filter((s) => s.holderPersonId && people.has(s.holderPersonId)).map((s) => [s.seatId, s.holderPersonId!])
        );
        const rows = meetings.flatMap((m) =>
          m.delegateSeatIds
            .filter((seatId) => seatToPerson.has(seatId))
            .map((seatId) => {
              const personId = seatToPerson.get(seatId)!;
              const confirmation = confirmations.get(m.scheduleId);
              return {
                key: `${m.scheduleId}:${personId}`,
                person: rosterByPerson.get(personId)?.name ?? "Unnamed",
                when: `${m.date ? formatCalendarDate(m.date) ?? m.date : ""} ${m.startTime.slice(0, 5)}`,
                suite: m.suiteNumber,
                exhibitor: m.exhibitorName,
                confirmed: Boolean(confirmation?.confirmedPersonIds.includes(personId)),
                by: confirmation
                  ? [confirmation.byAttendee ? "delegate" : null, confirmation.byExhibitor ? "exhibitor" : null]
                      .filter(Boolean)
                      .join(" + ")
                  : "",
              };
            })
        );
        const confirmedCount = rows.filter((r) => r.confirmed).length;
        return (
          <section key={app.id} className="org mb-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-gray-900 pb-1">
              <h2 className="text-lg font-semibold">
                {app.organizationName}
                {app.province ? <span className="font-normal text-gray-500"> · {app.province}</span> : null}
              </h2>
              <span className="text-sm">
                {confirmedCount} of {rows.length} meetings confirmed · bursary {app.status}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="py-2 text-sm text-gray-500">No meetings scheduled for this institution&apos;s people.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-400 text-left">
                    <th className="py-1.5">Delegate</th>
                    <th className="py-1.5">When</th>
                    <th className="py-1.5">Suite</th>
                    <th className="py-1.5">Exhibitor</th>
                    <th className="py-1.5">Confirmed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .sort((a, b) => a.person.localeCompare(b.person) || a.when.localeCompare(b.when))
                    .map((r) => (
                      <tr key={r.key} className="border-b border-gray-200">
                        <td className="py-1.5">{r.person}</td>
                        <td className="py-1.5">{r.when}</td>
                        <td className="py-1.5">{r.suite ?? "—"}</td>
                        <td className="py-1.5">{r.exhibitor}</td>
                        <td className={`py-1.5 ${r.confirmed ? "text-green-700" : "text-red-700"}`}>
                          {r.confirmed ? `Yes (${r.by})` : "No"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </main>
  );
}
