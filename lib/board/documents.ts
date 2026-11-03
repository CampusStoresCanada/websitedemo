/**
 * Store a file against a board meeting: bucket upload + `board_documents` row.
 *
 * The one write path for meeting documents. The admin upload action and the
 * minutes export both come through here, so a generated .docx lands in the
 * meeting's Documents panel exactly as a hand-uploaded one does.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export const BOARD_DOCUMENTS_BUCKET = "board-documents";

export type BoardDocumentType = "agenda" | "minutes" | "financials" | "other";

export interface StoredBoardDocument {
  id: string;
  title: string;
  document_type: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  storage_path: string | null;
  created_at: string;
}

export interface StoreBoardDocumentInput {
  meetingId: string;
  documentType: BoardDocumentType;
  title: string;
  body: Blob | Buffer;
  mimeType: string;
  sizeBytes: number;
  extension: string;
  uploadedBy: string | null;
  onedrive?: { itemId: string; path: string } | null;
}

export async function storeBoardDocument(
  input: StoreBoardDocumentInput,
): Promise<{ doc: StoredBoardDocument } | { error: string }> {
  const db = createAdminClient();
  const path = `meetings/${input.meetingId}/${input.documentType}/${Date.now()}.${input.extension}`;

  const { error: uploadError } = await db.storage
    .from(BOARD_DOCUMENTS_BUCKET)
    .upload(path, input.body, { contentType: input.mimeType, upsert: false });

  if (uploadError) {
    console.error("[storeBoardDocument] storage error", uploadError);
    return { error: "Upload failed" };
  }

  const { data: doc, error: insertError } = await db
    .from("board_documents")
    .insert({
      meeting_id: input.meetingId,
      title: input.title,
      document_type: input.documentType,
      context: "meeting",
      storage_path: path,
      mime_type: input.mimeType,
      file_size_bytes: input.sizeBytes,
      uploaded_by: input.uploadedBy,
      onedrive_item_id: input.onedrive?.itemId ?? null,
      onedrive_path: input.onedrive?.path ?? null,
    })
    .select("id, title, document_type, mime_type, file_size_bytes, storage_path, created_at")
    .single();

  if (insertError || !doc) {
    // Roll back storage upload
    await db.storage.from(BOARD_DOCUMENTS_BUCKET).remove([path]);
    return { error: "Failed to save document record" };
  }

  return { doc };
}

/**
 * Remove a meeting's GENERATED documents with this exact title and type — row
 * and file. Used before re-filing generated minutes, so a reopened-and-
 * recompleted meeting keeps one copy instead of accumulating them. Only rows
 * with no uploader are touched: a file a person uploaded is never replaced by
 * a machine copy, whatever its name.
 */
export async function removeGeneratedBoardDocuments(
  meetingId: string,
  documentType: BoardDocumentType,
  title: string,
): Promise<void> {
  const db = createAdminClient();
  const { data: rows } = await db
    .from("board_documents")
    .select("id, storage_path")
    .eq("meeting_id", meetingId)
    .eq("document_type", documentType)
    .eq("title", title)
    .is("uploaded_by", null);

  if (!rows?.length) return;

  const paths = rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length) await db.storage.from(BOARD_DOCUMENTS_BUCKET).remove(paths);
  await db.from("board_documents").delete().in("id", rows.map((r) => r.id));
}
