/**
 * PATCH /api/admin/board/action-items/[id] — update status
 * DELETE /api/admin/board/action-items/[id] — remove item
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();

  const allowed: Record<string, unknown> = {};
  if (body.status      !== undefined) allowed.status    = body.status;
  if (body.description !== undefined) allowed.description = body.description;
  if (body.assignees   !== undefined) allowed.assignees = body.assignees;   // uuid[]
  if (body.dueDate     !== undefined) allowed.due_date  = body.dueDate;

  const db = createAdminClient();
  const { error } = await db
    .from("board_action_items")
    .update(allowed)
    .eq("id", id);

  if (error) {
    console.error("Failed to update action item:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = createAdminClient();

  const { error } = await db
    .from("board_action_items")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Failed to delete action item:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
