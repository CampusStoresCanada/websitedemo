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
 *
 * First, it puts this quarter's sponsored Circle post on the checklist for
 * each sponsor owed one (lib/sponsorship/post-reminders.ts). A sponsorship
 * item's due-date reminder also emails the sponsor, so both sides hear.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";
import { notifyActionItemAssignees } from "@/lib/board/action-notify";
import { sendEmail } from "@/lib/email/send";
import { resolveOrgPrimaryContactEmail } from "@/lib/supabase/user-lookup";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { getRenewalConfig } from "@/lib/policy/engine";
import { getPlatformIdentity } from "@/lib/data";
import {
  membershipQuarterFor,
  parseSponsorPostMarker,
  sponsorPostReminderEmail,
  syncSponsorPostActionItems,
} from "@/lib/sponsorship/post-reminders";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db  = createAdminClient();
  const now = new Date();

  // ── 0. This quarter's sponsored Circle posts ─────────────────────────────
  // Its own failure must not stop every other reminder going out.
  let sponsorPosts: { created: number; skipped: number } | { error: string };
  try {
    sponsorPosts = await syncSponsorPostActionItems(now.toISOString().slice(0, 10));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sponsorPosts = { error: message };
    await raiseAlertIfNotOpen({
      ruleKey: "sponsor_post_sync_failed",
      severity: "warning",
      message: `Sponsored Circle posts could not be put on the checklist: ${message}`,
      details: {},
    });
  }

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
    .select("id, title, description, due_date, complete_token, assignees, meeting_id, source, source_excerpt")
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
        .select("id, title, description, due_date, complete_token, assignees, meeting_id, source, source_excerpt")
        .in("status", ["open", "in_progress"])
        .is("pre_meeting_reminder_sent_at", null);

      preMeetingItems = openItems ?? [];
    }
  }

  // ── 4. Load all profile emails we'll need ────────────────────────────────
  const allItems   = [...(dueItems ?? []), ...(preMeetingItems ?? [])];
  const allUuids   = [...new Set(allItems.flatMap((i) => i.assignees as string[]))];
  const emailMap = await lookupUserEmailsByIds(db, allUuids);

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

    if (item.source === "sponsorship") {
      await remindSponsorOfPost(db, item.source_excerpt);
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
    sponsorPosts,
  });
}

/**
 * The sponsor's half of a sponsored-post reminder: their primary contact
 * hears that this quarter's post hasn't gone up yet, and can reply with it.
 * Never throws; a sponsor nobody can reach is raised for staff instead.
 */
async function remindSponsorOfPost(db: ReturnType<typeof createAdminClient>, marker: string | null) {
  const parsed = parseSponsorPostMarker(marker);
  if (!parsed) return;
  try {
    const { data: agreement } = await db
      .from("sponsor_agreements")
      .select("organization_id, status, organization:organizations(name)")
      .eq("id", parsed.agreementId)
      .maybeSingle();
    if (!agreement || agreement.status !== "active") return;
    const orgName = (agreement.organization as { name?: string } | null)?.name ?? "Sponsor";
    const to = await resolveOrgPrimaryContactEmail(db, agreement.organization_id);
    if (!to) {
      await raiseAlertIfNotOpen({
        ruleKey: `sponsor_post_no_contact:${parsed.agreementId}`,
        severity: "warning",
        message: `${orgName}'s sponsored Circle post reminder could not be emailed: no contact on file.`,
        details: { agreement_id: parsed.agreementId, organization_id: agreement.organization_id },
      });
      return;
    }
    const { cycle_start_month_day } = await getRenewalConfig();
    const email = sponsorPostReminderEmail({
      orgName,
      quarter: membershipQuarterFor(parsed.quarterStart, cycle_start_month_day),
    });
    // They are asked to reply with the post, so the reply must reach a person.
    const { supportEmail } = await getPlatformIdentity();
    await sendEmail({ to, subject: email.subject, html: email.html, replyTo: supportEmail || undefined });
  } catch (err) {
    console.error("[action-item-reminders] sponsor post email failed:", err);
  }
}
