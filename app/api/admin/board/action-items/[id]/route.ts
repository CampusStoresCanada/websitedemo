/**
 * PATCH  /api/admin/board/action-items/[id] — inline edits from the checklist
 * DELETE /api/admin/board/action-items/[id] — remove item
 *
 * Every control on a checklist row lands here: tick to complete, change the
 * state, move the due date, set importance, claim, relinquish.
 * See docs/BOARD_ACTION_ITEM_MINT.md §11.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextOccurrence, isRecurrence } from "@/lib/board/recurrence";

const STATUSES = ["open", "in_progress", "complete", "deferred", "intention", "dropped"];
const PRIORITIES = ["high", "medium", "low"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const db = createAdminClient();

  const { data: current } = await db
    .from("board_action_items")
    .select("id, meeting_id, title, description, status, priority, assignees, quality_flags, due_date, started_at, held_at, escalated_at, recurrence, series_id, sort_order")
    .eq("id", id)
    .maybeSingle();

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  const now = new Date();
  const nowIso = now.toISOString();

  // ── Status, and the clock it drives ─────────────────────────────────
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status;

    // Starting stamps the clock — a countdown needs a start as well as an end.
    if (body.status === "in_progress" && !current.started_at) {
      patch.started_at = nowIso;
    }

    if (body.status === "deferred") {
      // Holding freezes the bar where it stands.
      patch.held_at = nowIso;
    } else if (current.held_at) {
      // Resuming banks the time that was held: the due date advances by
      // exactly the held duration, so a hold cannot quietly buy a month and
      // the bar picks up where it paused.
      patch.held_at = null;
      if (current.due_date) {
        const heldDays = Math.max(
          0,
          Math.round((now.getTime() - Date.parse(current.held_at)) / 86_400_000)
        );
        if (heldDays > 0) {
          const due = new Date(`${current.due_date}T00:00:00Z`);
          due.setUTCDate(due.getUTCDate() + heldDays);
          patch.due_date = due.toISOString().slice(0, 10);
        }
      }
    }
  }

  if (body.recurrence !== undefined) {
    if (body.recurrence !== null && !isRecurrence(body.recurrence)) {
      return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });
    }
    patch.recurrence = body.recurrence;
  }

  if (body.priority !== undefined) {
    if (body.priority !== null && !PRIORITIES.includes(body.priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }
    patch.priority = body.priority;
  }

  if (body.dueDate !== undefined) {
    patch.due_date = body.dueDate;
    // First date set is also the original commitment, so later revisions
    // cannot silently erase what was promised.
    if (body.dueDate) patch.due_date_original = current.due_date ?? body.dueDate;
  }

  if (body.description !== undefined) patch.description = body.description;
  if (body.title !== undefined) patch.title = body.title;
  if (body.assignees !== undefined) {
    patch.assignees = body.assignees;

  }

  // ── Claim / relinquish ──────────────────────────────────────────────
  const assignees = (current.assignees ?? []) as string[];
  const viewer = auth.ctx.userId;

  if (body.relinquish === true && viewer) {
    const remaining = assignees.filter((a) => a !== viewer);
    patch.assignees = remaining;
    // Handing back the last owner returns the item to the unclaimed pool
    // rather than leaving it as an ownerless "open" task nobody will do.
    if (remaining.length === 0) patch.status = "intention";
  }

  if (body.claim === true && viewer) {
    if (!assignees.includes(viewer)) patch.assignees = [...assignees, viewer];
    // Claiming is the moment malformed work gets repaired — the caller must
    // supply what the rubric found missing.
    if (!body.dueDate && !current.due_date) {
      return NextResponse.json(
        { error: "Give it a due date before claiming it." },
        { status: 400 }
      );
    }
    patch.status = "open";
    patch.quality_flags = [];
  }

  // ── Answering "still real?" ─────────────────────────────────────────
  // The badge asks a question, so both answers have to exist. Yes restarts
  // the escalation clock; no closes the item honestly rather than forcing
  // someone to tick "complete" on work that never happened.
  if (body.stillReal === true) {
    patch.escalated_at = nowIso;
  }

  if (body.drop === true) {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json(
        { error: "Say why it is being closed — that reason is the record." },
        { status: 400 }
      );
    }
    patch.status = "dropped";
    patch.dropped_at = nowIso;
    patch.dropped_reason = reason;
  }

  // ── Repairing an intention ──────────────────────────────────────────
  // An intention is malformed work. Whatever edit just happened, re-check
  // whether it is now well formed: an owner and a finish line promote it.
  // Evaluated here rather than inside one field's branch, so "assign, then
  // set a date" works as well as doing it the other way round.
  if (current.status === "intention" && patch.status === undefined) {
    const owners = (patch.assignees ?? current.assignees ?? []) as string[];
    const due = patch.due_date !== undefined ? patch.due_date : current.due_date;
    const remaining = ((current.quality_flags ?? []) as string[]).filter(
      (f) =>
        !(owners.length > 0 && (f === "no_owner" || f === "owner_unresolved")) &&
        !(due && f === "no_finish_line")
    );

    if (owners.length > 0 && due) {
      patch.status = "open";
      patch.quality_flags = [];
    } else {
      patch.quality_flags = remaining;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const { error } = await db.from("board_action_items").update(patch).eq("id", id);

  if (!error && body.drop === true) {
    await db.from("board_action_item_updates").insert({
      item_id: id,
      note: `Closed without completing: ${patch.dropped_reason}`,
      author_id: auth.ctx.userId,
    });
  }

  if (error) {
    console.error("[action-items PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── Recurrence ──────────────────────────────────────────────────────
  // Completion is the trigger, never a clock. A series can therefore only
  // ever have one open instance: if the work stops happening the series
  // quietly stops, rather than piling up a year of unread copies.
  let spawned: { id: string; dueDate: string } | null = null;
  const becameComplete = patch.status === "complete" && current.status !== "complete";
  const recurrence = (patch.recurrence ?? current.recurrence) as string | null;

  if (becameComplete && isRecurrence(recurrence)) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: meetings } = await db
      .from("board_meetings")
      .select("meeting_date")
      .neq("status", "cancelled")
      .order("meeting_date");

    const nextDue = nextOccurrence(
      recurrence,
      (patch.due_date as string) ?? current.due_date ?? today,
      (meetings ?? []).map((m) => m.meeting_date),
      today
    );

    // Null means the calendar has run out — better to end the series than to
    // invent a date the board never agreed to.
    if (nextDue) {
      const { data: created } = await db
        .from("board_action_items")
        .insert({
          meeting_id: current.meeting_id,
          title: current.title,
          description: current.description ?? "",
          assignees: current.assignees ?? [],
          priority: current.priority,
          due_date: nextDue,
          due_date_original: nextDue,
          status: "open",
          recurrence,
          // The first instance's own id roots the series.
          series_id: current.series_id ?? current.id,
          sort_order: current.sort_order ?? 0,
          source: "manual",
          // Deliberately unstamped: this is genuine new work with a real date,
          // so the ordinary due-date reminder should fire as it approaches.
        })
        .select("id, due_date")
        .single();

      if (created) spawned = { id: created.id, dueDate: created.due_date as string };

      if (!current.series_id) {
        await db.from("board_action_items").update({ series_id: current.id }).eq("id", current.id);
      }
    }
  }

  return NextResponse.json({ ok: true, applied: patch, spawned });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = createAdminClient();
  const { error } = await db.from("board_action_items").delete().eq("id", id);

  if (error) {
    console.error("[action-items DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
