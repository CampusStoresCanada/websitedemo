"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "board-documents";
const MAX_BYTES = 52428800; // 50 MB (matches bucket limit)
const ALLOWED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
];

export type BoardDocumentType = "agenda" | "minutes" | "financials" | "other";

export interface BoardDocumentRow {
  id: string;
  title: string;
  document_type: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  storage_path: string | null;
  created_at: string;
}

export interface BoardMeetingRow {
  id: string;
  event_id: string | null;
  title: string;
  meeting_type: string;
  meeting_date: string;
  status: string;
  documents: BoardDocumentRow[];
}

// ─── Get (or null) the board meeting linked to an event ──────────────────────

export async function getBoardMeetingForEvent(
  eventId: string,
): Promise<BoardMeetingRow | null> {
  const auth = await requireAdmin();
  if (!auth.ok) return null;

  const db = createAdminClient();
  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, event_id, title, meeting_type, meeting_date, status")
    .eq("event_id", eventId)
    .maybeSingle();

  if (!meeting) return null;

  const { data: docs } = await db
    .from("board_documents")
    .select("id, title, document_type, mime_type, file_size_bytes, storage_path, created_at")
    .eq("meeting_id", meeting.id)
    .order("document_type")
    .order("title");

  return { ...meeting, documents: docs ?? [] };
}

// ─── Upsert the board meeting record for an event ────────────────────────────

export async function upsertBoardMeetingForEvent(
  eventId: string,
  {
    meetingType,
    title,
    meetingDate,
  }: {
    meetingType: "regular" | "special" | "agm";
    title: string;
    meetingDate: string; // YYYY-MM-DD
  },
): Promise<{ meetingId: string } | { error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: "Not authorised" };

  const db = createAdminClient();

  // Check if one already exists for this event
  const { data: existing } = await db
    .from("board_meetings")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();

  if (existing) {
    await db
      .from("board_meetings")
      .update({ meeting_type: meetingType, title, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return { meetingId: existing.id };
  }

  const { data: created, error } = await db
    .from("board_meetings")
    .insert({
      event_id: eventId,
      meeting_type: meetingType,
      meeting_date: meetingDate,
      title,
      status: "upcoming",
      created_by: auth.ctx.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("[upsertBoardMeetingForEvent]", error);
    return { error: "Failed to create board meeting record" };
  }

  revalidatePath("/admin/board/meetings");
  return { meetingId: created.id };
}

// ─── Upload a document to a board meeting ────────────────────────────────────

export async function uploadBoardDocument(
  formData: FormData,
): Promise<{ doc: BoardDocumentRow } | { error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: "Not authorised" };

  const file = formData.get("file");
  const meetingId = formData.get("meetingId") as string;
  const documentType = formData.get("documentType") as BoardDocumentType;
  const title = (formData.get("title") as string) || (file instanceof File ? file.name : "Document");

  if (!(file instanceof File)) return { error: "No file provided" };
  if (!meetingId) return { error: "No meeting ID" };
  if (!ALLOWED_MIME.includes(file.type)) return { error: "File type not allowed" };
  if (file.size > MAX_BYTES) return { error: "File must be under 50 MB" };

  const ext = file.name.split(".").pop() ?? "pdf";
  const path = `meetings/${meetingId}/${documentType}/${Date.now()}.${ext}`;

  const db = createAdminClient();
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("[uploadBoardDocument] storage error", uploadError);
    return { error: "Upload failed" };
  }

  const { data: doc, error: insertError } = await db
    .from("board_documents")
    .insert({
      meeting_id: meetingId,
      title,
      document_type: documentType,
      context: "meeting",
      storage_path: path,
      mime_type: file.type,
      file_size_bytes: file.size,
      uploaded_by: auth.ctx.userId,
    })
    .select("id, title, document_type, mime_type, file_size_bytes, storage_path, created_at")
    .single();

  if (insertError || !doc) {
    // Roll back storage upload
    await db.storage.from(BUCKET).remove([path]);
    return { error: "Failed to save document record" };
  }

  revalidatePath("/admin/board/meetings");
  return { doc };
}

// ─── Cancel a board meeting ──────────────────────────────────────────────────

export async function cancelBoardMeeting(
  meetingId: string,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: "Not authorised" };

  const db = createAdminClient();

  // Get the meeting so we can also cancel its linked event
  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, event_id, status")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return { error: "Meeting not found" };
  if (meeting.status === "cancelled") return { success: true }; // already cancelled

  // Cancel the board meeting record
  const { error } = await db
    .from("board_meetings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", meetingId);

  if (error) {
    console.error("[cancelBoardMeeting]", error);
    return { error: "Failed to cancel meeting" };
  }

  // Cancel the linked calendar event too (best-effort)
  if (meeting.event_id) {
    await db
      .from("events")
      .update({ status: "cancelled" })
      .eq("id", meeting.event_id);
  }

  revalidatePath("/admin/board/meetings");
  revalidatePath(`/admin/board/meetings/${meetingId}`);
  return { success: true };
}

// ─── Create + link a calendar event for an unlinked board meeting ────────────

function slugify(title: string, date: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) +
    "-" +
    date
  );
}

export async function createEventForMeeting(
  meetingId: string,
): Promise<{ success: true; slug: string } | { error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: "Not authorised" };

  const db = createAdminClient();

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, title, meeting_date, meeting_type, event_id, created_by")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return { error: "Meeting not found" };
  if (meeting.event_id) return { error: "Meeting already has a linked event" };

  const slug = slugify(meeting.title, meeting.meeting_date);

  // Deduplicate slug if needed
  const { data: existing } = await db
    .from("events")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  const finalSlug = existing ? `${slug}-2` : slug;

  const startsAt = `${meeting.meeting_date}T14:00:00Z`;
  const endsAt   = `${meeting.meeting_date}T16:00:00Z`;

  const { data: event, error: eventError } = await db
    .from("events")
    .insert({
      slug:          finalSlug,
      title:         meeting.title,
      starts_at:     startsAt,
      ends_at:       endsAt,
      audience_mode: "board",
      is_virtual:    true,
      status:        "published",
      created_by:    meeting.created_by ?? auth.ctx.userId,
    })
    .select("id")
    .single();

  if (eventError || !event) {
    console.error("[createEventForMeeting] event insert failed:", eventError);
    return { error: "Failed to create event" };
  }

  const { error: linkError } = await db
    .from("board_meetings")
    .update({ event_id: event.id })
    .eq("id", meetingId);

  if (linkError) {
    console.error("[createEventForMeeting] link failed:", linkError);
    return { error: "Event created but link failed" };
  }

  revalidatePath("/admin/board/meetings");
  revalidatePath(`/admin/board/meetings/${meetingId}`);
  return { success: true, slug: finalSlug };
}

// ─── Delete a board document ─────────────────────────────────────────────────

export async function deleteBoardDocument(
  docId: string,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: "Not authorised" };

  const db = createAdminClient();
  const { data: doc } = await db
    .from("board_documents")
    .select("id, storage_path")
    .eq("id", docId)
    .maybeSingle();

  if (!doc) return { error: "Document not found" };

  if (doc.storage_path) {
    await db.storage.from(BUCKET).remove([doc.storage_path]);
  }

  await db.from("board_documents").delete().eq("id", docId);

  revalidatePath("/admin/board/meetings");
  return { success: true };
}
