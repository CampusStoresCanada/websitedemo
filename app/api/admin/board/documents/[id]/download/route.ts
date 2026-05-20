/**
 * GET /api/admin/board/documents/[id]/download
 *
 * Returns a short-lived signed URL for a board document.
 * Access: admin or super_admin (all board members can read all documents).
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const db     = createAdminClient();

  const { data: doc, error } = await db
    .from("board_documents")
    .select("id, storage_path, title, mime_type")
    .eq("id", id)
    .maybeSingle();

  if (error || !doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!doc.storage_path) {
    return NextResponse.json({ error: "Document has no file attached" }, { status: 400 });
  }

  // Generate a signed URL valid for 10 minutes
  const { data: signed, error: signError } = await db.storage
    .from("board-documents")
    .createSignedUrl(doc.storage_path, 600);

  if (signError || !signed) {
    return NextResponse.json({ error: "Could not generate download URL" }, { status: 500 });
  }

  return NextResponse.json({
    url:      signed.signedUrl,
    filename: doc.title,
    mimeType: doc.mime_type,
  });
}
