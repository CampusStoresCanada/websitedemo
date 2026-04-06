import { getConference } from "@/lib/actions/conference";
import {
  listConferenceExhibitorOrganizations,
  listConferenceScheduleModules,
} from "@/lib/actions/conference-schedule-design";
import { getConferenceScheduleTimeline } from "@/lib/conference/schedule-service";
import ConferenceScheduleDesigner from "@/components/admin/conference/ConferenceScheduleDesigner";

export const metadata = { title: "Conference Schedule | Admin" };

export default async function ConferenceSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [result, scheduleTimeline, modulesResult, exhibitorOrgsResult] = await Promise.all([
    getConference(id),
    getConferenceScheduleTimeline(id, { viewerRole: "admin" }),
    listConferenceScheduleModules(id),
    listConferenceExhibitorOrganizations(id),
  ]);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }
  const conference = result.data;
  const conferenceParams = conference.conference_parameters?.[0] ?? null;

  return (
    <ConferenceScheduleDesigner
      conferenceId={conference.id}
      initialProgramItems={scheduleTimeline.programItems.map((item) => ({
        id: item.id,
        conference_id: item.conferenceId,
        item_type: item.itemType,
        title: item.title,
        description: item.description,
        starts_at: item.startsAt,
        ends_at: item.endsAt,
        location_label: item.locationLabel,
        audience_mode: item.audienceMode,
        target_roles: item.targetRoles,
        is_required: item.isRequired,
        display_order: item.displayOrder,
        created_at: item.createdAt ?? item.startsAt,
        updated_at: item.updatedAt ?? item.endsAt,
      }))}
      params={conferenceParams}
      modules={modulesResult.success ? modulesResult.data ?? [] : []}
      conferenceTimeZone={conference.timezone}
      initialExhibitorOrganizations={
        exhibitorOrgsResult.success ? exhibitorOrgsResult.data ?? [] : []
      }
    />
  );
}
