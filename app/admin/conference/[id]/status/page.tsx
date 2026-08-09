import { getConference } from "@/lib/actions/conference";
import { getConferenceStatusReadiness } from "@/lib/actions/conference-launch";
import ConferenceLifecycle from "@/components/admin/conference/ConferenceLifecycle";
import StatusControls from "@/components/admin/conference/StatusControls";
import type { ConferenceStatus } from "@/lib/constants/conference";

export const metadata = { title: "Status Controls | Admin" };

export default async function ConferenceStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [result, readinessResult] = await Promise.all([
    getConference(id),
    getConferenceStatusReadiness(id),
  ]);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }

  return (
    <div className="space-y-6">
      {readinessResult.success && (
        <ConferenceLifecycle
          conferenceId={result.data.id}
          status={result.data.status as ConferenceStatus}
          readiness={readinessResult.data}
        />
      )}
      <StatusControls conference={result.data} />
    </div>
  );
}
