import Link from "next/link";
import { getConference } from "@/lib/actions/conference";
import { getBuildWorkspace, getMeetingSetup } from "@/lib/actions/conference-entities";
import { getConferenceScheduleTimeline } from "@/lib/conference/schedule-service";
import ScheduleTimeline from "@/components/admin/conference/ScheduleTimeline";
import MeetingSetupPanel from "@/components/admin/conference/MeetingSetupPanel";
import BigIdeasPitchesPanel from "@/components/admin/conference/BigIdeasPitchesPanel";
import { listTopicsForStaff } from "@/lib/actions/conference-topics";

export const metadata = { title: "Conference Schedule | Admin" };

export default async function ConferenceSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fixtures?: string }>;
}) {
  const { id } = await params;
  // ?fixtures=1 shows the test organisations' pitches in place of the real ones.
  const fixtures = (await searchParams).fixtures === "1";
  const [result, scheduleTimeline, workspaceResult, meetingSetupResult, pitchesResult] = await Promise.all([
    getConference(id),
    getConferenceScheduleTimeline(id, { viewerRole: "admin" }),
    getBuildWorkspace(id),
    getMeetingSetup(id),
    listTopicsForStaff(id, { fixtures }),
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

      {/* Placing a pitch is scheduling it, so it sits with the schedule. Shown
          only once the conference has a Big Ideas Day to place things into. */}
      {pitchesResult.success && pitchesResult.data.dayLabel ? (
        <BigIdeasPitchesPanel board={pitchesResult.data} fixtures={fixtures} />
      ) : null}

      {meetingSetupResult.success ? (
        <MeetingSetupPanel conferenceId={conference.id} initial={meetingSetupResult.data} />
      ) : null}

      {/* This page defines the meetings (days, suites, cadence). Making,
          publishing, emailing and changing them is Operate: the War Room's
          Meetings tab (WAR_ROOM_OPERATE_PLAN §6). */}
      <p className="text-sm text-gray-600">
        The meeting grid, drafts, publishing and schedule emails are in the{" "}
        <Link
          href={`/admin/conference/${conference.id}/war-room?tab=meetings`}
          className="font-medium text-accent hover:underline"
        >
          War Room&apos;s Meetings tab
        </Link>
        .
      </p>
    </div>
  );
}
