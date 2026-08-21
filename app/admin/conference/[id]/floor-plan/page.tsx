import { getConferenceFloorPlan } from "@/lib/actions/conference-entities";
import FloorPlanManager from "@/components/admin/conference/FloorPlanManager";

export const metadata = { title: "Floor Plan | Conference Admin" };

export default async function ConferenceFloorPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getConferenceFloorPlan(id);
  if (!result.success) {
    return (
      <div className="text-center py-12 text-gray-500">Failed to load floor plan: {result.error}</div>
    );
  }
  return (
    <FloorPlanManager
      conferenceId={id}
      floorPlanUrl={result.data.floorPlanUrl}
      surfaces={result.data.surfaces}
      booths={result.data.booths}
    />
  );
}
