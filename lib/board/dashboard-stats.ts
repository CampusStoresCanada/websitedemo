import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Board governance health for the admin console widget.
 *
 * Unlike the conference and renewal widgets there's no meaningful time series
 * here — a monthly cadence gives ~12 points a year, and nobody reads a
 * sparkline of that. What matters is the state of the next meeting and
 * whether anything is slipping, so this returns discrete counts plus the
 * upcoming meeting list.
 *
 * These are the same conditions the `board_*` ops alert rules watch
 * (lib/ops/alerts.ts). The widget is the glanceable view; the alerts are the
 * ones that chase. Keep the definitions in step.
 */

export interface BoardMeetingSummary {
  id: string;
  title: string;
  meetingDate: string;
  daysUntil: number;
}

export interface BoardDashboardStats {
  nextMeeting: BoardMeetingSummary | null;
  upcoming: BoardMeetingSummary[];
  openActionItems: number;
  overdueActionItems: number;
  /** Meetings that have happened but still have no minutes. */
  minutesOutstanding: number;
  /** True when nothing is scheduled ahead — mirrors board_no_upcoming_meeting. */
  noUpcomingMeeting: boolean;
}

const OPEN_ACTION_STATUSES = ["open", "in_progress"];

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export async function getBoardDashboardStats(): Promise<BoardDashboardStats> {
  const db = createAdminClient();
  const today = todayString();

  const [upcomingRes, pastRes, actionsRes] = await Promise.all([
    db
      .from("board_meetings")
      .select("id, title, meeting_date")
      .eq("status", "upcoming")
      .gte("meeting_date", today)
      .order("meeting_date", { ascending: true })
      .limit(6),

    // Minutes are judged on the meeting date, not on `status` — status is
    // manually maintained and drifts (see the matching ops alert rule).
    db
      .from("board_meetings")
      .select("id, minutes_html")
      .neq("status", "cancelled")
      .lt("meeting_date", today),

    db
      .from("board_action_items")
      .select("id, due_date, status")
      .in("status", OPEN_ACTION_STATUSES),
  ]);

  const upcoming: BoardMeetingSummary[] = (upcomingRes.data ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    meetingDate: m.meeting_date,
    daysUntil: daysBetween(today, m.meeting_date),
  }));

  const minutesOutstanding = (pastRes.data ?? []).filter(
    (m) => !m.minutes_html || m.minutes_html.trim() === ""
  ).length;

  const openItems = actionsRes.data ?? [];
  const overdueActionItems = openItems.filter(
    (i) => i.due_date !== null && i.due_date < today
  ).length;

  return {
    nextMeeting: upcoming[0] ?? null,
    upcoming,
    openActionItems: openItems.length,
    overdueActionItems,
    minutesOutstanding,
    noUpcomingMeeting: upcoming.length === 0,
  };
}
