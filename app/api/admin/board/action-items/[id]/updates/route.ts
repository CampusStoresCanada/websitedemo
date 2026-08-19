/**
 * GET  /api/admin/board/action-items/[id]/updates — progress log
 * POST /api/admin/board/action-items/[id]/updates — append a note
 *
 * Append-only. This is where the spreadsheet's Update column narrative lands;
 * previously each edit overwrote `description` and the history was lost.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = createAdminClient();

  const { data } = await db
    .from("board_action_item_updates")
    .select("id, note, created_at, author_id")
    .eq("item_id", id)
    .order("created_at", { ascending: false });

  const authorIds = [...new Set((data ?? []).map((u) => u.author_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await db.from("profiles").select("id, display_name").in("id", authorIds);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? "Unknown");
  }

  return NextResponse.json({
    updates: (data ?? []).map((u) => ({
      id: u.id,
      note: u.note,
      createdAt: u.created_at,
      author: u.author_id ? names.get(u.author_id) ?? "Unknown" : null,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { note } = (await req.json()) as { note?: string };

  if (!note || !note.trim()) {
    return NextResponse.json({ error: "A note is required" }, { status: 400 });
  }

  const db = createAdminClient();
  const { error } = await db
    .from("board_action_item_updates")
    .insert({ item_id: id, note: note.trim(), author_id: auth.ctx.userId });

  if (error) {
    console.error("[action-item updates POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
