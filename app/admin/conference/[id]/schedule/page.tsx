import { getConference } from "@/lib/actions/conference";
import { getBuildWorkspace, getMeetingSetup } from "@/lib/actions/conference-entities";
import { getConferenceScheduleTimeline } from "@/lib/conference/schedule-service";
import { loadScheduleMatrixData } from "@/lib/conference/schedule-matrix";
import ScheduleTimeline from "@/components/admin/conference/ScheduleTimeline";
import MeetingSetupPanel from "@/components/admin/conference/MeetingSetupPanel";
import MeetingMatrix from "@/components/admin/conference/MeetingMatrix";

export const metadata = { title: "Conference Schedule | Admin" };

export default async function ConferenceSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [result, scheduleTimeline, workspaceResult, meetingSetupResult, matrixData] = await Promise.all([
    getConference(id),
    getConferenceScheduleTimeline(id, { viewerRole: "admin" }),
    getBuildWorkspace(id),
    getMeetingSetup(id),
    loadScheduleMatrixData(id),
  ]);
  if (!result.success || !result.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }
  const conference = result.data;
  const timeZone = conference.timezone ?? "America/Toronto";

  return (
    <div className="space-y-6">
      <ScheduleTimeline
        conferenceId={conference.id}
        items={scheduleTimeline.programItems}
        entities={workspaceResult.success ? workspaceResult.data.entities : []}
        timeZone={timeZone}
      />

      {meetingSetupResult.success ? (
        <MeetingSetupPanel conferenceId={conference.id} initial={meetingSetupResult.data} />
      ) : null}

      <MeetingMatrix conferenceId={conference.id} data={matrixData} />
    </div>
  );
}
