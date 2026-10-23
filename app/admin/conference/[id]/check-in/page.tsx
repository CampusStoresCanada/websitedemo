import { getConference } from "@/lib/actions/conference";
import { listConferencePeople } from "@/lib/actions/conference-people";
import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import CheckInDeskClient from "@/components/admin/conference/CheckInDeskClient";
import { loadCheckInFacts } from "@/lib/conference/badges/checkin";
import { zonedWallTimeToUtcIso } from "@/lib/conference/tz";

export const metadata = {
  title: "Conference Check-in Desk | Admin",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConferenceCheckInDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: deskConferenceId } = await params;
  const auth = await requireConferenceDeskAccess(deskConferenceId);
  if (!auth.ok) {
    return (
      <main className="h-screen w-screen bg-white p-6 text-sm text-red-700">
        Conference ops access required.
      </main>
    );
  }

  const { id } = await params;
  const query = await searchParams;
  // ⛔ Test mode is a URL flag on THIS request, not a stored setting. There is
  // nothing to leave switched on for the next person who opens the desk: close
  // the tab and it is gone. What survives is the flag on any rows it wrote,
  // which is what the reset is for.
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? "";
  const testMode = one(query.test) === "1";
  // ⚠️ Only honoured in test mode. Pretending it is a different day is how you
  // rehearse the day-pass verdict in September; it is not something a live desk
  // should ever be able to do by editing its own URL.
  // `as_of` may carry a venue time too (2027-02-01T18:00): the event door
  // decides what to offer by the clock, so rehearsing it needs an hour.
  const asOfRaw = testMode ? one(query.as_of).trim() : "";
  const asOfMatch = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(asOfRaw);
  const asOf = asOfMatch ? asOfMatch[1] : null;
  const asOfTime = asOfMatch?.[2] ?? null;
  // ⛔ What each person HOLDS, resolved once when the desk opens rather than on
  // the roster poll — see loadCheckInFacts for why. A failure here must not take
  // the desk down with it: a desk that shows a name and no entitlement still
  // checks people in, and a desk that will not load does not.
  const [conferenceResult, peopleResult, facts] = await Promise.all([
    getConference(id),
    listConferencePeople(id),
    loadCheckInFacts(id).catch(() => ({
      facts: {},
      conferenceDates: [],
      openSeats: [],
      doorEvents: [],
      timeZone: "America/Toronto",
    })),
  ]);

  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="h-screen w-screen bg-white p-6 text-sm text-red-700">
        Conference not found.
      </main>
    );
  }

  return (
    <>
      <CheckInDeskClient
        conferenceId={id}
        initialRows={peopleResult.success ? peopleResult.data ?? [] : []}
        initialFacts={facts.facts}
        initialOpenSeats={facts.openSeats}
        conferenceDates={facts.conferenceDates}
        testMode={testMode}
        asOf={asOf}
        storefrontPath={`/conference/${conferenceResult.data.year}/${conferenceResult.data.edition_code}`}
        doorEvents={facts.doorEvents}
        timeZone={facts.timeZone}
        doorNow={asOf && asOfTime ? zonedWallTimeToUtcIso(asOf, asOfTime, facts.timeZone) : null}
      />
    </>
  );
}
