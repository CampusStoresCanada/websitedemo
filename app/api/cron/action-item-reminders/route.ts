/**
 * GET /api/cron/action-item-reminders
 *
 * Daily cron (runs at 09:00 UTC). Sends two kinds of reminder DMs:
 *
 *   1. N-day reminder  — fires when due_date is exactly N days away
 *      (N is stored in app_settings.action_item_reminder_days, default 3)
 *
 *   2. Pre-meeting reminder — fires on the Monday before the next upcoming
 *      board meeting if the item is still open/in_progress.
 *
 * Each reminder is only sent once (tracked by reminder_sent_at /
 * pre_meeting_reminder_sent_at). Items that are complete or deferred are skipped.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyActionItemAssignees } from "@/lib/board/action-notify";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db  = createAdminClient();
  const now = new Date();

  // ── 1. Read reminder-days setting ────────────────────────────────────────
  const { data: setting } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "action_item_reminder_days")
    .maybeSingle();

  const reminderDays = parseInt(setting?.value ?? "3", 10);

  // Target due date: today + reminderDays
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + reminderDays);
  const targetDateStr = targetDate.toISOString().slice(0, 10);

  // ── 2. Find open items due in exactly N days (no reminder sent yet) ───────
  const { data: dueItems } = await db
    .from("board_action_items")
    .select("id, title, description, due_date, complete_token, assignees, meeting_id")
    .in("status", ["open", "in_progress"])
    .eq("due_date", targetDateStr)
    .is("reminder_sent_at", null);

  // ── 3. Find next upcoming board meeting ───────────────────────────────────
  const todayStr = now.toISOString().slice(0, 10);
  const { data: nextMeeting } = await db
    .from("board_meetings")
    .select("id, meeting_date")
    .eq("status", "upcoming")
    .gte("meeting_date", todayStr)
    .order("meeting_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Pre-meeting reminder fires on Monday before the meeting
  let preMeetingItems: typeof dueItems = [];
  if (nextMeeting) {
    const meetingDate    = new Date(nextMeeting.meeting_date + "T00:00:00Z");
    const dayOfWeek      = now.getUTCDay(); // 0=Sun, 1=Mon
    const daysUntil      = Math.round((meetingDate.getTime() - now.getTime()) / 86400000);

    // Fire on the Monday before (daysUntil 7 or 8 depending on meeting day)
    // Simple rule: it's Monday (1) AND meeting is 7 or fewer days away
    const isPreMeetingMonday = dayOfWeek === 1 && daysUntil <= 7 && daysUntil > 0;

    if (isPreMeetingMonday) {
      const { data: openItems } = await db
        .from("board_action_items")
        .select("id, title, description, due_date, complete_token, assignees, meeting_id")
        .in("status", ["open", "in_progress"])
        .is("pre_meeting_reminder_sent_at", null);

      preMeetingItems = openItems ?? [];
    }
  }

  // ── 4. Load all profile emails we'll need ────────────────────────────────
  const allItems   = [...(dueItems ?? []), ...(preMeetingItems ?? [])];
  const allUuids   = [...new Set(allItems.flatMap((i) => i.assignees as string[]))];
  const emailMap: Record<string, string> = {};

  if (allUuids.length > 0) {
    const { data: { users } } = await db.auth.admin.listUsers({ perPage: 1000 });
    for (const u of users ?? []) {
      if (allUuids.includes(u.id)) emailMap[u.id] = u.email ?? "";
    }
  }

  // ── 5. Load meeting dates for context ────────────────────────────────────
  const meetingIds = [...new Set(allItems.map((i) => i.meeting_id))];
  const meetingDateMap: Record<string, string> = {};
  if (meetingIds.length > 0) {
    const { data: meetings } = await db
      .from("board_meetings")
      .select("id, meeting_date")
      .in("id", meetingIds);
    for (const m of meetings ?? []) {
      meetingDateMap[m.id] = m.meeting_date;
    }
  }

  // ── 6. Send due-date reminders ────────────────────────────────────────────
  const dueResults: string[] = [];
  for (const item of dueItems ?? []) {
    const emails = (item.assignees as string[])
      .map((id) => emailMap[id])
      .filter(Boolean);

    if (emails.length > 0) {
      await notifyActionItemAssignees({
        itemId:         item.id,
        title:          item.title,
        description:    item.description ?? null,
        dueDate:        item.due_date,
        completeToken:  item.complete_token,
        meetingDate:    meetingDateMap[item.meeting_id] ?? "",
        assigneeEmails: emails,
        mode:           "reminder",
      });
    }

    await db
      .from("board_action_items")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", item.id);

    dueResults.push(item.id);
  }

  // ── 7. Send pre-meeting reminders ─────────────────────────────────────────
  const preMeetingResults: string[] = [];
  for (const item of preMeetingItems ?? []) {
    const emails = (item.assignees as string[])
      .map((id) => emailMap[id])
      .filter(Boolean);

    if (emails.length > 0) {
      await notifyActionItemAssignees({
        itemId:         item.id,
        title:          item.title,
        description:    item.description ?? null,
        dueDate:        item.due_date,
        completeToken:  item.complete_token,
        meetingDate:    meetingDateMap[item.meeting_id] ?? "",
        assigneeEmails: emails,
        mode:           "pre_meeting",
      });
    }

    await db
      .from("board_action_items")
      .update({ pre_meeting_reminder_sent_at: now.toISOString() })
      .eq("id", item.id);

    preMeetingResults.push(item.id);
  }

  return NextResponse.json({
    ok:                  true,
    reminderDays,
    targetDate:          targetDateStr,
    dueReminders:        dueResults.length,
    preMeetingReminders: preMeetingResults.length,
  });
}
