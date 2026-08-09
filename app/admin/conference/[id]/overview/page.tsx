import { getConference } from "@/lib/actions/conference";
import { getConferenceStatusReadiness } from "@/lib/actions/conference-launch";
import { getConferenceCatalogReadiness } from "@/lib/actions/conference-entities";
import ConferenceOverview from "@/components/admin/conference/ConferenceOverview";
import ConferenceLifecycle from "@/components/admin/conference/ConferenceLifecycle";
import type { ConferenceStatus } from "@/lib/constants/conference";

export const metadata = { title: "Conference Overview | Admin" };

export default async function ConferenceOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [result, readinessResult, catalogResult] = await Promise.all([
    getConference(id),
    getConferenceStatusReadiness(id),
    getConferenceCatalogReadiness(id),
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
    </div>
  );
}
