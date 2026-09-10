import { getConference } from "@/lib/actions/conference";
import { getConferenceStatusReadiness } from "@/lib/actions/conference-launch";
import { getConferenceCatalogReadiness } from "@/lib/actions/conference-entities";
import ConferenceOverview from "@/components/admin/conference/ConferenceOverview";
import ConferenceLifecycle from "@/components/admin/conference/ConferenceLifecycle";
import type { ConferenceStatus } from "@/lib/constants/conference";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAttendance } from "@/lib/conference/attendance";
import AttendancePanel from "@/components/admin/conference/AttendancePanel";

export const metadata = { title: "Conference Overview | Admin" };

export default async function ConferenceOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [result, readinessResult, catalogResult, attendance] = await Promise.all([
    getConference(id),
    getConferenceStatusReadiness(id),
    getConferenceCatalogReadiness(id),
    // ⚠️ Never let a counting problem take down the overview. An empty panel is
    // a missing report; a thrown error is a conference nobody can administer.
    loadAttendance(createAdminClient(), id).catch(() => []),
  ]);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }
  const conference = result.data;
  const forSaleCount = catalogResult.success ? catalogResult.data.forSaleCount : 0;

  return (
    <div className="space-y-6">
      {readinessResult.success && (
        <ConferenceLifecycle
          conferenceId={conference.id}
          status={conference.status as ConferenceStatus}
          readiness={readinessResult.data}
        />
      )}
      <ConferenceOverview conference={conference} forSaleCount={forSaleCount} />
      <AttendancePanel rows={attendance} />
    </div>
  );
}
