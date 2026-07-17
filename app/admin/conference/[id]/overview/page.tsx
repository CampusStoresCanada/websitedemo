import { getConference } from "@/lib/actions/conference";
import { getConferenceLaunchReadiness } from "@/lib/actions/conference-launch";
import { getConferenceCatalogReadiness } from "@/lib/actions/conference-entities";
import ConferenceOverview from "@/components/admin/conference/ConferenceOverview";
import LaunchChecklist from "@/components/admin/conference/LaunchChecklist";

export const metadata = { title: "Conference Overview | Admin" };

export default async function ConferenceOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [result, readinessResult, catalogResult] = await Promise.all([
    getConference(id),
    getConferenceLaunchReadiness(id),
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
        <LaunchChecklist
          conferenceId={conference.id}
          status={conference.status}
          readiness={readinessResult.data}
        />
      )}
      <ConferenceOverview conference={conference} forSaleCount={forSaleCount} />
    </div>
  );
}
