import Link from "next/link";
import { isGlobalAdmin, requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import ScheduleOpsClient from "@/components/admin/conference/ScheduleOpsClient";
import { loadScheduleOpsSummary } from "@/lib/conference/schedule-ops";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Schedule Ops | Admin",
};

export default async function ConferenceScheduleOpsPage({
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

  const { id: conferenceId } = await params;
  const adminClient = createAdminClient();
  const { data: conference } = (await adminClient
    .from("conference_instances")
    .select("id, name, year, edition_code")
    .eq("id", conferenceId)
    .maybeSingle()) as { data: { id: string; name: string; year: number; edition_code: string } | null };

  if (!conference) {
    return <main className="p-6 text-sm text-red-700">Conference not found.</main>;
  }

  const summary = await loadScheduleOpsSummary(conferenceId);

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schedule Ops</h1>
          <p className="mt-1 text-sm text-gray-600">
            {conference.name} ({conference.year}-{conference.edition_code})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/conference/${conferenceId}/war-room`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Open People Lookup
          </Link>
          <Link
            href={`/admin/conference/${conferenceId}`}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to Conference
          </Link>
        </div>
      </div>

      {!summary.activeRunId ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">No Active Schedule Run</h2>
          <p className="mt-1 text-sm text-amber-900">
            Generate a draft run and promote it when complete to publish schedule state.
          </p>
        </section>
      ) : null}

      <ScheduleOpsClient
        conferenceId={conferenceId}
        initialSummary={summary}
        canPromote={isGlobalAdmin(auth.ctx.globalRole)}
      />
    </main>
  );
}

