import { cache, type ReactNode } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadStaffAnsweringOrgId, loadStaffChecklists } from "@/lib/conference/checklist-tasks";
import { arrangeStaffChecklists, calendarDayIn, describeUrgency } from "@/lib/conference/deadline-urgency";
import { stationOnline } from "@/lib/conference/badges/print-station";
import { meetingsSoFar } from "@/lib/conference/checklist-checks";
import { formatDayMonth } from "@/lib/time/supabase-timestamp";

/**
 * The staff checklists, checked and arranged, once per request: the status
 * line's "Next" and the What's next tab read the same answer, so it is
 * evaluated once even when both are on the page. It is the War Room's slowest
 * read (about a second: every task's check runs).
 */
export const loadArrangedChecklists = cache(async (conferenceId: string, timeZone: string) => {
  const db = createAdminClient();
  const answeringOrgId = await loadStaffAnsweringOrgId(db);
  const checklists = await loadStaffChecklists(db, conferenceId, answeringOrgId);
  return { answeringOrgId, checklists, groups: arrangeStaffChecklists(checklists, new Date(), timeZone) };
});

/** The print station, for the status line and the Print tab. Cheap: two counts. */
export const loadPrintStationState = cache(async (conferenceId: string) => {
  const db = createAdminClient();
  const [stationsRes, waitingJobs] = await Promise.all([
    db.from("print_stations").select("last_seen_at").eq("conference_id", conferenceId).is("revoked_at", null),
    db
      .from("badge_print_jobs")
      .select("id", { count: "exact", head: true })
      .eq("conference_id", conferenceId)
      .in("status", ["sent_to_printer", "rendering"]),
  ]);
  const stations = stationsRes.data ?? [];
  return {
    stations: stations.length,
    online: stations.some((s) => stationOnline(s.last_seen_at as string | null)),
    queued: waitingJobs.count ?? 0,
  };
});

/** One piece of the status line: a fact, coloured by how much it matters, linking to where you fix it. */
function StatusItem({ tone, href, children }: { tone: "alert" | "warn" | "ok" | "quiet"; href: string; children: ReactNode }) {
  const dot =
    tone === "alert" ? "bg-red-600" : tone === "warn" ? "bg-amber-500" : tone === "ok" ? "bg-green-600" : "bg-gray-300";
  return (
    <a href={href} className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-700 hover:text-gray-950">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {children}
    </a>
  );
}

/** The frame the line sits in, so the page holds its place while it streams. */
export function StatusLineFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[2.75rem] flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5">
      {children}
    </div>
  );
}

/**
 * "Is anything on fire?" — only what is live. Streamed in its own Suspense
 * boundary: the checklist checks behind "Next" and the meetings count are the
 * page's slowest reads, and the tab underneath should not wait for them.
 */
export default async function StatusLine({
  conferenceId,
  timeZone,
  waitingCount,
  urgentCount,
}: {
  conferenceId: string;
  timeZone: string;
  waitingCount: number;
  urgentCount: number;
}) {
  const [{ groups }, station, meetings] = await Promise.all([
    loadArrangedChecklists(conferenceId, timeZone),
    loadPrintStationState(conferenceId),
    meetingsSoFar(createAdminClient(), conferenceId).catch(() => null),
  ]);
  const nextList = groups.now[0] ?? groups.next[0] ?? null;
  const today = calendarDayIn(new Date(), timeZone);
  const daysAway = nextList ? describeUrgency(calendarDayIn(new Date(nextList.deadline), timeZone), today).daysUntil : null;
  const meetingsRunning = meetings && meetings.started > 0 && meetings.started < meetings.total;

  return (
    <StatusLineFrame>
      <StatusItem tone={urgentCount > 0 ? "alert" : waitingCount > 0 ? "warn" : "quiet"} href="?tab=waiting">
        {waitingCount === 0 ? "Nobody waiting on us" : `${waitingCount} waiting on us${urgentCount ? `, ${urgentCount} urgent` : ""}`}
      </StatusItem>
      <StatusItem tone={station.stations === 0 ? "quiet" : station.online ? "ok" : "alert"} href="?tab=print">
        {station.stations === 0 ? "No print station" : station.online ? "Print station online" : "Print station offline"}
        {station.queued ? ` · ${station.queued} waiting` : ""}
      </StatusItem>
      {nextList ? (
        <StatusItem
          tone={daysAway !== null && daysAway < 0 ? "alert" : daysAway !== null && daysAway <= 7 ? "warn" : "quiet"}
          href="?tab=whats_next"
        >
          {daysAway !== null && daysAway < 0 ? "Overdue: " : "Next: "}
          {nextList.name}, {formatDayMonth(nextList.deadline, timeZone)}
          {daysAway !== null && daysAway >= 0
            ? ` (${daysAway === 0 ? "today" : daysAway === 1 ? "tomorrow" : `${daysAway} days`})`
            : ""}
        </StatusItem>
      ) : null}
      {meetingsRunning ? (
        <StatusItem tone={meetings.confirmed < meetings.started ? "warn" : "ok"} href="?tab=meetings">
          {meetings.confirmed} of {meetings.started} meetings confirmed
        </StatusItem>
      ) : null}
    </StatusLineFrame>
  );
}
