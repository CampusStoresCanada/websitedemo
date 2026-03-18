import Link from "next/link";
import { getConference } from "@/lib/actions/conference";
import {
  listConferencePeople,
  syncConferencePeopleIndex,
} from "@/lib/actions/conference-people";
import { isGlobalAdmin, requireConferenceOpsAccess } from "@/lib/auth/guards";
import WarRoomClient from "@/components/admin/conference/WarRoomClient";

export const metadata = {
  title: "Conference War Room | Admin",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConferenceWarRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) {
    return (
      <main className="p-6 text-sm text-red-700">
        Conference ops access required.
      </main>
    );
  }

  const { id } = await params;
  const canRunSync = isGlobalAdmin(auth.ctx.globalRole);
  const [conferenceResult, peopleResult] = await Promise.all([
    getConference(id),
    listConferencePeople(id),
  ]);

  if (!conferenceResult.success || !conferenceResult.data) {
    return <main className="p-6 text-sm text-red-700">Conference not found.</main>;
  }

  const rows = peopleResult.success ? peopleResult.data ?? [] : [];

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">War Room</h1>
          <p className="mt-1 text-sm text-gray-600">
            {conferenceResult.data.name} ({conferenceResult.data.year}-
            {conferenceResult.data.edition_code})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/conference/${id}/badges`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Badge Ops
          </Link>
          <Link
            href={`/admin/conference/${id}/schedule-ops`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Schedule Ops
          </Link>
          <Link
            href={`/admin/conference/${id}/check-in`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-[#EE2A2E] bg-[#EE2A2E] px-3 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
          >
            Open Check-in Desk
          </Link>
          <Link
            href={`/admin/conference/${id}`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to Conference
          </Link>
          {canRunSync ? (
            <form
              action={async () => {
                "use server";
                await syncConferencePeopleIndex(id);
              }}
            >
              <button
                type="submit"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Sync People Index
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <WarRoomClient
        conferenceId={id}
        initialRows={rows}
        canEditAdminNotes={isGlobalAdmin(auth.ctx.globalRole)}
      />
    </main>
  );
}
