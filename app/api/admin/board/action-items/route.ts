/**
 * POST /api/admin/board/action-items — create a new action item
 * Sends a Butler Ghost DM to each assignee after creation.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";
import { notifyActionItemAssignees } from "@/lib/board/action-notify";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { meetingId, title, description, assignees, dueDate } = await req.json();

  if (!meetingId || !title) {
    return NextResponse.json({ error: "meetingId and title are required" }, { status: 400 });
  }

  const db = createAdminClient();

  // Get max sort_order for this meeting
  const { data: existing } = await db
    .from("board_action_items")
    .select("sort_order")
    .eq("meeting_id", meetingId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sort_order = (existing?.sort_order ?? -1) + 1;

  const assigneeUuids: string[] = Array.isArray(assignees) ? assignees : [];

  const { data: item, error } = await db
    .from("board_action_items")
    .insert({
      meeting_id:  meetingId,
      title,
      description: description ?? null,
      assignees:   assigneeUuids,
      due_date:    dueDate ?? null,
      sort_order,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create action item:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve assignee emails and send DMs — awaited so we can report the result
  let notifyDebug: Record<string, unknown> = { skipped: "no assignees" };

  if (assigneeUuids.length > 0) {
    let emailMap: Record<string, string> = {};
    try {
      emailMap = await lookupUserEmailsByIds(db, assigneeUuids);
    } catch (e) {
      console.error("[action-items] Failed to resolve assignee emails:", e);
    }

    const { data: meeting } = await db
      .from("board_meetings")
      .select("meeting_date")
      .eq("id", meetingId)
      .maybeSingle();

    const emails = assigneeUuids.map((id) => emailMap[id]).filter(Boolean);
    notifyDebug = { resolvedEmails: emails, emailMap };

    if (emails.length > 0) {
      try {
        await notifyActionItemAssignees({
          itemId:         item.id,
          title:          item.title,
          description:    item.description ?? null,
          dueDate:        item.due_date ?? null,
          completeToken:  item.complete_token,
          meetingDate:    meeting?.meeting_date ?? "",
          assigneeEmails: emails,
          mode:           "created",
          status:         item.status,
          createdAt:      item.created_at,
        });
        notifyDebug = { ...notifyDebug, dmSent: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[action-items] DM send failed:", msg);
        notifyDebug = { ...notifyDebug, dmError: msg };
      }
    } else {
      notifyDebug = { ...notifyDebug, skipped: "emails resolved to empty" };
    }
  }

  return NextResponse.json({ item, notifyDebug });
}
