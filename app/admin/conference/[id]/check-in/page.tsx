import { getConference } from "@/lib/actions/conference";
import { listConferencePeople } from "@/lib/actions/conference-people";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import CheckInDeskClient from "@/components/admin/conference/CheckInDeskClient";

export const metadata = {
  title: "Conference Check-in Desk | Admin",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConferenceCheckInDeskPage({
  params,
}: {
  params: Promise<{ id: string }>;
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
  const [conferenceResult, peopleResult] = await Promise.all([
    getConference(id),
    listConferencePeople(id),
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
      />
    </main>
  );
}
