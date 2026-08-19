/**
 * GET  /api/admin/board/meetings/[id]/mint — propose action items from the
 *      saved minutes. Read-only, writes nothing, notifies nobody.
 * POST /api/admin/board/meetings/[id]/mint — create the confirmed items.
 *
 * See docs/BOARD_ACTION_ITEM_MINT.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";
import { notifyActionItemAssignees } from "@/lib/board/action-notify";
import { proposeFromMinutes, type DirectoryEntry } from "@/lib/board/action-mint";

export const dynamic = "force-dynamic";

async function loadDirectory(db: ReturnType<typeof createAdminClient>): Promise<DirectoryEntry[]> {
  // Same pool the assignee picker uses, so the resolver and the picker can
  // never disagree about who exists.
  const { data } = await db
    .from("profiles")
    .select("id, display_name")
    .in("global_role", ["admin", "super_admin"])
    .order("display_name");

  return (data ?? [])
    .filter((p) => p.display_name)
    .map((p) => ({ id: p.id, displayName: p.display_name as string }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = createAdminClient();

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, title, meeting_date, minutes_html")
    .eq("id", id)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  if (!meeting.minutes_html || meeting.minutes_html.trim() === "") {
    return NextResponse.json({ proposals: [], alreadyMinted: [], hasMinutes: false });
  }

  const directory = await loadDirectory(db);
  const proposals = proposeFromMinutes(meeting.minutes_html, directory);

  // Anything already minted from the same ACTION line is reported so the
  // screen can mark it rather than offering a duplicate.
  const { data: existing } = await db
    .from("board_action_items")
    .select("source_excerpt")
    .eq("meeting_id", id)
    .not("source_excerpt", "is", null);

  return NextResponse.json({
    hasMinutes: true,
    meeting: { id: meeting.id, title: meeting.title, meetingDate: meeting.meeting_date },
    directory,
    proposals,
    alreadyMinted: (existing ?? []).map((e) => e.source_excerpt),
  });
}

interface ConfirmItem {
  title: string;
  description?: string | null;
  assignees?: string[];
  dueDate?: string | null;
  sourceExcerpt?: string | null;
  flags?: string[];
  /** false → recorded as an intention, which never notifies. */
  isAction: boolean;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json()) as { items?: ConfirmItem[]; source?: string };
  const items = Array.isArray(body.items) ? body.items : [];
  const source = body.source === "backfill" ? "backfill" : "minutes";

  if (items.length === 0) {
    return NextResponse.json({ error: "No items to create" }, { status: 400 });
  }

  const db = createAdminClient();

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, meeting_date")
    .eq("id", id)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  // ── The silence rule ──────────────────────────────────────────────────
  // The pre-meeting sweep selects every open item with no due-date filter
  // and sends on two channels. Minting a past meeting's minutes must never
  // set that off, so historical items are stamped as already-reminded at
  // insert. This is deliberately derived from the meeting date rather than
  // left to the person on the screen to remember.
  const isHistorical = meeting.meeting_date < new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString();

  const { data: lastOrder } = await db
    .from("board_action_items")
    .select("sort_order")
    .eq("meeting_id", id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextOrder = (lastOrder?.sort_order ?? -1) + 1;

  const rows = items.map((item) => {
    const assignees = item.isAction ? item.assignees ?? [] : [];
    return {
      meeting_id: id,
      title: item.title,
      description: item.description ?? "",
      assignees,
      due_date: item.isAction ? item.dueDate ?? null : null,
      due_date_original: item.isAction ? item.dueDate ?? null : null,
      status: item.isAction ? "open" : "intention",
      quality_flags: item.flags ?? [],
      source,
      source_excerpt: item.sourceExcerpt ?? null,
      sort_order: nextOrder++,
      // Intentions never notify anyway (their status is outside every
      // reminder query's whitelist); stamping them too costs nothing and
      // keeps the rule uniform if one is later promoted.
      reminder_sent_at: isHistorical ? stamp : null,
      pre_meeting_reminder_sent_at: isHistorical ? stamp : null,
    };
  });

  const { data: created, error } = await db
    .from("board_action_items")
    .insert(rows)
    .select("id, title, description, due_date, complete_token, status, created_at, assignees");

  if (error) {
    // The unique index on (meeting_id, md5(source_excerpt)) makes re-minting
    // idempotent rather than duplicating.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Some of these items were already minted from this meeting." },
        { status: 409 }
      );
    }
    console.error("[mint] insert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Notify only real, owned, future-meeting actions.
  let notified = 0;
  if (!isHistorical) {
    for (const row of created ?? []) {
      const assignees = (row.assignees ?? []) as string[];
      if (row.status !== "open" || assignees.length === 0) continue;

      const emailMap = await lookupUserEmailsByIds(db, assignees);
      const emails = assignees.map((a) => emailMap[a]).filter(Boolean);
      if (emails.length === 0) continue;

      try {
        await notifyActionItemAssignees({
          itemId: row.id,
          title: row.title,
          description: row.description ?? null,
          dueDate: row.due_date ?? null,
          completeToken: row.complete_token,
          meetingDate: meeting.meeting_date,
          assigneeEmails: emails,
          mode: "created",
          status: row.status,
          createdAt: row.created_at,
        });
        notified += 1;
      } catch (e) {
        console.warn("[mint] notify failed:", e);
      }
    }
  }

  const actions = (created ?? []).filter((r) => r.status === "open").length;
  const intentions = (created ?? []).length - actions;

  return NextResponse.json({ created: created?.length ?? 0, actions, intentions, notified });
}
