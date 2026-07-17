"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseConferenceDocuments, type ConferenceDocument } from "@/lib/conference-documents";
import type { Json } from "@/lib/database.types";
import { logAuditEventSafe } from "@/lib/ops/audit";

interface ManageDocumentsResult {
  success: boolean;
  documents?: ConferenceDocument[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Add a document
// ---------------------------------------------------------------------------

export async function addConferenceDocument(
  conferenceId: string,
  doc: ConferenceDocument
): Promise<ManageDocumentsResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: conference, error: fetchError } = await adminClient
    .from("conference_instances")
    .select("documents")
    .eq("id", conferenceId)
    .single();

  if (fetchError || !conference) {
    return { success: false, error: "Conference not found" };
  }

  const existing = parseConferenceDocuments(conference.documents);
  const updated = [...existing.filter((d) => d.id !== doc.id), doc];

  const { error: updateError } = await adminClient
    .from("conference_instances")
    .update({ documents: updated as unknown as Json })
    .eq("id", conferenceId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await logAuditEventSafe({
    action: "conference_document_added",
    entityType: "conference_instance",
    entityId: conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { document_id: doc.id, label: doc.label },
  });

  return { success: true, documents: updated };
}

// ---------------------------------------------------------------------------
// Remove a document
// ---------------------------------------------------------------------------

export async function removeConferenceDocument(
  conferenceId: string,
  documentId: string
): Promise<ManageDocumentsResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: conference, error: fetchError } = await adminClient
    .from("conference_instances")
    .select("documents")
    .eq("id", conferenceId)
    .single();

  if (fetchError || !conference) {
    return { success: false, error: "Conference not found" };
  }

  const existing = parseConferenceDocuments(conference.documents);
  const removing = existing.find((d) => d.id === documentId);
  const updated = existing.filter((d) => d.id !== documentId);

  const { error: updateError } = await adminClient
    .from("conference_instances")
    .update({ documents: updated as unknown as Json })
    .eq("id", conferenceId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // If it was a stored file, clean up the object too
  if (removing?.storage_path) {
    await adminClient.storage
      .from("conference-documents")
      .remove([removing.storage_path]);
  }

  await logAuditEventSafe({
    action: "conference_document_removed",
    entityType: "conference_instance",
    entityId: conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { document_id: documentId },
  });

  return { success: true, documents: updated };
}

// ---------------------------------------------------------------------------
// Reorder documents
// ---------------------------------------------------------------------------

export async function reorderConferenceDocuments(
  conferenceId: string,
  orderedIds: string[]
): Promise<ManageDocumentsResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: conference, error: fetchError } = await adminClient
    .from("conference_instances")
    .select("documents")
    .eq("id", conferenceId)
    .single();

  if (fetchError || !conference) {
    return { success: false, error: "Conference not found" };
  }

  const existing = parseConferenceDocuments(conference.documents);
  const byId = new Map(existing.map((d) => [d.id, d]));
  const updated = orderedIds
    .map((id) => byId.get(id))
    .filter((d): d is ConferenceDocument => Boolean(d));

  const orderedSet = new Set(orderedIds);
  for (const doc of existing) {
    if (!orderedSet.has(doc.id)) updated.push(doc);
  }

  const { error: updateError } = await adminClient
    .from("conference_instances")
    .update({ documents: updated as unknown as Json })
    .eq("id", conferenceId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true, documents: updated };
}
