import { getConference } from "@/lib/actions/conference";
import { listConferencePeople } from "@/lib/actions/conference-people";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import CheckInDeskClient from "@/components/admin/conference/CheckInDeskClient";
import { loadCheckInFacts } from "@/lib/conference/badges/checkin";

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
  const auth = await requireConferenceOpsAccess();
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
  const asOfRaw = testMode ? one(query.as_of).trim() : "";
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : null;
  // ⛔ What each person HOLDS, resolved once when the desk opens rather than on
  // the roster poll — see loadCheckInFacts for why. A failure here must not take
  // the desk down with it: a desk that shows a name and no entitlement still
  // checks people in, and a desk that will not load does not.
  const [conferenceResult, peopleResult, facts] = await Promise.all([
    getConference(id),
    listConferencePeople(id),
    loadCheckInFacts(id).catch(() => ({ facts: {}, conferenceDates: [] })),
  ]);

  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="h-screen w-screen bg-white p-6 text-sm text-red-700">
        Conference not found.
      </main>
    );
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <style>{`
        body header, body footer { display: none !important; }
        nav[aria-label="Admin breadcrumbs"] { display: none !important; }
        body main { margin: 0 !important; padding: 0 !important; min-height: 100vh !important; }
        .max-w-7xl.mx-auto.px-4.py-8 { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
      `}</style>
      <CheckInDeskClient
        conferenceId={id}
        initialRows={peopleResult.success ? peopleResult.data ?? [] : []}
        initialFacts={facts.facts}
        conferenceDates={facts.conferenceDates}
        testMode={testMode}
        asOf={asOf}
      />
    </main>
  );
}
