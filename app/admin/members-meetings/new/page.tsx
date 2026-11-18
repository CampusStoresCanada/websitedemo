/**
 * /admin/members-meetings/new — call a meeting of the members.
 *
 * This page is the inversion. Until now the AGM came into being because
 * somebody opened an election, and the meeting and its event page appeared as
 * side effects of that. The meeting is the thing: the board decides when and
 * where it sits, and the election is opened FOR it afterwards, taking its
 * nomination, ballot and notice windows from the date set here.
 */

import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import MeetingDateForm from "@/components/admin/members-meetings/MeetingDateControls";
import { resolveAgmDate } from "@/lib/elections/schedule";
import { CSC_ELECTIONS_CONFIG } from "@/lib/elections/config";
import { listMembersMeetings } from "@/lib/governance/members-meetings-service";

export const metadata = {
  title: "Schedule a members' meeting | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewMembersMeetingPage() {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-5 py-8 text-sm text-gray-500">
        Only association staff can call a meeting of the members.
      </p>
    );
  }

  // Default to the next annual general meeting the rule puts on the calendar,
  // skipping any year already scheduled. The rule derives the date; a person
  // confirms or moves it, which is why this is a default and not a decision.
  const existing = await listMembersMeetings();
  const scheduled = new Set(existing.map((m) => m.meetingDate.slice(0, 4)));
  const thisYear = new Date().getUTCFullYear();
  const today = new Date().toISOString().slice(0, 10);

  let suggested = "";
  for (const year of [thisYear, thisYear + 1, thisYear + 2]) {
    if (scheduled.has(String(year))) continue;
    const agm = resolveAgmDate(CSC_ELECTIONS_CONFIG, year);
    if (agm && agm > today) {
      suggested = agm;
      break;
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Schedule a members' meeting"
        description="By-Law Part VII. Choose the kind and settle the day it sits; its event page is created as a draft, and the hour and the place are set on it next."
        actions={
          <Link
            href="/admin/members-meetings"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Members&apos; Meetings
          </Link>
        }
      />

      <MeetingDateForm
        meetingId={null}
        meetingDate={suggested}
        meetingType="agm"
        allowTypeChange
        agmSuggestion={suggested}
        electionLabel={null}
      />

      <p className="text-xs text-gray-500">
        {suggested
          ? `For an annual general meeting the date is prefilled with the one the by-law rule puts in ${suggested.slice(0, 4)}; change it if the board has settled on another day. A special meeting's date is the board's to pick.`
          : "Every annual general meeting the rule offers is already scheduled. A special meeting of the members can be called on any free date."}
      </p>

      <p className="text-xs text-gray-500">
        ⚠️ One meeting per date: <code>board_meetings.meeting_date</code> is unique, so a
        members&apos; meeting cannot share a day with a board meeting. If the date you want is
        taken, the save will say which meeting holds it.
      </p>
    </div>
  );
}
