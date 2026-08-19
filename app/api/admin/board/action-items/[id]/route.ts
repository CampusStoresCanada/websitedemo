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

const STATUSES = ["open", "in_progress", "complete", "deferred", "intention"];
const PRIORITIES = ["high", "medium", "low"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const db = createAdminClient();

  const { data: current } = await db
    .from("board_action_items")
    .select("id, status, assignees, due_date, started_at, held_at")
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
  if (body.assignees !== undefined) patch.assignees = body.assignees;

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

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const { error } = await db.from("board_action_items").update(patch).eq("id", id);
  if (error) {
    console.error("[action-items PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, applied: patch });
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
