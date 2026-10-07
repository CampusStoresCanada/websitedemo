"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";

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

// ─── Mark a board meeting completed ──────────────────────────────────────────

/**
 * Closes out a meeting that has happened — the only exit from `upcoming` other
 * than cancelling. Without it the board_meeting_not_closed_out alert can never
 * clear: nothing else in the app writes `completed`, so every past meeting sat
 * `upcoming` forever and the warning could only be muted, never answered.
 *
 * Refuses a future-dated meeting (nothing has happened yet) and a cancelled one
 * (it never happened). Date boundary is the UTC day, matching the alert's own
 * cutoff, so a meeting held earlier today can be closed out the same day.
 *
 * Deliberately leaves the linked calendar event alone. cancelBoardMeeting
 * cascades because a cancelled meeting is cancelled for everyone, but
 * `completed` on an event narrows what the public event reader will serve — a
 * separate decision from closing the board's own record.
 */
export async function completeBoardMeeting(
  meetingId: string,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: "Not authorised" };

  const db = createAdminClient();

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, title, meeting_date, status")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return { error: "Meeting not found" };
  if (meeting.status === "completed") return { success: true }; // already closed out
  if (meeting.status === "cancelled") {
    return { error: "A cancelled meeting cannot be marked completed" };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (meeting.meeting_date > today) {
    return { error: "This meeting has not happened yet" };
  }

  const { error } = await db
    .from("board_meetings")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", meetingId);

  if (error) {
    console.error("[completeBoardMeeting]", error);
    return { error: "Failed to mark meeting completed" };
  }

  await logAuditEventSafe({
    actorId: auth.ctx.userId,
    action: "board_meeting_completed",
    entityType: "board_meeting",
    entityId: meetingId,
    details: { title: meeting.title, meetingDate: meeting.meeting_date },
  });

  revalidatePath("/admin/board/meetings");
  revalidatePath(`/admin/board/meetings/${meetingId}`);
  revalidatePath("/admin/ops");
  return { success: true };
}

// ─── Reopen a closed-out meeting ─────────────────────────────────────────────

/**
 * Puts a completed meeting back to `upcoming`. The undo for a mis-click on
 * "Mark completed" — without it that button would be a one-way door, which is
 * the same dead end that made closing out impossible in the first place.
 *
 * Cancelled meetings are not reopened here: cancelling cascades to the linked
 * calendar event, so undoing it has to decide what the event becomes, and that
 * is a larger question than correcting a status.
 */
export async function reopenBoardMeeting(
  meetingId: string,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: "Not authorised" };

  const db = createAdminClient();

  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, title, meeting_date, status")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) return { error: "Meeting not found" };
  if (meeting.status === "upcoming") return { success: true };
  if (meeting.status !== "completed") {
    return { error: "Only a completed meeting can be reopened" };
  }

  const { error } = await db
    .from("board_meetings")
    .update({ status: "upcoming", updated_at: new Date().toISOString() })
    .eq("id", meetingId);

  if (error) {
    console.error("[reopenBoardMeeting]", error);
    return { error: "Failed to reopen meeting" };
  }

  await logAuditEventSafe({
    actorId: auth.ctx.userId,
    action: "board_meeting_reopened",
    entityType: "board_meeting",
    entityId: meetingId,
    details: { title: meeting.title, meetingDate: meeting.meeting_date },
  });

  revalidatePath("/admin/board/meetings");
  revalidatePath(`/admin/board/meetings/${meetingId}`);
  revalidatePath("/admin/ops");
  return { success: true };
}
