/**
 * PATCH /api/admin/board/meetings/[id]/content
 * Saves agenda_html or minutes_html for a board meeting.
 *
 * Minutes are normalised on the way in: bare names in ACTION lines ("S. Thomas")
 * are rewritten to canonical mentions ("@Stephen Thomas") so the stored minutes
 * and anything minted from them agree on who is who. Ambiguous names are left
 * exactly as written. See docs/BOARD_ACTION_ITEM_MINT.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { rewriteMentions, type DirectoryEntry } from "@/lib/board/action-mint";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { docType, html } = await req.json() as { docType: "agenda" | "minutes"; html: string };

  if (docType !== "agenda" && docType !== "minutes") {
    return NextResponse.json({ error: "Invalid docType" }, { status: 400 });
  }

  const col       = docType === "agenda" ? "agenda_html"   : "minutes_html";
  const updatedAt = docType === "agenda" ? "agenda_updated_at" : "minutes_updated_at";

  const db = createAdminClient();

  let content = html || null;
  if (docType === "minutes" && content) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, display_name")
      .in("global_role", ["admin", "super_admin"]);

    const directory: DirectoryEntry[] = (profiles ?? [])
      .filter((p) => p.display_name)
      .map((p) => ({ id: p.id, displayName: p.display_name as string }));

    if (directory.length > 0) content = rewriteMentions(content, directory);
  }

  const { error } = await db
    .from("board_meetings")
    .update({ [col]: content, [updatedAt]: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[board/meetings/content]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
