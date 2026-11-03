import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConferenceScheduleTimeline, type ConferenceMeetingAssignment } from "@/lib/conference/schedule-service";
import { loadDoorRoster } from "@/lib/conference/attendance";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { readPreferences } from "@/lib/profile/preferences";
import { parsePrintSort, PRINT_SORT_PREFERENCE_KEY } from "@/lib/conference/badges/arrangement";
import { formatCalendarDate } from "@/lib/time/supabase-timestamp";
import PrintButton from "@/components/benchmarking/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meeting schedules | Check-in" };

type Meeting = ConferenceMeetingAssignment & { date: string | null };

const hm = (time: string) => time.slice(0, 5);

/**
 * Printed meeting schedules (War Room → What's next):
 *
 *   ?view=people  one page per person — their own meetings, the individual
 *                 schedule someone asks for at the desk.
 *   ?view=suites  one sheet per suite, for its door: who meets there, when.
 *
 * ⛔ The same meetings /me shows: the admin read of the published schedule
 * (getConferenceScheduleTimeline), so paper and phone cannot disagree. People
 * come out in the viewer's own name order, set once in the War Room.
 */
export default async function MeetingSchedulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const auth = await requireConferenceDeskAccess(id);
  if (!auth.ok) return <main className="p-6 text-sm text-red-700">Conference desk access required.</main>;
  const view = (await searchParams).view === "suites" ? "suites" : "people";

  const db = createAdminClient();
  const sort = parsePrintSort((await readPreferences(auth.ctx.userId))[PRINT_SORT_PREFERENCE_KEY]);
  const [timeline, roster, { seats }] = await Promise.all([
    getConferenceScheduleTimeline(id, { viewerRole: "admin" }),
    loadDoorRoster(db, id, null, sort),
    loadSeatHoldings(db, { conferenceId: id, assigned: true }),
  ]);
  const meetings: Meeting[] = timeline.meetingAssignmentItems
    .filter((item) => item.meetingAssignment)
    .map((item) => ({ ...item.meetingAssignment!, date: item.dayKeyLocal ?? null }));

  if (meetings.length === 0) {
    return <main className="p-6 text-sm text-gray-700">No meeting schedule has been published yet.</main>;
  }

  // Seat → who holds it, so a delegate seat in a meeting has a name and a store.
  const personBySeat = new Map(seats.map((s) => [s.seatId, s.holderPersonId] as const));
  const rosterByPerson = new Map(roster.map((r) => [r.personId, r] as const));
  const nameOfSeat = (seatId: string) => {
    const personId = personBySeat.get(seatId);
    const row = personId ? rosterByPerson.get(personId) : undefined;
    return row ? `${row.name}${row.organizationName ? ` (${row.organizationName})` : ""}` : "Unnamed";
  };
  const when = (m: Meeting) =>
    `${m.date ? `${formatCalendarDate(m.date) ?? m.date}, ` : ""}${hm(m.startTime)}–${hm(m.endTime)}`;

  const header = (
    <div className="mb-6 flex items-start justify-between gap-4 print:hidden">
      <div>
        <h1 className="text-2xl font-bold">{view === "people" ? "Individual schedules" : "Suite door sheets"}</h1>
        <p className="text-sm text-gray-600">{meetings.length} meetings · one page each</p>
      </div>
      <PrintButton label="Print" />
    </div>
  );
  const styles = (
    <style>{`
      @media print {
        header, footer { display: none !important; }
        @page { size: letter; margin: 0.5in; }
        .page { break-after: page; }
      }
    `}</style>
  );

  if (view === "suites") {
    const bySuite = new Map<number, Meeting[]>();
    for (const m of meetings) {
      const key = m.suiteNumber ?? 0;
      bySuite.set(key, [...(bySuite.get(key) ?? []), m]);
    }
    return (
      <main className="mx-auto max-w-3xl bg-white px-6 py-8 text-gray-900 print:max-w-none print:p-0">
        {styles}
        {header}
        {[...bySuite.entries()]
          .sort(([a], [b]) => a - b)
          .map(([suite, list]) => (
            <section key={suite} className="page mb-10">
              <h2 className="text-3xl font-bold">Suite {suite || "—"}</h2>
              <table className="mt-4 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-900 text-left">
                    <th className="w-40 py-2">When</th>
                    <th className="py-2">Exhibitor</th>
                    <th className="py-2">Meeting with</th>
                  </tr>
                </thead>
                <tbody>
                  {list
                    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
                    .map((m) => (
                      <tr key={m.scheduleId} className="border-b border-gray-300 align-top">
                        <td className="py-2 font-medium">{when(m)}</td>
                        <td className="py-2">{m.exhibitorName}</td>
                        <td className="py-2">{m.delegateSeatIds.map(nameOfSeat).join("; ") || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))}
      </main>
    );
  }

  // People: each person's own meetings, as delegate or as exhibitor.
  const meetingsByPerson = new Map<string, Meeting[]>();
  const add = (seatId: string, m: Meeting) => {
    const personId = personBySeat.get(seatId);
    if (!personId) return;
    const list = meetingsByPerson.get(personId) ?? [];
    if (!list.some((x) => x.scheduleId === m.scheduleId)) list.push(m);
    meetingsByPerson.set(personId, list);
  };
  for (const m of meetings) {
    add(m.exhibitorSeatId, m);
    for (const seatId of m.delegateSeatIds) add(seatId, m);
  }
  const people = roster.filter((r) => meetingsByPerson.has(r.personId));

  return (
    <main className="mx-auto max-w-3xl bg-white px-6 py-8 text-gray-900 print:max-w-none print:p-0">
      {styles}
      {header}
      {people.map((person) => {
        const list = (meetingsByPerson.get(person.personId) ?? []).sort((a, b) =>
          `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)
        );
        return (
          <section key={person.personId} className="page mb-10">
            <h2 className="text-2xl font-bold">{person.name}</h2>
            <p className="text-sm text-gray-600">{person.organizationName}</p>
            <table className="mt-4 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-gray-900 text-left">
                  <th className="w-40 py-2">When</th>
                  <th className="w-20 py-2">Suite</th>
                  <th className="py-2">With</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => {
                  const asExhibitor = personBySeat.get(m.exhibitorSeatId) === person.personId;
                  return (
                    <tr key={m.scheduleId} className="border-b border-gray-300 align-top">
                      <td className="py-2 font-medium">{when(m)}</td>
                      <td className="py-2">{m.suiteNumber ?? "—"}</td>
                      <td className="py-2">
                        {asExhibitor ? m.delegateSeatIds.map(nameOfSeat).join("; ") || "—" : m.exhibitorName}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}
